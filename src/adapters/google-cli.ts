import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { estimateCost } from '../util/cost.js';
import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';

/**
 * Shells out to `gemini -p <prompt>` for local development. The gemini CLI
 * takes the prompt as the argument to -p (not stdin). Loading noise goes
 * to stderr; the model response goes to stdout.
 *
 * Local-dev only — the factory refuses this adapter inside GitHub Actions.
 */
export class GoogleCLIAdapter implements ModelAdapter {
  readonly provider = 'google' as const;
  readonly mode = 'cli' as const;

  constructor(
    readonly model: string,
    private readonly binary: string = 'gemini',
  ) {}

  async complete(input: CompleteInput): Promise<CompleteOutput> {
    const started = Date.now();
    const sanitizedSystem = sanitizeCliArg(input.system);
    const sanitizedUser = sanitizeCliArg(input.user);
    const combined = `${sanitizedSystem}\n\n---\n\n${sanitizedUser}`;
    // gemini -p takes the prompt as a positional argument. Text output
    // goes to stdout; status/loading noise goes to stderr.
    const args = ['-p', combined, '-m', this.model];
    const result = await runCli(this.binary, args);
    const text = result.stdout.trim();
    const inputTokens = Math.ceil(combined.length / 4);
    const outputTokens = Math.ceil(text.length / 4);
    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        costUSD: estimateCost(this.model, inputTokens, outputTokens),
      },
      durationMs: Date.now() - started,
      raw: result,
    };
  }
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Strip or reject characters that could be interpreted as shell metacharacters
 * or argument injections by the underlying CLI binary.
 */
function sanitizeCliArg(value: string): string {
  // Remove null bytes and other control characters except common whitespace
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
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

function runCli(bin: string, args: string[]): Promise<CliResult> {
  validateBinaryPath(bin);
  return new Promise((resolvePromise, rejectPromise) => {
    // Use shell:false + explicit args to avoid quoting issues. ARG_MAX on
    // macOS is 256KB which covers our 120KB code-context cap.
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
          new Error(`CLI ${bin} exited ${code ?? 'null'}: ${stderr.slice(-500) || stdout.slice(-500) || '(no output)'}`,
          ),
        );
      }
    });
  });
}
