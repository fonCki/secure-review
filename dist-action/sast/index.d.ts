import type { SecureReviewConfig } from '../config/schema.js';
import type { Finding } from '../findings/schema.js';
export interface SastSummary {
    findings: Finding[];
    semgrep: {
        ran: boolean;
        count: number;
        error?: string;
    };
    eslint: {
        ran: boolean;
        count: number;
        error?: string;
    };
    npmAudit: {
        ran: boolean;
        count: number;
        error?: string;
    };
}
export declare function runAllSast(path: string, config: SecureReviewConfig['sast']): Promise<SastSummary>;
//# sourceMappingURL=index.d.ts.map