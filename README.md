# secure-review

**Multi-model security review for AI-generated code.** CLI and GitHub Action that runs several LLM reviewers (Anthropic, OpenAI, Google) and SAST tools (Semgrep, ESLint, npm audit) against your codebase. Findings are aggregated across reviewers — overlap becomes a confidence signal. Two modes: `review` (report only, PR comments) and `fix` (writer applies fixes in a cross-model rotating loop).

Built for the ETH Case Studies seminar *"Secure Code despite AI"* (252-3811-00L). The design is grounded in recent LLM-security research showing that (1) SAST alone is nearly blind to AI-generated code, and (2) same-model self-review loops often regress (see *Research context* below). The tool operationalizes the cross-model-review pattern the industry uses informally.

## Why this, not GitHub Copilot PR review?

| | GitHub Copilot code review | secure-review |
|---|---|---|
| Models | 1 (OpenAI via Copilot) | N, any provider |
| Security-specialized | No (general quality) | Yes (skill-configurable) |
| Agreement signal across models | No | Yes |
| SAST integrated with AI | No | Yes (Semgrep + ESLint + npm audit) |
| Provider-agnostic | No (Copilot only) | Yes |
| Empirical justification | Marketing | Grounded in LLM-security research (see below) |

## Quick start — CLI

```bash
npm install --save-dev secure-review
npx secure-review init        # interactive scaffold: .secure-review.yml + .env
# edit .env — paste your API keys (or skip this step if you set --yes during init)
npx secure-review review ./src
```

`.env` in the current directory is auto-loaded — no `source .env` needed.

`init` asks a few yes/no questions (which providers, enable SAST, enter keys now or later) and drops a working config + env file. Use `--yes` to skip the prompts and accept all defaults.

### Other CLI subcommands

| Command | Purpose |
|---|---|
| `secure-review init` | Scaffold `.secure-review.yml` + `.env` (interactive) |
| `secure-review scan <path>` | SAST only — no AI calls, no API keys needed |
| `secure-review review <path>` | Multi-model review, no file changes |
| `secure-review fix <path>` | Iterative review → write → re-review loop |
| `secure-review pr` | GitHub Action entry point (called by the workflow) |

## Quick start — GitHub Action

```yaml
# .github/workflows/secure-review.yml
name: Secure Review
on: pull_request
permissions:
  contents: read
  pull-requests: write
  checks: write
jobs:
  review:
    runs-on: ubuntu-latest
    if: github.event.pull_request.head.repo.fork == false
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: fonCki/secure-review@v1
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY:    ${{ secrets.OPENAI_API_KEY }}
          GOOGLE_API_KEY:    ${{ secrets.GOOGLE_API_KEY }}
          GITHUB_TOKEN:      ${{ secrets.GITHUB_TOKEN }}
```

Open a PR — a single review is posted with one line-anchored comment per finding.

## Config (`.secure-review.yml`)

```yaml
writer:
  provider: anthropic
  model: claude-sonnet-4-6
  skill: skills/secure-node-writer.md

reviewers:
  - name: codex-web-sec
    provider: openai
    model: gpt-5-codex
    skill: skills/web-sec-reviewer.md
  - name: sonnet-owasp
    provider: anthropic
    model: claude-sonnet-4-6
    skill: skills/owasp-reviewer.md
  - name: gemini-dependencies
    provider: google
    model: gemini-2.5-pro
    skill: skills/dependency-reviewer.md

sast:
  enabled: true
  tools: [semgrep, eslint, npm_audit]
  inject_into_reviewer_context: true   # reviewers see SAST findings

review:
  parallel: true

fix:
  mode: sequential_rotation             # reviewers[N % len] each iteration
  max_iterations: 3
  final_verification: all_reviewers

gates:
  block_on_new_critical: true
  max_cost_usd: 20
  max_wall_time_minutes: 15
```

Every reviewer is a `{provider, model, skill}` triple. Skills are Markdown files defining the reviewer's role (web-sec pen-tester, OWASP auditor, supply-chain specialist, etc.). Write your own by copying `skills/*.md`.

## Environment

```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_API_KEY=...

# Local dev: use the provider's CLI binary instead of API (Claude Max / Gemini CLI subscription).
# GitHub Actions runners: must be api (factory refuses cli mode in runners).
ANTHROPIC_MODE=api        # api | cli
OPENAI_MODE=api           # api only
GOOGLE_MODE=api           # api | cli

# For `secure-review pr`
GITHUB_TOKEN=...
```

