import { spawn } from 'node:child_process';
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
    const args = [
      '-p',
      '--bare',
      '--system-prompt',
      input.system,
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
      let resultEntry:
        | { result?: string; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } }
        | undefined;
      if (Array.isArray(parsed)) {
        resultEntry = (parsed as Array<{ type?: string }>).find(
          (e) => e.type === 'result',
        ) as typeof resultEntry;
      } else if (typeof parsed === 'object' && parsed !== null) {
        resultEntry = parsed as typeof resultEntry;
      }
      if (resultEntry?.result) text = resultEntry.result;
      inputTokens = resultEntry?.usage?.input_tokens ?? 0;
      outputTokens = resultEntry?.usage?.output_tokens ?? 0;
      costFromCli = resultEntry?.total_cost_usd;
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
