import type { Provider, ProviderMode } from '../config/schema.js';
export interface Usage {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
}
export interface CompleteInput {
    system: string;
    user: string;
    maxTokens?: number;
    /**
     * If true, adapter should nudge the model toward JSON-only output when the
     * provider supports a dedicated JSON mode. Callers are still expected to
     * parse defensively — models sometimes wrap JSON in prose.
     */
    jsonMode?: boolean;
}
export interface CompleteOutput {
    text: string;
    usage: Usage;
    durationMs: number;
    raw?: unknown;
}
/**
 * Unified surface for LLM providers. One per-model instance; stateless.
 * The reviewer/writer roles build domain-specific prompts; adapters just
 * complete them.
 */
export interface ModelAdapter {
    readonly provider: Provider;
    readonly model: string;
    readonly mode: ProviderMode;
    complete(input: CompleteInput): Promise<CompleteOutput>;
}
//# sourceMappingURL=types.d.ts.map