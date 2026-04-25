/**
 * Tiny terminal spinner — no dependencies.
 *
 * Why this exists: LLM calls take 10-90s and SAST tools take a few seconds.
 * Without feedback, the terminal looks frozen and users assume the tool
 * crashed or stalled. A spinner with elapsed time makes "still working"
 * obvious at a glance.
 *
 * Behavior:
 *   - TTY: animated braille spinner with elapsed seconds, redrawn every ~80ms
 *   - non-TTY (CI, pipes, redirected output): no animation, prints a single
 *     "started" line and a single "done" line so log files stay readable
 *   - Quiet mode (--quiet): spinner suppressed entirely, only succeed/fail
 *     final lines emitted
 */
import { stderr as defaultStream } from 'node:process';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 80;

const COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  yellow: '\x1b[33m',
} as const;

let quietMode = false;

/** Called by the CLI when --quiet is passed. */
export function setSpinnerQuiet(v: boolean): void {
  quietMode = v;
}

class Spinner {
  private timer: NodeJS.Timeout | undefined;
  private frame = 0;
  private text: string;
  private readonly startedAt: number;
  private readonly tty: boolean;
  private active = false;

  constructor(text: string) {
    this.text = text;
    this.startedAt = Date.now();
    this.tty = Boolean(defaultStream.isTTY) && !process.env['CI'];
  }

  start(): this {
    if (quietMode) return this;
    this.active = true;
    if (!this.tty) {
      defaultStream.write(`  ${COLORS.cyan}…${COLORS.reset} ${this.text}\n`);
      return this;
    }
    this.render();
    this.timer = setInterval(() => this.render(), FRAME_INTERVAL_MS);
    // Don't keep the event loop alive just for the spinner.
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return this;
  }

  update(text: string): this {
    this.text = text;
    return this;
  }

  succeed(text?: string): void {
    this.stop();
    if (quietMode) return;
    const final = text ?? this.text;
    const elapsed = this.elapsedString();
    defaultStream.write(
      `  ${COLORS.green}✓${COLORS.reset} ${final} ${COLORS.gray}(${elapsed})${COLORS.reset}\n`,
    );
  }

  fail(text?: string): void {
    this.stop();
    if (quietMode) return;
    const final = text ?? this.text;
    const elapsed = this.elapsedString();
    defaultStream.write(
      `  ${COLORS.red}✗${COLORS.reset} ${final} ${COLORS.gray}(${elapsed})${COLORS.reset}\n`,
    );
  }

  warn(text?: string): void {
    this.stop();
    if (quietMode) return;
    const final = text ?? this.text;
    const elapsed = this.elapsedString();
    defaultStream.write(
      `  ${COLORS.yellow}!${COLORS.reset} ${final} ${COLORS.gray}(${elapsed})${COLORS.reset}\n`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.active && this.tty) {
      // Wipe the spinner line so the next stdout line starts clean.
      defaultStream.write('\r\x1b[2K');
    }
    this.active = false;
  }

  private render(): void {
    if (!this.active) return;
    const frame = FRAMES[this.frame % FRAMES.length] ?? '·';
    const elapsed = this.elapsedString();
    defaultStream.write(
      `\r\x1b[2K  ${COLORS.cyan}${frame}${COLORS.reset} ${this.text} ${COLORS.gray}(${elapsed})${COLORS.reset}`,
    );
    this.frame += 1;
  }

  private elapsedString(): string {
    const sec = (Date.now() - this.startedAt) / 1000;
    return sec < 60 ? `${sec.toFixed(1)}s` : `${(sec / 60).toFixed(1)}m`;
  }
}

/**
 * Wrap an async task with a spinner. Auto-handles success / failure cleanup.
 *
 * Example:
 *   const findings = await withSpinner('Reviewing with anthropic-haiku', () =>
 *     runReviewer({ ... })
 *   );
 */
export async function withSpinner<T>(
  text: string,
  task: () => Promise<T>,
  opts: { successText?: (result: T) => string; failText?: (err: unknown) => string } = {},
): Promise<T> {
  const sp = new Spinner(text).start();
  try {
    const result = await task();
    sp.succeed(opts.successText ? opts.successText(result) : undefined);
    return result;
  } catch (err) {
    sp.fail(opts.failText ? opts.failText(err) : undefined);
    throw err;
  }
}

/** For when you need finer control (e.g. parallel work tracked by counter). */
export function spinner(text: string): Spinner {
  return new Spinner(text).start();
}
