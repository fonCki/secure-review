import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CompleteInput, CompleteOutput, ModelAdapter } from '../src/adapters/types.js';
import type { SecureReviewConfig } from '../src/config/schema.js';

/**
 * Integration tests for `runFixMode` with attack-ai feeding the loop.
 *
 * The static reviewer/writer adapters are mocked via the adapter factory so we
 * don't make real model calls. The attacker is injected directly into the
 * `attack` hook on `FixModeInput` (see `attackerAdapter`/`attackerSkill`),
 * which lets us exercise the real attack-ai planner code path against a local
 * HTTP target without going through the factory at all.
 */

const state = vi.hoisted(() => ({
  reviewerFindingsByCall: [
    [
      {
        severity: 'HIGH',
        file: 'src/server.ts',
        line_start: 1,
        line_end: 1,
        title: 'Static-only finding',
        description: 'Reviewer initially flags this.',
      },
    ],
    [],
    [],
    [],
  ] as Array<Array<Record<string, unknown>>>,
  reviewerCallIndex: 0,
}));

vi.mock('../src/adapters/factory.js', () => ({
  getAdapter: vi.fn(({ model }: { model: string }): ModelAdapter => ({
    provider: 'anthropic',
    mode: 'api',
    model,
    async complete(_input: CompleteInput): Promise<CompleteOutput> {
      if (model === 'writer-model') {
        return {
          text: '{"changes":[]}',
          usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.01 },
          durationMs: 1,
        };
      }
      const findings = state.reviewerFindingsByCall[state.reviewerCallIndex] ?? [];
      state.reviewerCallIndex += 1;
      return {
        text: JSON.stringify({ findings }),
        usage: { inputTokens: 1, outputTokens: 1, costUSD: 0.01 },
        durationMs: 1,
      };
    },
  })),
}));

vi.mock('../src/config/load.js', () => ({
  loadSkill: vi.fn(async () => '# Skill'),
  resolveSkillPath: vi.fn((skill: string) => skill),
}));

vi.mock('../src/sast/index.js', () => ({
  runAllSast: vi.fn(async () => ({
    findings: [],
    semgrep: { ran: false, count: 0 },
    eslint: { ran: false, count: 0 },
    npmAudit: { ran: false, count: 0 },
  })),
}));

vi.mock('../src/util/files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/util/files.js')>();
  return {
    ...actual,
    readSourceTree: vi.fn(async () => [
      {
        path: '/repo/src/server.ts',
        relPath: 'src/server.ts',
        content: "app.get('/search', (req, res) => res.send(req.query.q));\n",
        lines: 1,
      },
    ]),
  };
});

const { runFixMode } = await import('../src/modes/fix.js');

function config(): SecureReviewConfig {
  return {
    writer: { provider: 'anthropic', model: 'writer-model', skill: 'writer.md' },
    reviewers: [{ name: 'static-reviewer', provider: 'anthropic', model: 'reader-model', skill: 'reader.md' }],
    sast: { enabled: false, tools: [], inject_into_reviewer_context: false },
    review: { parallel: true },
    fix: {
      mode: 'sequential_rotation',
      max_iterations: 2,
      final_verification: 'none',
      min_confidence_to_fix: 0,
      min_severity_to_fix: 'INFO',
    },
    gates: {
      block_on_new_critical: true,
      block_on_new_high: false,
      max_cost_usd: 5,
      max_wall_time_minutes: 15,
    },
    dynamic: {
      enabled: true,
      timeout_seconds: 5,
      max_requests: 20,
      rate_limit_per_second: 20,
      max_crawl_pages: 5,
      checks: ['headers'],
      sensitive_paths: [],
      gates: { block_on_confirmed_critical: true, block_on_confirmed_high: false },
    },
    output: {
      report: './reports/report-{timestamp}.md',
      findings: './reports/findings-{timestamp}.json',
      diff: './reports/diff-{timestamp}.patch',
    },
  };
}

function fakeAttacker(text: string): ModelAdapter {
  return {
    provider: 'anthropic',
    mode: 'api',
    model: 'fake-attacker',
    async complete(): Promise<CompleteOutput> {
      return {
        text,
        usage: { inputTokens: 100, outputTokens: 40, costUSD: 0.012 },
        durationMs: 1,
      };
    },
  };
}

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server?.close((err) => (err ? reject(err) : resolve())));
    server = undefined;
  }
  state.reviewerCallIndex = 0;
});

