import type { Env, SecureReviewConfig } from '../config/schema.js';
export interface BenchmarkModeInput {
    root: string;
    config: SecureReviewConfig;
    configDir: string;
    env: Env;
}
export interface WriterBenchmarkResult {
    writerName: string;
    writerModel: string;
    filesChanged: number;
    findingsResolved: number;
    findingsIntroduced: number;
    costUSD: number;
    durationMs: number;
    error?: string;
}
export interface BenchmarkModeOutput {
    initialFindingsCount: number;
    results: WriterBenchmarkResult[];
    totalDurationMs: number;
}
/**
 * Benchmark mode: runs the initial scan to get the finding set, then for each
 * configured writer runs one fix iteration, measures outcomes, and restores
 * files to the original state between runs.
 */
export declare function runBenchmarkMode(input: BenchmarkModeInput): Promise<BenchmarkModeOutput>;
/** Render the benchmark results as a markdown comparison table. */
export declare function renderBenchmarkReport(output: BenchmarkModeOutput): string;
//# sourceMappingURL=benchmark.d.ts.map