## Modes

### `review` — no mutation

Each reviewer runs in parallel. SAST runs alongside. Findings are deduped by `{file, line-bucket, CWE}` — overlapping findings merge, and `reportedBy` accumulates names. Confidence = `min(1, |reportedBy| / 3)`, so a finding flagged by 2 of 3 reviewers is high-confidence.

```bash
secure-review review ./src
```

Output: `reports/review-<timestamp>.md` (human-readable) and `reports/review-<timestamp>.json` (Condition-D-compatible evidence JSON — plots directly against the experiment baselines).

### `fix` — cross-model rotating loop

```bash
secure-review fix ./src --max-iterations 3 --max-cost-usd 20
```

1. Initial scan (reviewer[0] + SAST).
2. Iteration N: reviewer[N % len] reviews → aggregate with fresh SAST → Writer applies fixes → reviewer re-reviews fixed code → diff.
3. Gates: halts on new-critical-introduced, cost cap, or wall-time cap.
4. Final verification pass by all reviewers.

This is the cross-model rotating loop: each iteration a different reviewer audits the writer's output, reducing the blind-spot overlap you get from single-model self-review.

### `pr` — GitHub Action entrypoint

Runs `review` mode on the PR diff, posts a single review with line-anchored comments. Fork PRs are skipped by default (they don't have secret access). Fails the check if any CRITICAL finding overlaps a changed line.

### `scan` — SAST only

```bash
secure-review scan ./src
```

Runs Semgrep + ESLint + npm audit with the same normalization as the AI reviewers use. No API calls.

## Architecture

```
┌────────────────────────────────────────────┐
│  CLI  (cli.ts — commander)                 │
├────────────────────────────────────────────┤
│  Modes                                      │
│    review.ts  → parallel reviewers + SAST  │
│    fix.ts     → rotating loop + writer     │
├────────────────────────────────────────────┤
│  Roles                                      │
│    reviewer.ts  → prompt → adapter → JSON  │
│    writer.ts    → fix prompt → file edits  │
├────────────────────────────────────────────┤
│  Adapters (ModelAdapter interface)          │
│    anthropic-api · anthropic-cli           │
│    openai-api                              │
│    google-api · google-cli                 │
├────────────────────────────────────────────┤
│  SAST wrappers                              │
│    semgrep · eslint · npm-audit            │
│                                             │
│  Aggregator                                 │
│    dedup by {file, line//10, cwe}          │
│    union reportedBy → confidence            │
│                                             │
│  Gates                                      │
│    new-critical · cost · wall-time         │
│                                             │
│  Reporters                                  │
│    markdown · json (cond-D) · github-pr    │
└────────────────────────────────────────────┘
```

## Evidence JSON

Every run emits a self-contained JSON with per-iteration counts and severity breakdowns — suitable for plotting, diffing across runs, or feeding into dashboards:

```json
{
  "task_id": "01-auth",
  "tool": "secure-review",
  "condition": "F-fix",
  "run": 1,
  "total_findings_initial": 12,
  "findings_by_severity_initial": { "CRITICAL": 1, "HIGH": 3, "MEDIUM": 5, "LOW": 2, "INFO": 1 },
  "total_findings_after_fix": 4,
  "findings_by_severity_after_fix": { "CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 1, "INFO": 0 },
  "new_findings_introduced": 1,
  "findings_resolved": 9,
  "resolution_rate_pct": 75.0,
  "per_iteration": [...]
}
```

The same JSON is produced by both `review` and `fix` modes — a single schema for the whole tool.

## Developing

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build            # library (dist/)
pnpm build:action     # Action bundle (dist-action/index.js) — commit with PRs that touch src/
```

## Research context

This tool is the Phase 5 deliverable for:

- *Case Studies from Practice Seminar FS2026* (ETH Zurich 252-3811-00L)
- Team: Alfonso Pedro Ridao, Shana Stampfli
- Supervisor: Ilya Vasilenko

Prior work cited in the design:
- Alrashedy et al. 2024 — "Can LLMs Patch Security Issues?" (external-feedback loops beat self-feedback by 17.6%)
- Ullah et al. 2024 — "LLMs Cannot Reliably Identify Vulnerabilities"
- Huang et al. 2024 (NeurIPS) — "LLMs Cannot Self-Correct Reasoning Yet"
- Pearce et al. 2021 — "Assessing Security of Copilot Code"

## License

MIT © 2026 Alfonso Pedro Ridao
