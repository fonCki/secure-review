import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelAdapter } from '../src/adapters/types.js';
import type { SecureReviewConfig } from '../src/config/schema.js';
import { runAttackAiMode, mergeAttackerRef } from '../src/modes/attack-ai.js';
import { renderAttackAiEvidence } from '../src/reporters/json.js';
import { renderAttackAiReport } from '../src/reporters/markdown.js';

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
      max_requests: 20,
      rate_limit_per_second: 20,
      max_crawl_pages: 5,
      checks: ['headers'],
      sensitive_paths: [],
      gates: { block_on_confirmed_critical: true, block_on_confirmed_high: true },
      ...overrides,
    },
    output: {
      report: './reports/report-{timestamp}.md',
      findings: './reports/findings-{timestamp}.json',
      diff: './reports/diff-{timestamp}.patch',
    },
  };
}

function fakeAdapter(text: string): ModelAdapter {
  return {
    provider: 'anthropic',
    model: 'fake-attacker',
    mode: 'api',
    async complete() {
      return {
        text,
        usage: { inputTokens: 100, outputTokens: 40, costUSD: 0.012 },
        durationMs: 1,
      };
    },
  };
}

async function listen(handler: Parameters<typeof createServer>[0]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}/`;
}

async function fixtureRoot(): Promise<string> {
  const root = join(process.cwd(), `.tmp-attack-ai-${process.pid}-${Date.now()}`);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'src', 'server.ts'),
    `app.get('/search', (req, res) => res.send(req.query.q));\n`,
    'utf8',
  );
  return root;
}

describe('runAttackAiMode', () => {
  it('crawls, plans safe probes, and reports only confirmed runtime findings', async () => {
    const target = await listen((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><head><title>Home</title></head><body><a href="/search">Search</a></body></html>');
        return;
      }
      if (url.pathname === '/search') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<p>${url.searchParams.get('q') ?? ''}</p>`);
        return;
      }
      res.writeHead(404);
      res.end('missing');
    });

    const model = fakeAdapter(JSON.stringify({
      hypotheses: [
        {
          id: 'H-01',
          category: 'reflected_input',
          severity: 'HIGH',
          title: 'Reflected search parameter is not encoded',
          rationale: 'The search route appears to render q directly.',
          path: '/search',
          method: 'GET',
          parameter: 'q',
          sourceFile: 'src/server.ts',
          lineStart: 1,
          remediation: 'HTML-encode reflected search terms before rendering.',
        },
        {
          id: 'H-02',
          category: 'open_redirect',
          severity: 'HIGH',
          title: 'Redirect parameter may allow open redirect',
          rationale: 'Probe an expected redirect parameter.',
          path: '/search',
          method: 'GET',
          parameter: 'next',
        },
        {
          id: 'H-03',
          category: 'path_exposure',
          severity: 'MEDIUM',
          title: 'Missing path may expose content',
          rationale: 'The model used null for optional fields.',
          path: '/missing',
          method: 'GET',
          parameter: null,
          sourceFile: null,
          lineStart: null,
          remediation: null,
        },
      ],
    }));

    const out = await runAttackAiMode({
      root: await fixtureRoot(),
      config: baseConfig(),
      configDir: '/',
      env: {},
      targetUrl: target,
      attackerAdapter: model,
      attackerSkill: 'Plan authorized probes.',
    });

    expect(out.pages.map((p) => p.url)).toContain(target);
    expect(out.hypotheses).toHaveLength(3);
    expect(out.probes).toHaveLength(3);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({
      id: 'A-01',
      severity: 'HIGH',
      file: 'src/server.ts',
      lineStart: 1,
      title: 'Reflected search parameter is not encoded',
      reportedBy: ['attack-ai'],
      confidence: 1,
    });
    expect(out.gateBlocked).toBe(true);
    expect(out.totalCostUSD).toBe(0.012);
    expect(out.attacker).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      skillPath: 'skills/w.md',
    });
  });

  it('rejects model probes outside same-origin scope', async () => {
    const target = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('ok');
    });
    const model = fakeAdapter(JSON.stringify({
      hypotheses: [
        {
          category: 'path_exposure',
          severity: 'CRITICAL',
          title: 'External target should not run',
          rationale: 'Out of scope.',
          path: 'https://example.com/.env',
          method: 'GET',
        },
      ],
    }));

    const out = await runAttackAiMode({
      root: await fixtureRoot(),
      config: baseConfig(),
      configDir: '/',
      env: {},
      targetUrl: target,
      attackerAdapter: model,
      attackerSkill: 'Plan authorized probes.',
    });

    expect(out.hypotheses).toHaveLength(0);
    expect(out.probes).toHaveLength(0);
    expect(out.findings).toHaveLength(0);
  });

  it('does not confirm generic SPA fallback HTML as path exposure', async () => {
    const spaShell = `<!doctype html><html><body><div id="root"></div><script type="module" src="/@vite/client"></script></body></html>`;
    const target = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(spaShell);
    });
    const model = fakeAdapter(JSON.stringify({
      hypotheses: [
        {
          category: 'path_exposure',
          severity: 'MEDIUM',
          title: 'Admin route may be exposed',
          rationale: 'A client-side route exists.',
          path: '/admin',
          method: 'GET',
          parameter: null,
        },
      ],
    }));

    const out = await runAttackAiMode({
      root: await fixtureRoot(),
      config: baseConfig(),
      configDir: '/',
      env: {},
      targetUrl: target,
      attackerAdapter: model,
      attackerSkill: 'Plan authorized probes.',
    });

    expect(out.probes).toHaveLength(1);
    expect(out.probes[0]?.confirmed).toBe(false);
    expect(out.probes[0]?.evidence.reason).toBe('path returned a generic SPA fallback document');
    expect(out.findings).toHaveLength(0);
  });

  it('fails before model planning when the runtime target is unreachable', async () => {
    const model: ModelAdapter = {
      provider: 'anthropic',
      model: 'fake-attacker',
      mode: 'api',
      async complete() {
        throw new Error('model should not be called for an empty crawl');
      },
    };

    await expect(
      runAttackAiMode({
        root: await fixtureRoot(),
        config: baseConfig({ timeout_seconds: 1 }),
        configDir: '/',
        env: {},
        targetUrl: 'http://127.0.0.1:1/',
        attackerAdapter: model,
        attackerSkill: 'Plan authorized probes.',
      }),
    ).rejects.toThrow('AI attack target was not reachable');
  });

  it('renders markdown and JSON evidence', async () => {
    const target = await listen((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    const out = await runAttackAiMode({
      root: await fixtureRoot(),
      config: baseConfig(),
      configDir: '/',
      env: {},
      targetUrl: target,
      attackerAdapter: fakeAdapter(JSON.stringify({ hypotheses: [] })),
      attackerSkill: 'Plan authorized probes.',
    });

    const md = renderAttackAiReport(out);
    expect(md).toContain('AI Attack Simulation Report');
    expect(md).toContain('Same-origin requests only');
    expect(md).toContain('Attacker:');
    expect(md).toContain('anthropic');

    const json = renderAttackAiEvidence(out, {
      taskId: 'attack-ai',
      run: 1,
      modelVersion: 'fake-attacker',
      reviewerNames: ['attack-ai'],
    });
    expect(json.condition).toBe('F-attack-ai');
    expect(json.target_url).toBe(target);
    expect(json.crawled_pages).toHaveLength(1);
    expect(json.runtime_findings).toHaveLength(0);
  });
});

