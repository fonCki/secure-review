import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runAttackMode } from '../src/modes/attack.js';
import { renderAttackEvidence } from '../src/reporters/json.js';
import { renderAttackReport } from '../src/reporters/markdown.js';
import type { SecureReviewConfig } from '../src/config/schema.js';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((err) => (err ? reject(err) : resolve()));
  });
  server = undefined;
});

function baseConfig(overrides: Partial<SecureReviewConfig['dynamic']> = {}): SecureReviewConfig {
  return {
    writer: { provider: 'anthropic', model: 'claude-sonnet-4-6', skill: 'skills/w.md' },
    reviewers: [{ name: 'r', provider: 'anthropic', model: 'claude-sonnet-4-6', skill: 'skills/r.md' }],
    sast: { enabled: false, tools: [], inject_into_reviewer_context: false },
    review: { parallel: true },
    fix: {
      mode: 'sequential_rotation',
      max_iterations: 1,
      final_verification: 'none',
      min_confidence_to_fix: 0,
      min_severity_to_fix: 'INFO',
    },
    gates: { block_on_new_critical: true, block_on_new_high: false, max_cost_usd: 5, max_wall_time_minutes: 15 },
    dynamic: {
      enabled: true,
      timeout_seconds: 5,
      max_requests: 50,
      rate_limit_per_second: 2,
      max_crawl_pages: 20,
      checks: ['headers', 'cookies', 'cors', 'sensitive_paths'],
      sensitive_paths: ['/.env', '/swagger.json'],
      gates: { block_on_confirmed_critical: true, block_on_confirmed_high: false },
      ...overrides,
    },
    output: {
      report: './reports/report-{timestamp}.md',
      findings: './reports/findings-{timestamp}.json',
      diff: './reports/diff-{timestamp}.patch',
    },
  };
}

async function listen(handler: Parameters<typeof createServer>[0]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}/`;
}

describe('runAttackMode', () => {
  it('finds missing headers, unsafe cookies, CORS reflection, and exposed sensitive paths', async () => {
    const target = await listen((req, res) => {
      if (req.url === '/.env') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('API_KEY=super-secret\n');
        return;
      }
      if (req.url === '/swagger.json') {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      if (req.headers.origin) {
        res.setHeader('access-control-allow-origin', req.headers.origin);
        res.setHeader('access-control-allow-credentials', 'true');
      }
      res.setHeader('set-cookie', ['sid=abc123; Path=/', 'prefs=dark; Path=/; HttpOnly']);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    const out = await runAttackMode({ root: '/', config: baseConfig(), targetUrl: target });

    expect(out.checks.some((c) => c.check === 'headers' && c.ok)).toBe(true);
    expect(out.findings.map((f) => f.title)).toEqual(expect.arrayContaining([
      'Missing Content-Security-Policy header',
      'Missing clickjacking protection',
      'Missing X-Content-Type-Options: nosniff',
      'Cookie sid missing HttpOnly',
      'CORS reflects untrusted origin',
      'Sensitive path exposed: /.env',
    ]));
    expect(out.breakdown.CRITICAL).toBeGreaterThanOrEqual(2);
    expect(out.gateBlocked).toBe(true);
    const envFinding = out.findings.find((f) => f.title === 'Sensitive path exposed: /.env');
    expect(envFinding?.description).toContain('API_KEY=<redacted>');
  });

  it('sends dynamic.auth_headers so gated sensitive path probes can authenticate', async () => {
    const target = await listen((req, res) => {
      if (req.url === '/.env') {
        if (!req.headers.cookie?.includes('session=probe')) {
          res.writeHead(403);
          res.end('forbidden');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('API_KEY=should-redact');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const noAuth = await runAttackMode({
      root: '/',
      config: baseConfig({
        checks: ['sensitive_paths'],
        sensitive_paths: ['/.env'],
      }),
      targetUrl: target,
    });
    expect(noAuth.findings.some((f) => f.title.includes('/.env'))).toBe(false);

    const withAuth = await runAttackMode({
      root: '/',
      config: baseConfig({
        checks: ['sensitive_paths'],
        sensitive_paths: ['/.env'],
        auth_headers: { Cookie: 'session=probe' },
      }),
      targetUrl: target,
    });
    expect(withAuth.findings.some((f) => f.title === 'Sensitive path exposed: /.env')).toBe(true);
  });

  it('does not report findings for a hardened minimal response', async () => {
    const target = await listen((_req, res) => {
      res.writeHead(200, {
        'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
      });
      res.end('ok');
    });

    const out = await runAttackMode({
      root: '/',
      config: baseConfig({ checks: ['headers'], gates: { block_on_confirmed_critical: true, block_on_confirmed_high: true } }),
      targetUrl: target,
    });
    expect(out.findings).toHaveLength(0);
    expect(out.gateBlocked).toBe(false);
  });

  it('does not treat SPA fallback HTML as exposed sensitive files', async () => {
    const spaShell = `<!doctype html><html><body><div id="root"></div><script type="module" src="/@vite/client"></script></body></html>`;
    const target = await listen((req, res) => {
      if (req.url === '/.git/config') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('[core]\nrepositoryformatversion = 0\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(spaShell);
    });

    const out = await runAttackMode({
      root: '/',
      config: baseConfig({
        checks: ['sensitive_paths'],
        sensitive_paths: ['/.git/config', '/config.json', '/debug', '/swagger.json', '/openapi.json'],
      }),
      targetUrl: target,
    });

    expect(out.findings.map((f) => f.title)).toEqual(['Sensitive path exposed: /.git/config']);
    expect(out.checks.find((c) => c.url.endsWith('/config.json'))?.evidence).toMatchObject({ exposed: false });
    expect(out.checks.find((c) => c.url.endsWith('/debug'))?.evidence).toMatchObject({ exposed: false });
  });

  it('fails clearly when the runtime target is unreachable', async () => {
    await expect(
      runAttackMode({
        root: '/',
        config: baseConfig({ checks: ['headers'], timeout_seconds: 1 }),
        targetUrl: 'http://127.0.0.1:1/',
      }),
    ).rejects.toThrow('Attack target was not reachable');
  });

  it('renders markdown and JSON evidence', async () => {
    const target = await listen((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    const out = await runAttackMode({ root: '/', config: baseConfig({ checks: ['headers'] }), targetUrl: target });
    const md = renderAttackReport(out);
    expect(md).toContain('Runtime Attack Report');
    expect(md).toContain('Missing Content-Security-Policy');

    const json = renderAttackEvidence(out, {
      taskId: 'runtime',
      run: 1,
      modelVersion: 'dynamic-runtime',
      reviewerNames: ['dynamic'],
    });
    expect(json.condition).toBe('F-attack');
    expect(json.target_url).toBe(target);
    expect(json.runtime_findings).toHaveLength(out.findings.length);
    expect(json.findings).toHaveLength(out.findings.length);
  });
});
