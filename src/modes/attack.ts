import type { DynamicCheck, DynamicConfig, SecureReviewConfig } from '../config/schema.js';
import { severityBreakdown } from '../findings/aggregate.js';
import type { Finding, SeverityBreakdown } from '../findings/schema.js';
import { log } from '../util/logger.js';
import { mergeAuthHeaders } from '../util/request-headers.js';

export interface AttackModeInput {
  root: string;
  config: SecureReviewConfig;
  targetUrl?: string;
  checks?: DynamicCheck[];
  timeoutSeconds?: number;
  /** Merged over `dynamic.auth_headers` (CLI / API overrides config). */
  authHeaders?: Record<string, string>;
}

export interface AttackCheckResult {
  check: DynamicCheck | 'healthcheck';
  url: string;
  method: string;
  status?: number;
  ok: boolean;
  durationMs: number;
  evidence: Record<string, unknown>;
  error?: string;
}

export interface AttackModeOutput {
  targetUrl: string;
  checks: AttackCheckResult[];
  findings: Finding[];
  breakdown: SeverityBreakdown;
  gateBlocked: boolean;
  gateReasons: string[];
  totalDurationMs: number;
}

interface ProbeResponse {
  url: string;
  method: string;
  status: number;
  headers: Headers;
  bodySnippet: string;
  durationMs: number;
}

const EVIL_ORIGIN = 'https://secure-review.invalid';

export async function runAttackMode(input: AttackModeInput): Promise<AttackModeOutput> {
  const started = Date.now();
  const config = input.config.dynamic;
  const targetUrl = normalizeTargetUrl(input.targetUrl ?? config.target_url);
  const timeoutMs = (input.timeoutSeconds ?? config.timeout_seconds) * 1000;
  const checks = input.checks ?? config.checks;

  log.header(`Attack mode — ${targetUrl}`);
  log.info(`Checks: ${checks.join(', ')} · timeout ${(timeoutMs / 1000).toFixed(0)}s`);

  const findings: Finding[] = [];
  const results: AttackCheckResult[] = [];
  let nextId = 1;
  const authHeaders = mergeAuthHeaders(config.auth_headers, input.authHeaders);

  const addFinding = (finding: Omit<Finding, 'id' | 'reportedBy' | 'confidence'>): void => {
    findings.push({
      ...finding,
      id: `D-${String(nextId).padStart(2, '0')}`,
      reportedBy: ['dynamic'],
      confidence: 1,
    });
    nextId += 1;
  };

  if (config.healthcheck_url) {
    const result = await runHealthcheck(config.healthcheck_url, timeoutMs, authHeaders);
    results.push(result);
    if (!result.ok) {
      throw new Error(`Healthcheck failed for ${config.healthcheck_url}: ${result.error ?? `HTTP ${result.status}`}`);
    }
  }

  for (const check of checks) {
    const before = findings.length;
    const result = await runCheck(check, targetUrl, timeoutMs, config, addFinding, authHeaders);
    results.push(...result);
    const added = findings.length - before;
    log.info(`  ${check}: ${added} finding${added === 1 ? '' : 's'}`);
  }

  assertAnyProbeSucceeded(results, targetUrl);

  const gate = evaluateDynamicGates(findings, config);
  return {
    targetUrl,
    checks: results,
    findings,
    breakdown: severityBreakdown(findings),
    gateBlocked: gate.blocked,
    gateReasons: gate.reasons,
    totalDurationMs: Date.now() - started,
  };
}

async function runCheck(
  check: DynamicCheck,
  targetUrl: string,
  timeoutMs: number,
  config: DynamicConfig,
  addFinding: (finding: Omit<Finding, 'id' | 'reportedBy' | 'confidence'>) => void,
  authHeaders: Record<string, string> | undefined,
): Promise<AttackCheckResult[]> {
  if (check === 'headers') return [await checkHeaders(targetUrl, timeoutMs, addFinding, authHeaders)];
  if (check === 'cookies') return [await checkCookies(targetUrl, timeoutMs, addFinding, authHeaders)];
  if (check === 'cors') return [await checkCors(targetUrl, timeoutMs, addFinding, authHeaders)];
  return checkSensitivePaths(targetUrl, timeoutMs, config.sensitive_paths, addFinding, authHeaders);
}