async function listen(handler: Parameters<typeof createServer>[0]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const addr = server!.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}/`;
}

describe('runFixMode + attack-ai integration', () => {
  it('bookend cadence: runs attack twice (initial + final), feeds initial runtime finding into writer queue', async () => {
    state.reviewerFindingsByCall = [
      [
        {
          severity: 'HIGH',
          file: 'src/server.ts',
          line_start: 50,
          line_end: 50,
          title: 'Static-only finding',
          description: 'Reviewer initially flags this.',
        },
      ],
      [],
    ];
    state.reviewerCallIndex = 0;

    const target = await listen((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body><a href="/search">Search</a></body></html>');
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

    const attacker = fakeAttacker(JSON.stringify({
      hypotheses: [
        {
          id: 'H-01',
          category: 'reflected_input',
          severity: 'HIGH',
          title: 'Reflected search parameter',
          rationale: 'q is reflected unescaped',
          path: '/search',
          method: 'GET',
          parameter: 'q',
          sourceFile: 'src/server.ts',
          lineStart: 1,
          remediation: 'HTML-encode the reflected value.',
        },
      ],
    }));

    const cfg = config();
    cfg.fix.max_iterations = 1;
    const out = await runFixMode({
      root: '/repo',
      config: cfg,
      configDir: '/repo',
      env: {},
      attack: {
        targetUrl: target,
        cadence: 'bookend',
        attackerAdapter: attacker,
        attackerSkill: 'Plan authorized probes only.',
      },
    });

    expect(out.runtimeAttacks).toBeDefined();
    expect(out.runtimeAttacks?.map((p) => p.phase)).toEqual(['initial', 'final']);
    expect(out.initialRuntimeFindings).toHaveLength(1);
    expect(out.finalRuntimeFindings).toHaveLength(1);
    expect(out.iterations).toHaveLength(1);
    const iter1 = out.iterations[0]!;
    const titles = iter1.findingsBefore.map((f) => f.title);
    expect(titles).toContain('Static-only finding');
    expect(titles).toContain('Reflected search parameter');
    expect(iter1.runtimeAttackPhase).toBeUndefined();
  });

  it('every-iter cadence: re-runs attack after each iteration so verifier sees fresh runtime findings', async () => {
    state.reviewerFindingsByCall = [
      [],
      [],
      [],
    ];
    state.reviewerCallIndex = 0;

    const target = await listen((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<a href="/search">Search</a>');
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

    const attacker = fakeAttacker(JSON.stringify({
      hypotheses: [
        {
          category: 'reflected_input',
          severity: 'HIGH',
          title: 'Reflected search parameter',
          rationale: 'q is reflected unescaped',
          path: '/search',
          method: 'GET',
          parameter: 'q',
          sourceFile: 'src/server.ts',
          lineStart: 1,
        },
      ],
    }));

    const out = await runFixMode({
      root: '/repo',
      config: { ...config(), fix: { ...config().fix, max_iterations: 2 } },
      configDir: '/repo',
      env: {},
      attack: {
        targetUrl: target,
        cadence: 'every',
        attackerAdapter: attacker,
        attackerSkill: 'Plan authorized probes only.',
      },
    });

    const phases = out.runtimeAttacks?.map((p) => p.phase);
    expect(phases).toContain('initial');
    expect(phases?.filter((p) => p.startsWith('iteration-')).length).toBeGreaterThanOrEqual(1);
    const everyIterPhases = out.iterations.map((it) => it.runtimeAttackPhase);
    expect(everyIterPhases.every((p) => p?.startsWith('iteration-'))).toBe(true);
    expect(out.iterations.every((it) => (it.runtimeFindings?.length ?? 0) > 0)).toBe(true);
  });

  it('additive convergence: clean static reviewer does not exit early when runtime stays dirty', async () => {
    state.reviewerFindingsByCall = [[], [], [], []];
    state.reviewerCallIndex = 0;

    const target = await listen((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<a href="/search">Search</a>');
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

    const attacker = fakeAttacker(JSON.stringify({
      hypotheses: [
        {
          category: 'reflected_input',
          severity: 'HIGH',
          title: 'Reflected search parameter',
          rationale: 'q is reflected unescaped',
          path: '/search',
          method: 'GET',
          parameter: 'q',
        },
      ],
    }));

    const out = await runFixMode({
      root: '/repo',
      config: { ...config(), fix: { ...config().fix, max_iterations: 2 } },
      configDir: '/repo',
      env: {},
      attack: {
        targetUrl: target,
        cadence: 'every',
        attackerAdapter: attacker,
        attackerSkill: 'Plan authorized probes only.',
      },
    });

    expect(out.iterations.length).toBe(2);
    expect(out.finalFindings.length).toBeGreaterThan(0);
  });
});
