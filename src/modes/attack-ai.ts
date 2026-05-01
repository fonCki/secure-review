import { z } from 'zod';
import { getAdapter } from '../adapters/factory.js';
import type { ModelAdapter, Usage } from '../adapters/types.js';
import type { Env, ModelRef, Provider, SecureReviewConfig } from '../config/schema.js';
import { loadSkill, resolveSkillPath } from '../config/load.js';
import { extractJson } from '../findings/parse.js';
import { severityBreakdown } from '../findings/aggregate.js';
import type { Finding, SeverityBreakdown } from '../findings/schema.js';
import { readSourceTree, serializeCodeContext } from '../util/files.js';
import { log } from '../util/logger.js';
import { mergeAuthHeaders } from '../util/request-headers.js';

export interface AttackAiModeInput {
  root: string;
  config: SecureReviewConfig;
  configDir: string;
  env: Env;
  targetUrl?: string;
  timeoutSeconds?: number;
  maxRequests?: number;
  maxCrawlPages?: number;
  rateLimitPerSecond?: number;
  attackerAdapter?: ModelAdapter;
  /** Preloaded skill body (test seam); if unset, skill is loaded from merged ref's skill path. */
  attackerSkill?: string;
  /**
   * Override attacker model vs `dynamic.attacker` / `writer` (CLI or API).
   * Unspecified fields still come from config (so you can set only `--attack-model`
   * and keep the provider from YAML).
   */
  attackerProvider?: Provider;
  attackerModel?: string;
  /** Skill path relative to config dir or absolute; overrides merged ref.skill when set. */
  attackerSkillPath?: string;
  /** Merged over `dynamic.auth_headers` for crawl, healthcheck, and probes. */
  authHeaders?: Record<string, string>;
}

export interface AttackAiPage {
  url: string;
  status: number;
  title?: string;
  links: string[];
  forms: AttackAiForm[];
}

export interface AttackAiForm {
  action: string;
  method: 'GET' | 'POST';
  fields: string[];
}

export type AttackAiProbeCategory =
  | 'reflected_input'
  | 'error_disclosure'
  | 'open_redirect'
  | 'path_exposure';

export interface AttackAiHypothesis {
  id: string;
  category: AttackAiProbeCategory;
  severity: Finding['severity'];
  title: string;
  rationale: string;
  path: string;
  method: 'GET' | 'POST';
  parameter?: string;
  sourceFile?: string;
  lineStart?: number;
  remediation?: string;
}

export interface AttackAiProbeResult {
  hypothesisId: string;
  category: AttackAiProbeCategory;
  url: string;
  method: 'GET' | 'POST';
  status?: number;
  confirmed: boolean;
  durationMs: number;
  evidence: Record<string, unknown>;
  error?: string;
}

export interface AttackAiModeOutput {
  targetUrl: string;
  pages: AttackAiPage[];
  hypotheses: AttackAiHypothesis[];
  probes: AttackAiProbeResult[];
  findings: Finding[];
  breakdown: SeverityBreakdown;
  gateBlocked: boolean;
  gateReasons: string[];
  usage: Usage;
  totalCostUSD: number;
  totalDurationMs: number;
  limits: {
    maxRequests: number;
    maxCrawlPages: number;
    rateLimitPerSecond: number;
  };
  /** Effective attacker identity after merging config + CLI/API overrides. */
  attacker: { provider: string; model: string; skillPath: string };
}

interface ProbeResponse {
  url: string;
  method: 'GET' | 'POST';
  status: number;
  headers: Headers;
  bodySnippet: string;
  durationMs: number;
}

const MARKER_PREFIX = 'secure-review-probe';
const UNTRUSTED_REDIRECT = 'https://secure-review.invalid/redirect-target';
const ATTACKER_NAME = 'attack-ai';
const optionalStringFromModel = z.preprocess((value) => (value === null ? undefined : value), z.string().optional());
const optionalNumberFromModel = z.preprocess((value) => (value === null ? undefined : value), z.number().int().min(0).optional());

const RawHypothesisSchema = z.object({
  id: optionalStringFromModel,
  category: z.enum(['reflected_input', 'error_disclosure', 'open_redirect', 'path_exposure']),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).default('MEDIUM'),
  title: z.string().min(1),
  rationale: z.string().min(1),
  path: z.string().min(1),
  method: z.preprocess((value) => (value === null ? undefined : value), z.enum(['GET', 'POST']).default('GET')),
  parameter: optionalStringFromModel,
  sourceFile: optionalStringFromModel,
  lineStart: optionalNumberFromModel,
  remediation: optionalStringFromModel,
});