async function runHealthcheck(
  url: string,
  timeoutMs: number,
  authHeaders: Record<string, string> | undefined,
): Promise<AttackCheckResult> {
  const started = Date.now();
  try {
    const res = await probe(url, { timeoutMs }, authHeaders);
    return {
      check: 'healthcheck',
      url,
      method: 'GET',
      status: res.status,
      ok: res.status >= 200 && res.status < 400,
      durationMs: res.durationMs,
      evidence: { responseHeaders: headersObject(res.headers), bodySnippet: res.bodySnippet },
      error: res.status >= 200 && res.status < 400 ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return errorResult('healthcheck', url, 'GET', Date.now() - started, err);
  }
}

async function checkHeaders(
  targetUrl: string,
  timeoutMs: number,
  addFinding: (finding: Omit<Finding, 'id' | 'reportedBy' | 'confidence'>) => void,
  authHeaders: Record<string, string> | undefined,
): Promise<AttackCheckResult> {
  const started = Date.now();
  try {
    const res = await probe(targetUrl, { timeoutMs }, authHeaders);
    const headers = lowerHeaders(res.headers);
    const isHttps = new URL(targetUrl).protocol === 'https:';
    if (!headers.has('content-security-policy')) {
      addFinding(dynamicFinding('MEDIUM', targetUrl, 'Missing Content-Security-Policy header', 'The response does not include a Content-Security-Policy header, reducing protection against XSS and content injection.', 'Add a restrictive Content-Security-Policy header appropriate for the application.', 'CWE-1021'));
    }
    if (!headers.has('x-frame-options') && !frameAncestorsPresent(headers.get('content-security-policy'))) {
      addFinding(dynamicFinding('MEDIUM', targetUrl, 'Missing clickjacking protection', 'The response lacks X-Frame-Options and a CSP frame-ancestors directive, allowing framing by another origin.', 'Set X-Frame-Options: DENY/SAMEORIGIN or CSP frame-ancestors.', 'CWE-1021'));
    }
    if (headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
      addFinding(dynamicFinding('LOW', targetUrl, 'Missing X-Content-Type-Options: nosniff', 'The response does not opt out of MIME sniffing.', 'Set X-Content-Type-Options: nosniff on HTTP responses.', 'CWE-16'));
    }
    if (isHttps && !headers.has('strict-transport-security')) {
      addFinding(dynamicFinding('LOW', targetUrl, 'Missing Strict-Transport-Security header', 'HTTPS responses do not include HSTS, so browsers are not instructed to require HTTPS for future requests.', 'Set Strict-Transport-Security with an appropriate max-age and includeSubDomains policy.', 'CWE-319'));
    }
    return successResult('headers', res, { responseHeaders: headersObject(res.headers) });
  } catch (err) {
    return errorResult('headers', targetUrl, 'GET', Date.now() - started, err);
  }
}

async function checkCookies(
  targetUrl: string,
  timeoutMs: number,
  addFinding: (finding: Omit<Finding, 'id' | 'reportedBy' | 'confidence'>) => void,
  authHeaders: Record<string, string> | undefined,
): Promise<AttackCheckResult> {
  const started = Date.now();
  try {
    const res = await probe(targetUrl, { timeoutMs }, authHeaders);
    const cookies = getSetCookies(res.headers);
    for (const cookie of cookies) {
      const name = cookie.split('=', 1)[0]?.trim() || '(unnamed cookie)';
      const lower = cookie.toLowerCase();
      if (!lower.includes('httponly')) {
        addFinding(dynamicFinding('HIGH', targetUrl, `Cookie ${name} missing HttpOnly`, `Set-Cookie does not include HttpOnly: ${redactCookie(cookie)}`, 'Set HttpOnly on session and authentication cookies.', 'CWE-1004'));
      }
      if (new URL(targetUrl).protocol === 'https:' && !lower.includes('secure')) {
        addFinding(dynamicFinding('HIGH', targetUrl, `Cookie ${name} missing Secure`, `HTTPS response sets a cookie without Secure: ${redactCookie(cookie)}`, 'Set Secure on cookies sent over HTTPS.', 'CWE-614'));
      }
      if (!lower.includes('samesite=')) {
        addFinding(dynamicFinding('MEDIUM', targetUrl, `Cookie ${name} missing SameSite`, `Set-Cookie does not include SameSite: ${redactCookie(cookie)}`, 'Set SameSite=Lax or SameSite=Strict unless cross-site usage is required.', 'CWE-352'));
      }
    }
    return successResult('cookies', res, { setCookieCount: cookies.length, cookies: cookies.map(redactCookie) });
  } catch (err) {
    return errorResult('cookies', targetUrl, 'GET', Date.now() - started, err);
  }
}

async function checkCors(
  targetUrl: string,
  timeoutMs: number,
  addFinding: (finding: Omit<Finding, 'id' | 'reportedBy' | 'confidence'>) => void,
  authHeaders: Record<string, string> | undefined,
): Promise<AttackCheckResult> {
  const started = Date.now();
  try {
    const res = await probe(
      targetUrl,
      {
        timeoutMs,
        headers: { Origin: EVIL_ORIGIN, 'Access-Control-Request-Method': 'GET' },
      },
      authHeaders,
    );
    const allowOrigin = res.headers.get('access-control-allow-origin')?.trim();
    const allowCreds = res.headers.get('access-control-allow-credentials')?.trim().toLowerCase();
    if (allowOrigin === '*') {
      addFinding(dynamicFinding(allowCreds === 'true' ? 'CRITICAL' : 'HIGH', targetUrl, 'CORS allows wildcard origin', `The response to an untrusted Origin returned Access-Control-Allow-Origin: *${allowCreds === 'true' ? ' and credentials=true' : ''}.`, 'Restrict Access-Control-Allow-Origin to trusted origins only.', 'CWE-942'));
    } else if (allowOrigin === EVIL_ORIGIN) {
      addFinding(dynamicFinding(allowCreds === 'true' ? 'CRITICAL' : 'HIGH', targetUrl, 'CORS reflects untrusted origin', `The response reflected the untrusted Origin ${EVIL_ORIGIN}${allowCreds === 'true' ? ' with credentials enabled' : ''}.`, 'Validate Origin against an allow-list before reflecting it.', 'CWE-942'));
    }
    return successResult('cors', res, {
      requestHeaders: { Origin: EVIL_ORIGIN, 'Access-Control-Request-Method': 'GET' },
      responseHeaders: headersObject(res.headers),
    });
  } catch (err) {
    return errorResult('cors', targetUrl, 'GET', Date.now() - started, err);
  }
}

async function checkSensitivePaths(
  targetUrl: string,
  timeoutMs: number,
  paths: string[],
  addFinding: (finding: Omit<Finding, 'id' | 'reportedBy' | 'confidence'>) => void,
  authHeaders: Record<string, string> | undefined,
): Promise<AttackCheckResult[]> {
  const results: AttackCheckResult[] = [];
  for (const path of paths) {
    const url = new URL(path, ensureTrailingSlash(targetUrl)).toString();
    const started = Date.now();
    try {
      const res = await probe(url, { timeoutMs }, authHeaders);
      const exposed =
        res.status >= 200 &&
        res.status < 300 &&
        res.bodySnippet.trim().length > 0 &&
        !isLikelySpaFallback(path, res);
      if (exposed) {
        addFinding(dynamicFinding(sensitivePathSeverity(path), url, `Sensitive path exposed: ${path}`, `Runtime probe fetched ${path} with HTTP ${res.status}. Response snippet: ${res.bodySnippet || '(empty)'}`, 'Remove the file from the deployed artifact or block this path at the web server/router.', 'CWE-200'));
      }
      results.push(successResult('sensitive_paths', res, { path, exposed, bodySnippet: res.bodySnippet }));
    } catch (err) {
      results.push(errorResult('sensitive_paths', url, 'GET', Date.now() - started, err, { path }));
    }
  }
  return results;
}

async function probe(
  url: string,
  opts: { timeoutMs: number; headers?: Record<string, string> },
  authDefaults?: Record<string, string>,
): Promise<ProbeResponse> {
  const started = Date.now();
  const headers = mergeAuthHeaders(authDefaults, opts.headers);
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    ...(headers ? { headers } : {}),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  const text = await safeText(res);
  return {
    url,
    method: 'GET',
    status: res.status,
    headers: res.headers,
    bodySnippet: redactBody(text).slice(0, 500),
    durationMs: Date.now() - started,
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function dynamicFinding(
  severity: Finding['severity'],
  file: string,
  title: string,
  description: string,
  remediation: string,
  cwe?: string,
): Omit<Finding, 'id' | 'reportedBy' | 'confidence'> {
  return { severity, cwe, file, lineStart: 0, lineEnd: 0, title, description, remediation };
}

function evaluateDynamicGates(findings: Finding[], config: DynamicConfig): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const critical = findings.filter((f) => f.severity === 'CRITICAL').length;
  const high = findings.filter((f) => f.severity === 'HIGH').length;
  if (config.gates.block_on_confirmed_critical && critical > 0) {
    reasons.push(`${critical} confirmed CRITICAL runtime finding${critical === 1 ? '' : 's'}`);
  }
  if (config.gates.block_on_confirmed_high && high > 0) {
    reasons.push(`${high} confirmed HIGH runtime finding${high === 1 ? '' : 's'}`);
  }
  return { blocked: reasons.length > 0, reasons };
}

function normalizeTargetUrl(raw: string | undefined): string {
  if (!raw) throw new Error('Attack target URL required. Pass --target-url or set dynamic.target_url.');
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Attack target must be http(s): ${raw}`);
  return url.toString();
}

function ensureTrailingSlash(url: string): string {
  const u = new URL(url);
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.toString();
}

function successResult(check: DynamicCheck, res: ProbeResponse, evidence: Record<string, unknown>): AttackCheckResult {
  return { check, url: res.url, method: res.method, status: res.status, ok: true, durationMs: res.durationMs, evidence };
}

function assertAnyProbeSucceeded(results: AttackCheckResult[], targetUrl: string): void {
  if (results.some((result) => result.ok)) return;
  const firstError = results.find((result) => result.error)?.error ?? 'no successful HTTP response';
  throw new Error(
    `Attack target was not reachable at ${targetUrl}. All runtime probes failed before receiving a response: ${firstError}`,
  );
}

function errorResult(
  check: DynamicCheck | 'healthcheck',
  url: string,
  method: string,
  durationMs: number,
  err: unknown,
  evidence: Record<string, unknown> = {},
): AttackCheckResult {
  return { check, url, method, ok: false, durationMs, evidence, error: err instanceof Error ? err.message : String(err) };
}

function lowerHeaders(headers: Headers): Map<string, string> {
  const out = new Map<string, string>();
  headers.forEach((value, key) => out.set(key.toLowerCase(), value));
  return out;
}

function headersObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = redactHeader(key, value);
  });
  return out;
}

function frameAncestorsPresent(csp: string | undefined): boolean {
  return csp?.toLowerCase().split(';').some((part) => part.trim().startsWith('frame-ancestors')) ?? false;
}

function getSetCookies(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[]; raw?: () => Record<string, string[]> };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  if (typeof h.raw === 'function') return h.raw()['set-cookie'] ?? [];
  const single = headers.get('set-cookie');
  if (!single) return [];
  return splitCombinedSetCookie(single);
}

function splitCombinedSetCookie(header: string): string[] {
  return header.split(/,(?=\s*[^;,=\s]+=[^;]+)/).map((s) => s.trim()).filter(Boolean);
}

function redactHeader(key: string, value: string): string {
  if (key.toLowerCase() !== 'set-cookie') return value;
  return splitCombinedSetCookie(value).map(redactCookie).join(', ');
}

function redactCookie(cookie: string): string {
  return cookie.replace(/^([^=;]+)=([^;]*)/, (_match, name: string) => `${name}=<redacted>`);
}

function redactBody(body: string): string {
  return body
    .replace(/([A-Z0-9_]*TOKEN[A-Z0-9_]*\s*=\s*)[^\s"'`]+/gi, '$1<redacted>')
    .replace(/([A-Z0-9_]*SECRET[A-Z0-9_]*\s*=\s*)[^\s"'`]+/gi, '$1<redacted>')
    .replace(/([A-Z0-9_]*KEY[A-Z0-9_]*\s*=\s*)[^\s"'`]+/gi, '$1<redacted>');
}

function isLikelySpaFallback(path: string, res: ProbeResponse): boolean {
  const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('text/html')) return false;
  const body = res.bodySnippet.toLowerCase();
  if (!body.includes('<!doctype html') && !body.includes('<html')) return false;
  if (body.includes('/@vite/client') || body.includes('/@react-refresh')) return true;

  const suspiciousFilePath = /\.[a-z0-9]{2,8}$/i.test(path);
  if (suspiciousFilePath) return true;

  return (
    body.includes('id="root"') ||
    body.includes("id='root'") ||
    body.includes('type="module"') ||
    body.includes("type='module'")
  );
}

function sensitivePathSeverity(path: string): Finding['severity'] {
  if (path === '/.env' || path === '/.git/config') return 'CRITICAL';
  if (path.includes('config') || path.includes('debug')) return 'HIGH';
  return 'MEDIUM';
}
