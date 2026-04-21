import { spawn } from 'node:child_process';
import { estimateCost } from '../util/cost.js';
import type { CompleteInput, CompleteOutput, ModelAdapter } from './types.js';

/**
 * Shells out to `gemini -p` for local development. Local-dev only — the
 * factory refuses this adapter inside GitHub Actions runners.
 *
 * NOTE: `gemini` CLI does not currently expose token usage in its text
 * output. We estimate from char count (~4 chars/token) for bookkeeping.
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
    const args = ['-p', '-m', this.model];
    const result = await runCli(this.binary, args, combined);
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

function runCli(bin: string, args: string[], stdin: string): Promise<CliResult> {
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
          new Error(`CLI ${bin} exited ${code ?? 'null'}: ${stderr || stdout || '(no output)'}`),
        );
      }
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}