const HypothesisPayloadSchema = z
  .object({ hypotheses: z.array(RawHypothesisSchema).default([]) })
  .or(z.array(RawHypothesisSchema));

export async function runAttackAiMode(input: AttackAiModeInput): Promise<AttackAiModeOutput> {
  const started = Date.now();
  const dynamic = input.config.dynamic;
  const targetUrl = normalizeTargetUrl(input.targetUrl ?? dynamic.target_url);
  const timeoutMs = (input.timeoutSeconds ?? dynamic.timeout_seconds) * 1000;
  const maxRequests = input.maxRequests ?? dynamic.max_requests;
  const maxCrawlPages = input.maxCrawlPages ?? dynamic.max_crawl_pages;
  const rateLimitPerSecond = input.rateLimitPerSecond ?? dynamic.rate_limit_per_second;
  const budget = new RequestBudget(maxRequests, rateLimitPerSecond);
  const authHeaders = mergeAuthHeaders(dynamic.auth_headers, input.authHeaders);

  log.header(`AI attack mode — ${targetUrl}`);
  log.info(
    `Scope: same-origin only · max ${maxRequests} requests · crawl ${maxCrawlPages} page${maxCrawlPages === 1 ? '' : 's'}`,
  );

  if (dynamic.healthcheck_url) {
    const health = await safeProbe(dynamic.healthcheck_url, 'GET', timeoutMs, budget, undefined, authHeaders);
    if (!health.response || health.response.status < 200 || health.response.status >= 400) {
      throw new Error(`Healthcheck failed for ${dynamic.healthcheck_url}: ${health.error ?? `HTTP ${health.response?.status}`}`);
    }
  }

  const pages = await crawlSameOrigin(targetUrl, timeoutMs, maxCrawlPages, budget, authHeaders);
  log.info(`Crawled ${pages.length} page${pages.length === 1 ? '' : 's'}`);
  if (pages.length === 0) {
    throw new Error(
      `AI attack target was not reachable at ${targetUrl}. No pages were crawled; verify the app is running and the URL/port are correct.`,
    );
  }

  const files = await readSourceTree(input.root, 80_000);
  const mergedRef = mergeAttackerRef(input);
  const attacker = await resolveAttacker(input, mergedRef);
  const planned = await planHypotheses({
    targetUrl,
    pages,
    files,
    adapter: attacker.adapter,
    skill: attacker.skill,
    maxTokens: attacker.maxTokens,
  });
  const hypotheses = sanitizeHypotheses(planned.hypotheses, targetUrl).slice(0, remainingProbeSlots(budget));
  log.info(`Model proposed ${planned.hypotheses.length}; executing ${hypotheses.length} safe same-origin probe${hypotheses.length === 1 ? '' : 's'}`);

  const probes: AttackAiProbeResult[] = [];
  const findings: Finding[] = [];
  let nextId = 1;
  for (const hypothesis of hypotheses) {
    const result = await executeHypothesis(hypothesis, targetUrl, timeoutMs, budget, authHeaders);
    probes.push(result);
    if (result.confirmed) {
      findings.push(findingFromProbe(hypothesis, result, nextId));
      nextId += 1;
    }
    if (remainingProbeSlots(budget) <= 0) break;
  }

  const gate = evaluateGates(findings, dynamic);
  return {
    targetUrl,
    pages,
    hypotheses,
    probes,
    findings,
    breakdown: severityBreakdown(findings),
    gateBlocked: gate.blocked,
    gateReasons: gate.reasons,
    usage: planned.usage,
    totalCostUSD: planned.usage.costUSD,
    totalDurationMs: Date.now() - started,
    limits: { maxRequests, maxCrawlPages, rateLimitPerSecond },
    attacker: {
      provider: mergedRef.provider,
      model: mergedRef.model,
      skillPath: mergedRef.skill,
    },
  };
}

/** Merge `dynamic.attacker` (or writer) with optional CLI/API overrides. */
export function mergeAttackerRef(input: AttackAiModeInput): ModelRef {
  const base = input.config.dynamic.attacker ?? input.config.writer;
  return {
    ...base,
    provider: input.attackerProvider ?? base.provider,
    model: input.attackerModel?.trim() ? input.attackerModel.trim() : base.model,
    skill: input.attackerSkillPath?.trim() ? input.attackerSkillPath.trim() : base.skill,
  };
}

