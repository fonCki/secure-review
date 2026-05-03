import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { estimateCost } from '../util/cost.js';
import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';

/**
 * Shells out to `claude -p` for local development. Uses Claude CLI's
 * --output-format stream-json to capture usage data. Local-dev only:
 * the factory refuses this adapter inside GitHub Actions runners.
 */
export class AnthropicCLIAdapter implements ModelAdapter {
  readonly provider = 'anthropic' as const;
  readonly mode = 'cli' as const;

  constructor(
    readonly model: string,
    private readonly binary: string = 'claude',
  ) {}

  async complete(input: CompleteInput): Promise<CompleteOutput> {
    const started = Date.now();
    // Use --bare to strip Claude Code's default coder system prompt (which
    // would otherwise cause the model to respond with prose explanation
    // rather than the JSON we request). --system-prompt replaces the system
    // block with our reviewer instructions. The user prompt goes on stdin.
    const sanitizedSystem = sanitizeCliArg(input.system);
    const args = [
      '-p',
      '--bare',
      '--system-prompt',
      sanitizedSystem,
      '--output-format',
      'json',
      '--model',
      this.model,
    ];
    const result = await runCli(this.binary, args, input.user);
    let text = result.stdout;
    let inputTokens = 0;
    let outputTokens = 0;
    let costFromCli: number | undefined;
    try {
      const parsed = JSON.parse(result.stdout) as unknown;
      const validated = parseCliOutput(parsed);
      if (validated !== null) {
        if (validated.result) text = validated.result;
        inputTokens = validated.usage?.input_tokens ?? 0;
        outputTokens = validated.usage?.output_tokens ?? 0;
        costFromCli = validated.total_cost_usd;
      }
    } catch {
      // Not JSON — treat raw stdout as text, estimate cost from length
      inputTokens = Math.ceil(input.user.length / 4);
      outputTokens = Math.ceil(text.length / 4);
    }
    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        costUSD: costFromCli ?? estimateCost(this.model, inputTokens, outputTokens),
      },
      durationMs: Date.now() - started,
      raw: result,
    };
  }
}

const CliUsageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
});

const CliResultEntrySchema = z.object({
  type: z.string().optional(),
  result: z.string().optional(),
  total_cost_usd: z.number().optional(),
  usage: CliUsageSchema.optional(),
});

type CliResultEntry = z.infer<typeof CliResultEntrySchema>;

function parseCliOutput(parsed: unknown): CliResultEntry | null {
  if (Array.isArray(parsed)) {
    const entry = (parsed as unknown[]).find(
      (e) => typeof e === 'object' && e !== null && (e as Record<string, unknown>)['type'] === 'result',
    );
    if (entry === undefined) return null;
    return CliResultEntrySchema.parse(entry);
  }
  if (typeof parsed === 'object' && parsed !== null) {
    return CliResultEntrySchema.parse(parsed);
  }
  return null;
}

/**
 * Strip control characters that could be misinterpreted by the CLI binary
 * when passed as a command-line argument.
 */
function sanitizeCliArg(value: string): string {
  // Remove null bytes and other control characters except common whitespace
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Validate that the binary path is safe to execute:
 * - Must be a non-empty string
 * - Must not contain shell metacharacters
 * - If it is an absolute path, it must exist on disk
 */
function validateBinaryPath(bin: string): void {
  if (!bin || typeof bin !== 'string') {
    throw new Error('CLI binary path must be a non-empty string');
  }
  // Disallow shell metacharacters and path traversal
  if (/[;&|`$(){}\[\]<>!#\\"'\s]/.test(bin)) {
    throw new Error(`CLI binary path contains disallowed characters: ${bin}`);
  }
  // If absolute path, verify it exists
  if (bin.startsWith('/') && !existsSync(bin)) {
    throw new Error(`CLI binary not found at path: ${bin}`);
  }
}

function runCli(bin: string, args: string[], stdin: string): Promise<CliResult> {
  validateBinaryPath(bin);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => rejectPromise(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr, exitCode: 0 });
      } else {
        rejectPromise(
          new Error(`CLI ${bin} exited ${code ?? 'null'}: ${stderr || stdout || '(no output)'}`,
          ),
        );
      }
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}
