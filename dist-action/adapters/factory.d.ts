import type { Env, Provider } from '../config/schema.js';
import type { ModelAdapter } from './types.js';
export interface AdapterSpec {
    provider: Provider;
    model: string;
}
export declare function getAdapter(spec: AdapterSpec, env: Env): ModelAdapter;
//# sourceMappingURL=factory.d.ts.map