async function resolveAttacker(
  input: AttackAiModeInput,
  mergedRef: ModelRef,
): Promise<{
  adapter: ModelAdapter;
  skill: string;
  maxTokens?: number;
}> {
  const adapter =
    input.attackerAdapter ?? getAdapter({ provider: mergedRef.provider, model: mergedRef.model }, input.env);
  const skill =
    input.attackerSkill ?? (await loadSkill(resolveSkillPath(mergedRef.skill, input.configDir)));
  return { adapter, skill, maxTokens: mergedRef.maxTokens };
}

async function planHypotheses(input: {
  targetUrl: string;
  pages: AttackAiPage[];
  files: Awaited<ReturnType<typeof readSourceTree>>;
  adapter: ModelAdapter;
  skill: string;
  maxTokens?: number;
}): Promise<{ hypotheses: AttackAiHypothesis[]; usage: Usage }> {
  const out = await input.adapter.complete({
    system: `${input.skill}

You are the authorized AI attack planner for secure-review. Plan only non-destructive, same-origin probes against the provided target. Do not request credential theft, denial of service, persistence, shell execution, SSRF to third parties, destructive writes, or high-volume traffic.

Return JSON only:
{
  "hypotheses": [
    {
      "category": "reflected_input" | "error_disclosure" | "open_redirect" | "path_exposure",
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO",
      "title": "short finding title if confirmed",
      "rationale": "why this is plausible from the crawl/source",
      "path": "/same-origin-path",
      "method": "GET" | "POST",
      "parameter": "single parameter name for reflected_input/error_disclosure/open_redirect",
      "sourceFile": "optional relative source file",
      "lineStart": 0,
      "remediation": "how the writer should fix it"
    }
  ]
}`,
    user: `Target: ${input.targetUrl}

Crawled surface:
${JSON.stringify(input.pages, null, 2)}

Source context:
${serializeCodeContext(input.files, 80_000)}

Choose the smallest set of high-signal probes. Every probe will be constrained by secure-review to same-origin GET/POST with harmless marker payloads.`,
    jsonMode: true,
    maxTokens: input.maxTokens ?? 3000,
  });

  const parsed = HypothesisPayloadSchema.parse(extractJson(out.text));
  const raw = Array.isArray(parsed) ? parsed : parsed.hypotheses;
  return {
    hypotheses: raw.map((h, index) => ({
      ...h,
      id: h.id ?? `H-${String(index + 1).padStart(2, '0')}`,
    })),
    usage: out.usage,
  };
}

async function crawlSameOrigin(
  targetUrl: string,
  timeoutMs: number,
  maxPages: number,
  budget: RequestBudget,
  authHeaders: Record<string, string> | undefined,
): Promise<AttackAiPage[]> {
  const origin = new URL(targetUrl).origin;
  const queue = [targetUrl];
  const seen = new Set<string>();
  const pages: AttackAiPage[] = [];

  while (queue.length > 0 && pages.length < maxPages && budget.remaining() > 0) {
    const url = queue.shift()!;
    const normalized = normalizeUrlForVisit(url);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const probed = await safeProbe(normalized, 'GET', timeoutMs, budget, undefined, authHeaders);
    if (!probed.response) continue;
    const res = probed.response;
    const page = parsePage(res.url, res.status, res.bodySnippet, origin);
    pages.push(page);
    for (const link of page.links) {
      if (!seen.has(link) && queue.length + pages.length < maxPages) queue.push(link);
    }
  }

  return pages;
}

