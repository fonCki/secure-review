import type { Finding } from '../findings/schema.js';
export interface AuditResult {
    available: boolean;
    findings: Finding[];
    error?: string;
}
export declare function runNpmAudit(path: string, reviewerName?: string): Promise<AuditResult>;
//# sourceMappingURL=npm-audit.d.ts.map