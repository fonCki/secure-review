import { z } from 'zod';

export const Provider = z.enum(['anthropic', 'openai', 'google']);
export type Provider = z.infer<typeof Provider>;

export const ProviderMode = z.enum(['api', 'cli']);
export type ProviderMode = z.infer<typeof ProviderMode>;

export const ModelRef = z.object({
  provider: Provider,
  model: z.string().min(1),
  skill: z.string().min(1), // path relative to config file OR absolute
  /** Optional display name. Reviewers use `name`; writer infers from role. */
  name: z.string().optional(),
  /** Optional cap per single invocation (tokens). */
  maxTokens: z.number().int().positive().optional(),
});
export type ModelRef = z.infer<typeof ModelRef>;

export const ReviewerRef = ModelRef.extend({
  name: z.string().min(1), // required for reviewers (used in reportedBy, PR comments)
});
export type ReviewerRef = z.infer<typeof ReviewerRef>;

export const SastConfig = z.object({
  enabled: z.boolean().default(true),
  tools: z.array(z.enum(['semgrep', 'eslint', 'npm_audit'])).default(['semgrep', 'eslint', 'npm_audit']),
  inject_into_reviewer_context: z.boolean().default(true),
});

export const ReviewConfig = z.object({
  parallel: z.boolean().default(true),
});

export const FixConfig = z.object({
  mode: z.enum(['sequential_rotation', 'parallel_aggregate']).default('sequential_rotation'),
  max_iterations: z.number().int().min(1).max(10).default(3),
  final_verification: z.enum(['all_reviewers', 'first_reviewer', 'none']).default('all_reviewers'),
  /** Only send findings with confidence >= this threshold to the writer (0 = no filter). */
  min_confidence_to_fix: z.number().min(0).max(1).default(0),
  /** Only send findings at or above this severity to the writer (default 'INFO' = all). */
  min_severity_to_fix: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).default('INFO'),
});

export const GatesConfig = z.object({
  block_on_new_critical: z.boolean().default(true),
  block_on_new_high: z.boolean().default(false),
  max_cost_usd: z.number().positive().default(20),
  max_wall_time_minutes: z.number().positive().default(15),
});

export const DynamicCheck = z.enum(['headers', 'cookies', 'cors', 'sensitive_paths']);
export type DynamicCheck = z.infer<typeof DynamicCheck>;

export const DynamicConfig = z.object({
  enabled: z.boolean().default(false),
  /** Optional runtime target. Can also be supplied with `secure-review attack --target-url`. */
  target_url: z.string().url().optional(),
  healthcheck_url: z.string().url().optional(),
  timeout_seconds: z.number().int().positive().max(600).default(30),
  max_requests: z.number().int().positive().max(500).default(50),
  rate_limit_per_second: z.number().positive().max(20).default(2),
  max_crawl_pages: z.number().int().positive().max(100).default(20),
  attacker: ModelRef.optional(),
  checks: z.array(DynamicCheck).default(['headers', 'cookies', 'cors', 'sensitive_paths']),
  sensitive_paths: z
    .array(z.string().startsWith('/'))
    .default(['/.env', '/.git/config', '/config.json', '/debug', '/swagger.json', '/openapi.json']),
  gates: z
    .object({
      block_on_confirmed_critical: z.boolean().default(true),
      block_on_confirmed_high: z.boolean().default(false),
    })
    .default({
      block_on_confirmed_critical: true,
      block_on_confirmed_high: false,
    }),
  /**
   * Extra request headers on every Layer 4 HTTP request (`attack`, `attack-ai`, fix + attack-ai).
   * Use for session cookies or Bearer tokens so probes hit authenticated routes.
   * Prefer CI secrets or a gitignored overlay — do not commit real credentials.
   */
  auth_headers: z.record(z.string(), z.string()).optional(),
});
export type DynamicConfig = z.infer<typeof DynamicConfig>;

export const OutputConfig = z.object({
  report: z.string().default('./reports/report-{timestamp}.md'),
  findings: z.string().default('./reports/findings-{timestamp}.json'),
  diff: z.string().default('./reports/diff-{timestamp}.patch'),
});

export const SecureReviewConfigSchema = z.object({
  writer: ModelRef,
  /** Optional list of additional writer models for benchmarking. */
  writers: z.array(ModelRef).optional(),
  reviewers: z.array(ReviewerRef).min(1),
  sast: SastConfig.default({
    enabled: true,
    tools: ['semgrep', 'eslint', 'npm_audit'],
    inject_into_reviewer_context: true,
  }),
  review: ReviewConfig.default({ parallel: true }),
  fix: FixConfig.default({
    mode: 'sequential_rotation',
    max_iterations: 3,
    final_verification: 'all_reviewers',
    min_confidence_to_fix: 0,
    min_severity_to_fix: 'INFO',
  }),
  gates: GatesConfig.default({
    block_on_new_critical: true,
    block_on_new_high: false,
    max_cost_usd: 20,
    max_wall_time_minutes: 15,
  }),
  dynamic: DynamicConfig.default({
    enabled: false,
    timeout_seconds: 30,
    max_requests: 50,
    rate_limit_per_second: 2,
    max_crawl_pages: 20,
    checks: ['headers', 'cookies', 'cors', 'sensitive_paths'],
    sensitive_paths: ['/.env', '/.git/config', '/config.json', '/debug', '/swagger.json', '/openapi.json'],
    gates: {
      block_on_confirmed_critical: true,
      block_on_confirmed_high: false,
    },
  }),
  output: OutputConfig.default({
    report: './reports/report-{timestamp}.md',
    findings: './reports/findings-{timestamp}.json',
    diff: './reports/diff-{timestamp}.patch',
  }),
});
export type SecureReviewConfig = z.infer<typeof SecureReviewConfigSchema>;

export const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  ANTHROPIC_MODE: ProviderMode.default('api'),
  OPENAI_MODE: ProviderMode.default('api'),
  GOOGLE_MODE: ProviderMode.default('api'),
  CLAUDE_CLI_BIN: z.string().default('claude'),
  GEMINI_CLI_BIN: z.string().default('gemini'),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_ACTIONS: z.string().optional(), // "true" inside runners
});
export type Env = z.infer<typeof EnvSchema>;