async function executeHypothesis(
  hypothesis: AttackAiHypothesis,
  targetUrl: string,
  timeoutMs: number,
  budget: RequestBudget,
  authHeaders: Record<string, string> | undefined,
): Promise<AttackAiProbeResult> {
  const marker = `${MARKER_PREFIX}-${hypothesis.id.toLowerCase().replace(/[^a-z0-9-]/g, '')}<sr>`;
  const started = Date.now();
  try {
    const request = buildProbeRequest(hypothesis, targetUrl, marker);
    const probed = await safeProbe(request.url, request.method, timeoutMs, budget, request.body, authHeaders);
    if (!probed.response) {
      return {
        hypothesisId: hypothesis.id,
        category: hypothesis.category,
        url: request.url,
        method: request.method,
        confirmed: false,
        durationMs: Date.now() - started,
        evidence: { marker },
        error: probed.error,
      };
    }
    const res = probed.response;
    const confirmation = confirmHypothesis(hypothesis, res, marker);
    return {
      hypothesisId: hypothesis.id,
      category: hypothesis.category,
      url: request.url,
      method: request.method,
      status: res.status,
      confirmed: confirmation.confirmed,
      durationMs: res.durationMs,
      evidence: {
        marker,
        reason: confirmation.reason,
        responseHeaders: headersObject(res.headers),
        bodySnippet: res.bodySnippet,
      },
    };
  } catch (err) {
    return {
      hypothesisId: hypothesis.id,
      category: hypothesis.category,
      url: hypothesis.path,
      method: hypothesis.method,
      confirmed: false,
      durationMs: Date.now() - started,
      evidence: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildProbeRequest(
  hypothesis: AttackAiHypothesis,
  targetUrl: string,
  marker: string,
): { url: string; method: 'GET' | 'POST'; body?: string } {
  const url = new URL(hypothesis.path, targetUrl);
  const parameter = hypothesis.parameter ?? defaultParameter(hypothesis.category);
  const value = hypothesis.category === 'open_redirect' ? UNTRUSTED_REDIRECT : marker;
  if (hypothesis.method === 'POST') {
    return {
      url: url.toString(),
      method: 'POST',
      body: new URLSearchParams({ [parameter]: value }).toString(),
    };
  }
  url.searchParams.set(parameter, value);
  return { url: url.toString(), method: 'GET' };
}

async function safeProbe(
  url: string,
  method: 'GET' | 'POST',
  timeoutMs: number,
  budget: RequestBudget,
  body?: string,
  authHeaders?: Record<string, string>,
): Promise<{ response?: ProbeResponse; error?: string }> {
  if (!(await budget.tryTake())) return { error: 'request budget exhausted' };
  const started = Date.now();
  try {
    const headers = mergeAuthHeaders(
      authHeaders,
      body ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
    );
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      ...(headers ? { headers } : {}),
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await safeText(res);
    return {
      response: {
        url,
        method,
        status: res.status,
        headers: res.headers,
        bodySnippet: redactBody(text).slice(0, 2000),
        durationMs: Date.now() - started,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function confirmHypothesis(
  hypothesis: AttackAiHypothesis,
  res: ProbeResponse,
  marker: string,
): { confirmed: boolean; reason: string } {
  const body = res.bodySnippet;
  if (hypothesis.category === 'reflected_input') {
    const reflected = body.includes(marker);
    const escaped = body.includes(escapeHtml(marker));
    return {
      confirmed: reflected && !escaped,
      reason: reflected && !escaped ? 'marker reflected unescaped in response body' : 'marker not reflected unescaped',
    };
  }
  if (hypothesis.category === 'error_disclosure') {
    const disclosed = /\b(stack trace|traceback|exception|syntaxerror|typeerror|referenceerror|sql error|database error)\b/i.test(body);
    return {
      confirmed: disclosed,
      reason: disclosed ? 'response contains runtime/database error disclosure text' : 'no error disclosure pattern observed',
    };
  }
  if (hypothesis.category === 'open_redirect') {
    const location = res.headers.get('location') ?? '';
    const confirmed = res.status >= 300 && res.status < 400 && location.startsWith(UNTRUSTED_REDIRECT);
    return {
      confirmed,
      reason: confirmed ? `redirected to untrusted location ${UNTRUSTED_REDIRECT}` : 'no redirect to untrusted location',
    };
  }
  const fallback = isLikelySpaFallback(hypothesis.path, res);
  const exposed = res.status >= 200 && res.status < 300 && body.trim().length > 0 && !fallback;
  return {
    confirmed: exposed,
    reason: exposed
      ? `path returned HTTP ${res.status} with body content`
      : fallback
        ? 'path returned a generic SPA fallback document'
        : 'path did not expose content',
  };
}

function findingFromProbe(h: AttackAiHypothesis, probe: AttackAiProbeResult, nextId: number): Finding {
  const lineStart = h.lineStart ?? 0;
  return {
    id: `A-${String(nextId).padStart(2, '0')}`,
    severity: h.severity,
    file: h.sourceFile ?? probe.url,
    lineStart,
    lineEnd: lineStart,
    title: h.title,
    description: `${h.rationale}\n\nRuntime evidence: ${String(probe.evidence.reason ?? 'probe confirmed')} at ${probe.url}.`,
    remediation: h.remediation,
    reportedBy: [ATTACKER_NAME],
    confidence: 1,
  };
}

function sanitizeHypotheses(hypotheses: AttackAiHypothesis[], targetUrl: string): AttackAiHypothesis[] {
  const origin = new URL(targetUrl).origin;
  const seen = new Set<string>();
  const out: AttackAiHypothesis[] = [];
  for (const h of hypotheses) {
    try {
      const url = new URL(h.path, targetUrl);
      if (url.origin !== origin) continue;
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (!h.path.startsWith('/') && !h.path.startsWith(origin)) continue;
      const parameter = h.parameter?.trim();
      if (h.category !== 'path_exposure' && !parameter) continue;
      if (parameter && !/^[A-Za-z0-9_.:-]{1,80}$/.test(parameter)) continue;
      const cleanPath = `${url.pathname}${url.search}`;
      const key = `${h.category}:${h.method}:${cleanPath}:${parameter ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...h, path: cleanPath, parameter });
    } catch {
      // discard invalid model output
    }
  }
  return out;
}

function parsePage(url: string, status: number, body: string, origin: string): AttackAiPage {
  return {
    url,
    status,
    title: firstMatch(body, /<title[^>]*>([\s\S]*?)<\/title>/i),
    links: sameOriginLinks(url, body, origin),
    forms: parseForms(url, body, origin),
  };
}

function sameOriginLinks(baseUrl: string, body: string, origin: string): string[] {
  const links = new Set<string>();
  for (const match of body.matchAll(/\bhref=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1] ?? '', baseUrl);
      if (url.origin === origin && (url.protocol === 'http:' || url.protocol === 'https:')) {
        url.hash = '';
        links.add(url.toString());
      }
    } catch {
      // ignore malformed hrefs
    }
  }
  return [...links];
}

function parseForms(baseUrl: string, body: string, origin: string): AttackAiForm[] {
  const forms: AttackAiForm[] = [];
  for (const match of body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = match[1] ?? '';
    const formBody = match[2] ?? '';
    const action = attr(attrs, 'action') ?? baseUrl;
    const method = ((attr(attrs, 'method') ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET') as 'GET' | 'POST';
    try {
      const url = new URL(action, baseUrl);
      if (url.origin !== origin) continue;
      const fields = [...formBody.matchAll(/\bname=["']([^"']+)["']/gi)]
        .map((m) => m[1])
        .filter((name): name is string => Boolean(name));
      forms.push({ action: url.toString(), method, fields });
    } catch {
      // ignore malformed form actions
    }
  }
  return forms;
}

function attr(attrs: string, name: string): string | undefined {
  return firstMatch(attrs, new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
}

function firstMatch(text: string, re: RegExp): string | undefined {
  const value = re.exec(text)?.[1]?.trim();
  return value ? decodeHtml(value).slice(0, 200) : undefined;
}

function evaluateGates(findings: Finding[], config: SecureReviewConfig['dynamic']): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const critical = findings.filter((f) => f.severity === 'CRITICAL').length;
  const high = findings.filter((f) => f.severity === 'HIGH').length;
  if (config.gates.block_on_confirmed_critical && critical > 0) {
    reasons.push(`${critical} confirmed CRITICAL AI attack finding${critical === 1 ? '' : 's'}`);
  }
  if (config.gates.block_on_confirmed_high && high > 0) {
    reasons.push(`${high} confirmed HIGH AI attack finding${high === 1 ? '' : 's'}`);
  }
  return { blocked: reasons.length > 0, reasons };
}

function remainingProbeSlots(budget: RequestBudget): number {
  return Math.max(0, budget.remaining());
}

function normalizeTargetUrl(raw: string | undefined): string {
  if (!raw) throw new Error('AI attack target URL required. Pass --target-url or set dynamic.target_url.');
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`AI attack target must be http(s): ${raw}`);
  return url.toString();
}

function normalizeUrlForVisit(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.toString();
}

function defaultParameter(category: AttackAiProbeCategory): string {
  if (category === 'open_redirect') return 'next';
  if (category === 'error_disclosure') return 'q';
  return 'q';
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function headersObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = key.toLowerCase() === 'set-cookie' ? '<redacted>' : value;
  });
  return out;
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

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function decodeHtml(s: string): string {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

class RequestBudget {
  private used = 0;
  private lastRequestAt = 0;

  constructor(
    private readonly maxRequests: number,
    private readonly rateLimitPerSecond: number,
  ) {}

  remaining(): number {
    return this.maxRequests - this.used;
  }

  async tryTake(): Promise<boolean> {
    if (this.used >= this.maxRequests) return false;
    const minIntervalMs = Math.ceil(1000 / this.rateLimitPerSecond);
    const waitMs = Math.max(0, this.lastRequestAt + minIntervalMs - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.used += 1;
    this.lastRequestAt = Date.now();
    return true;
  }
}
