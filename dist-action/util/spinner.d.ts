/** Called by the CLI when --quiet is passed. */
export declare function setSpinnerQuiet(v: boolean): void;
declare class Spinner {
    private timer;
    private frame;
    private text;
    private readonly startedAt;
    private readonly tty;
    private active;
    constructor(text: string);
    start(): this;
    update(text: string): this;
    succeed(text?: string): void;
    fail(text?: string): void;
    warn(text?: string): void;
    stop(): void;
    private render;
    private elapsedString;
}
/**
 * Wrap an async task with a spinner. Auto-handles success / failure cleanup.
 *
 * Example:
 *   const findings = await withSpinner('Reviewing with anthropic-haiku', () =>
 *     runReviewer({ ... })
 *   );
 */
export declare function withSpinner<T>(text: string, task: () => Promise<T>, opts?: {
    successText?: (result: T) => string;
    failText?: (err: unknown) => string;
}): Promise<T>;
/** For when you need finer control (e.g. parallel work tracked by counter). */
export declare function spinner(text: string): Spinner;
export {};
//# sourceMappingURL=spinner.d.ts.map