describe('mergeAttackerRef', () => {
  it('merges CLI-style overrides onto dynamic.attacker or writer', () => {
    const config = baseConfig({
      attacker: {
        provider: 'openai',
        model: 'gpt-4.1',
        skill: 'skills/authorized-attack-simulator.md',
      },
    });
    const merged = mergeAttackerRef({
      root: '/r',
      config,
      configDir: '/cfg',
      env: {},
      attackerProvider: 'google',
      attackerModel: 'gemini-2.5-pro',
      attackerSkillPath: 'skills/custom.md',
    });
    expect(merged.provider).toBe('google');
    expect(merged.model).toBe('gemini-2.5-pro');
    expect(merged.skill).toBe('skills/custom.md');
  });

  it('keeps unspecified override fields from config base', () => {
    const config = baseConfig({
      attacker: {
        provider: 'openai',
        model: 'gpt-4.1',
        skill: 'skills/atk.md',
      },
    });
    const merged = mergeAttackerRef({
      root: '/r',
      config,
      configDir: '/cfg',
      env: {},
      attackerModel: 'gpt-4.1-mini',
    });
    expect(merged.provider).toBe('openai');
    expect(merged.model).toBe('gpt-4.1-mini');
    expect(merged.skill).toBe('skills/atk.md');
  });
});
