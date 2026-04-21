import { spawn } from 'node:child_process';
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
    const combined = `${input.system}\n\n---\n\n${input.user}`;
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

function runCli(bin: string, args: string[]): Promise<CliResult> {
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
          new Error(`CLI ${bin} exited ${code ?? 'null'}: ${stderr.slice(-500) || stdout.slice(-500) || '(no output)'}`),
        );
      }
    });
  });
}
