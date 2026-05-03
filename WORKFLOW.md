# Workflow

How `secure-review` actually executes each mode. Pseudo-code matches the source — every step here corresponds to real code in `src/modes/` and `src/roles/`.

**Layer 4** (live HTTP probes, ZAP/Nuclei, `attack` / `attack-ai` CLIs) is implemented in the sibling package **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)**, not in this repo. The sections below that describe those flows are retained as methodology reference until they are fully relocated.

> The design choices in this tool are direct responses to failure modes measured in [`secure-code-despite-ai`](https://github.com/fonCki/secure-code-despite-ai). If something looks over-engineered, the next section explains which experimental finding motivates it.

---

## Why this design exists

`secure-review` is a direct response to four findings from [`secure-code-despite-ai`](https://github.com/fonCki/secure-code-despite-ai) — a controlled experiment (96 runs: 2 AI tools × 4 tasks × 3 runs × 4 conditions) that measured how well teams can validate AI-generated code with the tools available today. Each of the four design choices below maps to a specific failure mode that experiment surfaced.

| Empirical finding | Design response in `secure-review` |
|---|---|
| **F1 — SAST is nearly blind on AI-generated code.** Semgrep found 0 code-level vulnerabilities in 23 of 24 baseline runs (547 rules across JS/TS/Node.js/OWASP). ESLint Security was mostly false positives. | SAST is treated as **prior context** for AI readers, not as the driver. `inject_into_reviewer_context: true` tells readers *"here's what static rules saw — focus on what they miss."* |
| **F2 — Naive scan→fix→scan loops do not converge.** In 4 of 6 Claude Code Condition C runs, the third iteration had *more* findings than the second. LOC grew 33–86%. | `fix` mode requires **N consecutive clean iterations** by *different* readers (`consecutiveCleanIters >= N`), gates on `block_on_new_critical`, and bounds work via `max_iterations`, `max_cost_usd`, and `max_wall_time_minutes`. Convergence is enforced, not assumed. |
| **F3 — Single-model review-then-fix has a low resolution rate.** Independent AI review found 24–43 real issues per run, but resolution after the same agent's fix was 0–54%, occasionally negative. | **Cross-model rotating verifier** + **final verification with `all_reviewers`**. A single model "satisfying itself" is exactly the failure mode F3 measured. |
| **The research question** explicitly cites *"without overwhelming developers with false positives."* | Aggregation is FP-control machinery: 10-line bucketing per `{file, line-bucket}` so cross-model relabelings of the same bug merge instead of double-counting, `confidence = min(1, \|reportedBy\| / 3)` so single-source noise is visibly downweighted, and an optional baseline file (`.secure-review-baseline.json`) lets users mark known-acceptable findings so they stop appearing in subsequent runs. See [§ False positives](#false-positives). |

The rest of this document describes *what* the tool does. The two cross-cutting concerns this design exists to address — false-positive suppression and convergence — get dedicated sections at the end.

---

## Mapping to experiment conditions

For readers arriving from `secure-code-despite-ai`, here is how the four modes map to the experimental conditions and the defense-in-depth pipeline (Section 11 of the protocol).

| `secure-review` mode | Experiment condition | Pipeline layer | Notes |
|---|---|---|---|
| `scan` | **B** (SAST-only) | Layer 2 | Per F1, intentionally insufficient on its own — useful as fast triage, not as a security gate. |
| `review` | **D** (review phase), generalized to N models | Layers 2–3 (review only) | One-shot multi-model review. Adds the multi-reader union + confidence scoring that single-agent Condition D lacked. |
| `fix` | **D** (full review → fix → re-review) | Layers 2–3 | Operationalizes Condition D's loop with the rotation + convergence guards motivated by F2 and F3. |
| `pr` | The protocol's *"running on every commit"* requirement | Layers 2–3, gated | Operationalizes the research question's commit-time validation, scoped to the PR diff (static review only in core). |
| `attack` / `attack-ai` | Layer-4 extension | Layer 4 | Provided by **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)** — deterministic probes and AI-planned probes vs a live URL. |

Layer 4 is intentionally separate from static review and ships in **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)**.

---

## Roles

Two distinct roles. They never overlap.

| Role | Reads code? | Edits files? | Count |
|---|---|---|---|
| **Reader** (reviewer) | Yes — analyzes files, reports findings | **No** | 1..N (configured) |
| **Writer** | Reads code as context | **Yes — the only role that modifies files** | Exactly 1 |

A "reader" and a "writer" can be the **same model** with different system prompts (skills) — they're distinct *roles*, not distinct models. In the default config, OpenAI `gpt-4o-mini` appears once as a reader (with `web-sec-reviewer.md` skill) and could appear again as the writer (with `secure-node-writer.md` skill). Different jobs, same brain.

### Terms used throughout this doc

The doc uses three closely-related words for the same underlying actor — they're not synonyms by accident, each one means something specific:

| Term | Where it appears | What it refers to |
|---|---|---|
| **Reader** | Role tables, narrative prose, diagrams | The role: a model that scans code and reports findings, never edits files. |
| **Reviewer** | Config keys (`reviewers:` in `.secure-review.yml`), function names like `pickReviewer()` | The configured-list term. The `reviewers:` array in YAML is the list of readers. |
| **Verifier** | `fix`-mode pseudocode | The specific reader chosen to audit a given iteration in `fix` mode (rotates per `config.fix.mode`). |

Plus two dataflow terms used in the `fix`-mode pseudocode:

- **`currentFindings`**: the writer's to-do list for the next iteration — initially the union scan output, then the latest verifier+SAST aggregate.
- **Final verification**: a post-loop scan (optional) that re-runs *all* readers in parallel as a safety net against single-verifier blind spots.

---

## `scan` mode — SAST only

The simplest mode. No LLM calls, no API keys required.

![scan mode: secure-review scan runs runAllSast through semgrep, eslint, npm audit, then prints a JSON summary](docs/images/scan-mode.png)

<details><summary>Pseudo-code</summary>

```
1. Load `.secure-review.yml` and pass the requested path to `runAllSast`
2. Run each enabled SAST tool sequentially (in src/sast/index.ts order):
     - semgrep (auto config)
     - eslint  (via `npx --no-install eslint --format json <path>`)
     - npm audit (with the requested path as cwd)
3. Normalize each tool's output to the unified Finding schema
4. Print summary as JSON to stdout; no report file written
```
</details>

> SAST tools run sequentially rather than in parallel — they're typically I/O- and CPU-light, the orchestration overhead of `Promise.all` rarely pays off, and sequential execution makes failure attribution easier.

Use it when you want a fast, free, AI-free triage.

---

## `review` mode — multi-model parallel one-shot

SAST runs first, then every reader scans the same code. Findings are merged by `{file, line-bucket}` — overlapping findings at the same location merge regardless of CWE or title (different models routinely assign different CWEs to the same underlying bug, so including either field would inflate apparent disagreement). Confidence per finding is `min(1, |reportedBy| / 3)` so a finding flagged by 2 of 3 reporters is high-confidence.

![review mode: readSourceTree and runAllSast feed reviewer calls, aggregate, and review reports](docs/images/review-mode.png)

<details><summary>Pseudo-code</summary>

```
1. Read source tree
2. Run all SAST tools (sequential — semgrep, then eslint, then npm-audit)
3. Start reviewer calls. If config.review.parallel == true (default), readers
   run in parallel via Promise.all; if false, they run one at a time in the
   configured order. Each reader receives:
                    - the code
                    - the SAST findings as prior context (if config.sast.inject_into_reviewer_context)
                    - its own role-specific skill prompt
4. Aggregate:
     allFindings = union(reader_A.findings,
                         reader_B.findings,
                         reader_C.findings,
                         SAST.findings)
     deduped     = group by {file, line-bucket}        # CWE/title NOT in the key
                   merge overlaps; reportedBy = union of names
                   confidence = min(1, |reportedBy| / 3)
5. Apply baseline (if `.secure-review-baseline.json` is present or `--baseline` set):
     suppressed = findings whose fingerprint is in the baseline → excluded from
                  the headline `findings` array but kept on the output for
                  transparency (count surfaced in logs and the report)
6. Write report (markdown + JSON evidence)
```
</details>

**Output**: `reports/review-<timestamp>.{md,json}`. No file mutations.

**When to use**: any time you want a security report on a codebase without changing it. Cheapest mode that uses LLMs.

---

## `fix` mode — cross-model rotating loop (REDESIGNED in 0.5.0)

The mode that does the actual work of fixing security issues. It uses **rotation across iterations** so the writer can never settle into "code that satisfies one specific model" — every iteration a different reader audits with fresh eyes / different blind spots.

> **0.5.0+ semantics** — if you read older docs (or a fork on an older version), the fix-mode loop worked differently before. See [CHANGELOG.md](CHANGELOG.md) for the migration notes. The pseudo-code below describes 0.5.0+ only.

### High-level: all three phases at a glance

![fix mode loop: initial union scan, iteration loop with writer/verifier/gates, and final verification](docs/images/fix-mode-loop.png)

### Phase 1: Initial union scan

![initial union scan: source tree feeds SAST and parallel readers, then aggregate produces currentFindings](docs/images/initial-union-scan.png)

<details><summary>Pseudo-code</summary>

```
SAST(root)                           # sequential SAST tools
initialFindings = aggregate(
    reader_A.review(files) +         # readers run in PARALLEL (Promise.all)
    reader_B.review(files) +
    reader_C.review(files) +
    SAST.findings
)
currentFindings = initialFindings    # ← becomes the writer's iter-1 to-do list
                                     # (so no reader's blind spots get a free pass)
```
</details>

> SAST runs sequentially before the parallel reader fan-out. Readers always run in parallel in `fix` mode (no opt-out), so the `config.review.parallel` flag has no effect here.

> Gates are also evaluated **once after the initial scan** (before entering the loop) and **once after final verification** — not only inside the iteration loop. So a cost/wall-time/critical-introduced violation can short-circuit fix mode at any of three points: post-initial-scan, mid-loop, or post-final-verification.

### Phase 2: Iteration loop

#### One iteration in time

![one fix iteration: currentFindings, source read, SAST before, writer, SAST after, rotating verifier, aggregate and gates](docs/images/fix-iteration.png)

#### Rotation across iterations (sequential_rotation, N=3)

![reviewer rotation: sequential_rotation verifies with Reader A, Reader B, Reader C, then wraps](docs/images/reviewer-rotation.png)

The writer is always the same model (configured in `writer:`). Only the verifier rotates. With `max_iterations >= N`, every reader audits at least once — guaranteeing cross-model coverage.

<details><summary>Pseudo-code</summary>

```
let consecutiveCleanIters = 0
let N = number of readers

for i in 0 .. (max_iterations - 1):
    # Rotation policy (config.fix.mode):
    #   "sequential_rotation" (default): verifier = readers[i % N]
    #   "parallel_aggregate":             verifier = readers[0]   # always first; no rotation
    verifier = pickReviewer(readers, i, config.fix.mode)

    # Step A: Writer applies fixes (writer is fixed; same model every iteration)
    if currentFindings.length > 0:
        writerRun = writer.fix(currentFindings)   # writes files with sanitization
                                                  # (NUL replaced; other controls stripped)
    # else: skip writer call; verifier still runs to confirm clean state

    # Step B: Verifier audits (rotating reader = fresh eyes)
    sastAfter   = run all SAST tools
    afterFiles  = re-read source tree
    verifierRun = verifier.review(afterFiles, prior=sastAfter.findings)

    findingsAfter = aggregate(verifierRun + sastAfter)
    findingsAfter = applyBaseline(findingsAfter, baseline).kept    # FP suppression
    findingsAfter = registry.annotate(findingsAfter)               # stable S-NNN IDs

    # Step B': Optional runtime audit (when --attack-target-url is set).
    #   cadence = "every"   → re-run attack-ai every iteration; the freshly
    #                         confirmed runtime findings are aggregated into
    #                         findingsAfter so the verifier (and the next
    #                         writer pass) see them on the same revision.
    #   cadence = "bookend" → reuse the runtime findings from the initial
    #                         attack phase; they still gate the convergence
    #                         check below.
    if attack:
        runtimeFindings = (cadence == "every") ? attackAi.run() : lastRuntimeFindings
        findingsAfter   = aggregate(findingsAfter + runtimeFindings)   # additive

    # Step C: Bookkeeping
    diff = compare(currentFindings, findingsAfter)
        .resolved   = in input but not in audit (matched by fingerprint)
        .introduced = in audit but not in input
        .newCritical = introduced.filter(severity == CRITICAL).count

    # Step D: Divergence detection — record a flag if findings grow 2
    #   iterations in a row. The flag is consumed AFTER gates so a divergent
    #   iteration that ALSO introduces a new CRITICAL still goes through
    #   rollback + gateBlocked (Bug 6 fix; pre-fix the break ran here and
    #   silently bypassed gates).
    if findingsAfter.length > prevFindingCount: divergenceStreak += 1
    else:                                       divergenceStreak  = 0
    divergenceTriggered = (divergenceStreak >= 2)

    # Step E: Gate evaluation — break early on any condition. If the writer
    #   introduced new CRITICAL(s) AND a gate fires, the loop also restores
    #   the pre-iteration snapshot before stopping (Improvement 3, fix.ts).
    if config.gates.block_on_new_critical and newCritical > 0:    break  # rollback + gateBlocked=true
    if cumulativeCost > config.gates.max_cost_usd:                break
    if elapsedMs / 60000 > config.gates.max_wall_time_minutes:    break

    # Step F: Set up next iteration
    currentFindings = findingsAfter

    # Step G: Divergence break (after gates so rollback can fire)
    if divergenceTriggered: break

    # Step G: Stability check — only exit when N consecutive iters all clean
    if findingsAfter.empty:
        consecutiveCleanIters += 1
        if consecutiveCleanIters >= N: break    # ← full rotation clean
    else:
        consecutiveCleanIters = 0
```
</details>

### Phase 3: Final verification (parallel)

```
if config.fix.final_verification == 'all_reviewers':
    finalScan = parallel(reader.review(finalFiles) for reader in readers)
    finalFindings = aggregate(finalScan + SAST(root))
elif config.fix.final_verification == 'first_reviewer':
    finalScan = [readers[0].review(finalFiles)]
    finalFindings = aggregate(finalScan + SAST(root))
# else 'none': skip
```

The final verification catches what individual iteration verifiers might have missed (because each iteration only had one reader's view). Recommended setting: `all_reviewers`.

### On the relationship between `max_iterations` and N

`max_iterations` (the loop ceiling) and N (the number of configured readers) are independent settings — they're not linked anywhere in code. The `init` command defaults `max_iterations` to N, but you can change it freely in `.secure-review.yml`. What happens with each pairing:

| pairing | rotation sequence (N=3 → A,B,C) | behavior |
|---|---|---|
| `max_iter < N` (e.g. 2 vs 3) | A, B | reader C never audits during the loop; `consecutiveCleanIters >= N` early-exit cannot fire (would need 3 cleans, only 2 iters happen). Final verification still catches what C would have seen. |
| `max_iter == N` (3 vs 3, default) | A, B, C | every reader audits exactly once; clean 1:1 mapping |
| `max_iter > N` (e.g. 9 vs 3) | A, B, C, A, B, C, A, B, C | rotation wraps; early-exit can fire mid-loop after a full clean cycle |

Recommendation: keep `max_iterations >= N` so the early-exit is structurally reachable. In `.secure-review.yml`, the schema accepts `max_iterations` from 1 to 10; the CLI now rejects out-of-range overrides at parse time (since 0.5.12).

### Why this design

The two key invariants:

1. **Writer always sees the most comprehensive findings.** Iter 1 sees the full union. Iter 2+ sees the previous verifier's audit — which is itself a fresh-eyes pass by a different model on the writer's just-modified code.
2. **Loop only exits on full rotation clean.** A single lenient reader cannot end the loop while other readers still see issues. The `consecutiveCleanIters >= N` check forces a full cycle.

Together these prevent the failure mode that motivated the 0.5.0 redesign: a single iteration's reader saying "all clean" while the other readers (in the final verification) still find significant issues.

---

## `pr` mode — GitHub Action entrypoint

Branches on **`INPUT_MODE`** / **`INPUT_RUNTIME_MODE`** (default **`review`**).

### `review` branch (default)

Runs `review` mode on the full checkout, then filters aggregated findings against the PR diff before posting a single review with line-anchored comments where GitHub permits them.

![pr mode: fork guard, diff commentable-line map, full-checkout review, PR review buckets, and exit status](docs/images/pr-mode.png)

<details><summary>Pseudo-code (`review`)</summary>

```
1. Verify PR context: GITHUB_EVENT_PATH, owner/repo/pr_number
2. Skip if PR is from a fork (no secret access)
3. Fetch PR file list, parse diffs into commentable line numbers per file
4. Run review mode on the full checkout (full multi-reader scan + SAST)
5. Hand all findings + the per-file commentable-line map to `postPrReview()`
   (defined in src/reporters/github-pr.ts). Inside, findings are split into 3 buckets:
     - inline:        in a changed file AND on a commentable line → posted as inline review comment
     - summary:       in a changed file BUT on an unchanged line  → mentioned in review summary
     - dropped:       in an untouched file                        → not posted
6. `postPrReview` posts one PR review with all inline comments + summary text
7. The CLI applies `evaluatePrGates` (static gates)
     - CRITICAL/HIGH on changed files etc. → exit code 2 when blocked
```
</details>

### `attack` / `attack-ai` branch

Requires a reachable **`INPUT_TARGET_URL`** (or YAML `dynamic.target_url`). Optionally merges **`INPUT_AUTH_HEADERS_JSON`**, `SECURE_REVIEW_AUTH_HEADERS_JSON`, `dynamic.auth_headers`, and stdout JSON `{ "headers" }` from **`browser-login-script`** (your Node harness — embed Playwright there if needed). Runs `runAttackMode` or `runAttackAiMode`, then optional **`pentest-scanners`** — **OWASP ZAP baseline** (`docker run ghcr.io/zaproxy/zaproxy:stable zap-baseline.py …`) and **Nuclei** (`nuclei -json-export` if binary on PATH). Posts a Markdown-only **`postPrMarkdownReview`** (no inline diff comments — runtime findings rarely map cleanly to lines). Applies **`evaluateRuntimePrGate`** + built-in **`gateBlocked`** from the primary mode vs `dynamic.gates`.

<details><summary>Pseudo-code (`attack` | `attack-ai`)</summary>

```
1–3. Same PR / fork guards as review
4. Resolve target URL; merge auth headers (config + env JSON + hook script last line JSON)
5. Run attack OR attack-ai (bounded probes; attacker model for attack-ai)
6. For each token in INPUT_PENTEST_SCANNERS / --pentest-scanners:
       zap-baseline → Docker ZAP baseline + parse JUnit to synthetic findings
       nuclei → nuclei -json-export + parse NDJSON findings
7. postPrMarkdownReview(cap body)
8. Exit 2 if built-in probe gate fires OR evaluateRuntimePrGate(merged findings)
```
</details>

Fork PR safety: forks don't have access to repo secrets — the job exits early regardless of branch.

---

## `attack` mode — Layer 4 runtime probes

Runs deterministic HTTP checks against a live target URL. No model calls, no API keys, and no autonomous exploit generation. The goal is concrete runtime evidence for the protocol's Layer 4, while keeping the scope predictable enough for CI and thesis artifacts.

<details><summary>Pseudo-code</summary>

```
1. Load `.secure-review.yml`
2. Resolve target URL from `--target-url` or `dynamic.target_url`
3. Optionally call `dynamic.healthcheck_url`; abort if it fails
4. Run configured dynamic checks:
     - headers: missing CSP, clickjacking protection, nosniff, HTTPS HSTS
     - cookies: missing HttpOnly, Secure (HTTPS only), SameSite
     - cors: wildcard or reflected untrusted Origin
     - sensitive_paths: exposed `/.env`, `/.git/config`, config/debug/OpenAPI files
5. Normalize observed runtime problems into the same Finding shape used by
   static review (`D-01`, `D-02`, ...; reportedBy = ["dynamic"]; confidence = 1)
6. Write markdown report + JSON evidence with:
     - URL, method, status, duration
     - request headers used by the probe
     - response headers (Set-Cookie redacted)
     - redacted response snippet for exposed sensitive paths
7. Exit 2 if dynamic gates block on confirmed CRITICAL/HIGH findings
```
</details>

Example (requires **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)** — same flags as before):

```
npx secure-review-runtime attack . --target-url http://localhost:3000
npx secure-review-runtime attack . --target-url http://localhost:3000 --checks headers,cors
```

Config:

```yaml
dynamic:
  enabled: false
  target_url: http://localhost:3000
  healthcheck_url: http://localhost:3000/health
  timeout_seconds: 30
  checks:
    - headers
    - cookies
    - cors
    - sensitive_paths
  sensitive_paths:
    - /.env
    - /.git/config
    - /config.json
    - /debug
    - /swagger.json
    - /openapi.json
  gates:
    block_on_confirmed_critical: true
    block_on_confirmed_high: false
  # Optional session/Bearer headers on every probe (also: `secure-review-runtime` CLI `-H`)
  # auth_headers:
  #   Cookie: "session=..."
```

This is the deterministic runtime foundation (implemented in **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)**). For model-guided runtime testing, use **`attack-ai`** there.

**Authenticated probing:** `dynamic.auth_headers` and **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)** CLI `-H "Name: value"` are merged onto every Layer 4 `fetch` so headers/cookies/CORS/sensitive_paths checks and **`attack-ai`** crawl/probes can run as a logged-in user — without browser automation.

---

## `attack-ai` mode — authorized AI attack simulator

Runs a bounded same-origin crawl, asks an attacker model to propose safe hypotheses, executes only constrained GET/POST probes, and emits findings only when runtime evidence confirms the behavior. It is designed to help the writer fix vulnerabilities by turning "the model suspects this" into "this URL/parameter produced this reproducible evidence".

<details><summary>Pseudo-code</summary>

```
1. Load `.secure-review.yml`
2. Resolve target URL from `--target-url` or `dynamic.target_url`
3. Optionally call `dynamic.healthcheck_url`; abort if it fails
4. Crawl same-origin pages only:
     - GET pages up to dynamic.max_crawl_pages
     - collect links, forms, methods, and field names
     - respect dynamic.max_requests and dynamic.rate_limit_per_second
5. Read source tree as context for localization hints
6. Call attacker model (`dynamic.attacker`, else `writer`) with:
     - crawl surface
     - source context
     - strict JSON schema for allowed hypotheses only
7. Sanitize model output:
     - reject out-of-origin URLs
     - reject methods other than GET/POST
     - reject malformed parameter names
     - reject probes beyond the remaining request budget
8. Execute safe probe categories:
     - reflected_input: harmless marker payload must reflect unescaped
     - error_disclosure: response must show stack trace / exception / DB error text
     - open_redirect: redirect Location must point at secure-review.invalid
     - path_exposure: path must return 2xx body content
9. Normalize confirmed behaviors into Finding objects:
     - ids A-01, A-02, ...
     - reportedBy = ["attack-ai"]
     - confidence = 1
     - file/line use model source hints when provided, otherwise runtime URL
10. Write markdown report + JSON evidence with pages, hypotheses, probes, limits,
    cost, redacted snippets, and confirmed findings
11. Exit 2 if dynamic gates block on confirmed CRITICAL/HIGH findings
```
</details>

Example (**[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)**):

```
npx secure-review-runtime attack-ai . --target-url http://localhost:3000
npx secure-review-runtime attack-ai . --target-url http://localhost:3000 --max-requests 25 --max-crawl-pages 10
```

Safety contract:

- Same-origin only by default; the runner discards model-planned external URLs.
- No destructive HTTP methods, credential theft, shell execution, SSRF, persistence, or high-volume traffic.
- The model proposes hypotheses, but the runner owns the actual payloads and verification rules.
- Findings require runtime confirmation; unconfirmed hypotheses stay in the JSON evidence as probes, not findings.

Config additions:

```yaml
dynamic:
  max_requests: 50
  rate_limit_per_second: 2
  max_crawl_pages: 20
  attacker:
    provider: anthropic
    model: claude-sonnet-4-6
    skill: skills/authorized-attack-simulator.md
```

---

## Cross-cutting features

These cut across `review` and `fix` rather than belonging to a single mode. Each one targets a specific failure mode the post-experiment review surfaced.

### Stable finding identity across iterations

Inside a `fix` run, the same underlying bug must keep the same identity even when the verifier rephrases it (different line by ±a few, different title, different CWE). Without this, the per-iteration `introduced` count is artificially inflated by relabeling.

```
fingerprint(f) = `${file}::${floor(lineStart / 10)}`           # excludes CWE + title
registry assigns S-NNN the first time a fingerprint is seen and
re-uses it for every subsequent sighting in the same session.
```

The stable ID surfaces in markdown reports next to the per-call `F-NN` aggregator id (e.g. `[S-007]`) so a reader can follow one bug across the iterations. Source: `src/findings/identity.ts`.

### Baseline / FP suppression

A `.secure-review-baseline.json` file records fingerprints of findings the user has triaged as known-acceptable. Both `review` and `fix` auto-detect a baseline file in the scan root, or take an explicit `--baseline <path>` (or `--baseline none` to opt out). Fingerprints in the baseline are filtered:

- before the writer ever sees them in `fix` mode (saves writer cost);
- after each iteration's verifier audit (so suppressed findings don't reappear in the diff);
- before the headline `findings` array is written to the report (suppressed findings are still kept on the output object for transparency, and counted in logs).

Create / update the baseline from a previous report's JSON via `secure-review baseline reports/review-*.json [--reason "test fixture"] [--merge]`. Source: `src/findings/baseline.ts`.

### Incremental mode (`--since <ref>`)

`review --since main` and `fix --since main` only review files that `git diff --name-only --diff-filter=ACMR <ref>` reports as changed. The whole pipeline (SAST, AI readers, writer, snapshot/restore) is restricted to that file set, so on a tight feedback loop you pay only for the files that changed since the ref. Deleted files are excluded automatically (we can't review what's not in the working tree).

### Pre-run cost estimate

Before the AI calls fire, `review` and `fix` print a cost estimate based on the actual file set after filtering, the configured reader/writer models, and `gates.max_cost_usd`:

```
Pre-run cost estimate (fix):
  Range:  $1.18 – $2.18   (point: $1.68)
  Tokens: 96.0k input · 28.0k output

  Per model:
    reviewer codex   gpt-5-codex          5 calls  $0.45
    reviewer sonnet  claude-sonnet-4-6    3 calls  $0.30
    reviewer gemini  gemini-2.5-pro       3 calls  $0.13
    writer   writer  claude-sonnet-4-6    3 calls  $0.80

  Cap (gates.max_cost_usd): $20.00  — well within cap

Proceed? [y/N]
```

Interactive shells get the prompt; `--yes` skips it; `--no-estimate` skips the preview entirely (useful for the experiment's reproducibility scripts). In non-interactive contexts (CI, piped stdout) the estimate is still printed but the run proceeds without prompting — `gates.max_cost_usd` remains the budget contract.

Standalone preview without invoking any model: `secure-review estimate ./src --mode fix`. Source: `src/util/estimate-cost.ts`.

---

## SAST integration

SAST runs before readers and feeds them context (configurable via `inject_into_reviewer_context`).

```
SAST tools currently wrapped:
  - semgrep   (auto config; rules from semgrep registry)
  - eslint    (via local `npx --no-install eslint`; skipped if unavailable or not runnable)
  - npm audit (runs `npm audit --json` with the scan path as cwd)
```

Each tool's output is normalized to the same `Finding` schema as AI readers, so they all participate in the same dedup + confidence calculation. A finding caught by both semgrep and gemini-flash gets `confidence = min(1, 2/3) = 0.67`.

When `inject_into_reviewer_context: true`, SAST findings are passed to AI readers as **prior context** ("here's what static rules already found — focus on what they miss"). This usually makes AI readers find genuinely different bugs instead of duplicating SAST output.

---

## Aggregation algorithm

Used by both `review` mode (one-shot) and `fix` mode (each verification step).

```
function aggregate(rawFindings):
    grouped = group rawFindings by key:
                  key = `${file}::${floor(lineStart / 10)}`
    # CWE and title are deliberately NOT in the key — see `findingFingerprint`
    # in src/findings/identity.ts. Different models routinely assign different
    # CWEs (e.g. CWE-78 vs CWE-787 for the same command-injection line) or
    # rephrase titles for the same bug; including either field would double-count
    # the same bug as if it were a fresh introduction every iteration.
    for each group:
        merged.id          = synthesized "F-NN" (assigned in iteration order)
        merged.title       = first title that created the bucket
        merged.description = longest description
        merged.severity    = highest severity in group
        merged.reportedBy  = union of all names in group
        merged.confidence  = min(1, |reportedBy| / 3)
    return merged_findings  # insertion-ordered; callers sort if they want order
```

The `floor(lineStart / 10)` line-bucket is intentionally fuzzy — different reviewers often point at slightly different lines for the same bug ("line 24 in Anthropic's view" vs "line 26 in OpenAI's view"). Bucketing by 10-line windows merges these into one finding. The same fingerprint function powers the stable-identity registry and the iteration diff, so aggregation, diffing, and baseline matching are guaranteed to agree on what counts as "the same bug".

---

## False positives

The original research question — *"catch vulnerabilities reliably without overwhelming developers with false positives"* — makes FP suppression a first-class design goal, not an afterthought. Four mechanisms work together:

1. **Inter-reporter corroboration via `confidence`.** A finding reported by only one source receives `confidence = min(1, 1/3) ≈ 0.33`. Findings corroborated by 2 or 3 distinct sources score 0.67 / 1.0 respectively. Reports surface confidence prominently so single-source noise renders as low-confidence by construction — the reader can triage by confidence threshold without losing data.
2. **Fuzzy bucketing in `aggregate()`.** The same bug reported by three readers at lines 24, 26, and 31 collapses into one finding via `${file}::${floor(lineStart / 10)}` (CWE and title deliberately excluded — see [§ Aggregation algorithm](#aggregation-algorithm)). Without this, the F1-class duplicate noise (e.g. multiple readers re-flagging the same `detect-object-injection` site that ESLint Security already flagged) would inflate the apparent finding count and look like an FP problem when it's actually a deduplication problem.
3. **SAST-as-prior-context, not SAST-as-driver.** Per F1, SAST on AI-generated code is mostly silent or FP-heavy. Passing SAST output to readers as *prior context* with the framing "focus on what these missed" steers reader budget toward novel issues instead of duplicating low-signal SAST output.
4. **Baseline file for known-acceptable findings.** A `.secure-review-baseline.json` records fingerprints of findings the user has explicitly triaged as known/accepted (durable TPs they tolerate, or FPs the model keeps re-finding). Subsequent runs suppress them — the writer never sees them in the fix loop, the report counts them under "baselined" instead of mixing them into "remaining". See [§ Cross-cutting features](#cross-cutting-features).

What the tool deliberately does **not** do: assign a final TP/FP label. That remains a human judgement call. The JSON evidence preserves `reportedBy`, `confidence`, and per-reporter raw findings so downstream analysis can compute TP/FP rates the same way `secure-code-despite-ai` does.

---

## Convergence

F2 measured that naive scan→fix→scan loops either fail to converge or actively regress (4 of 6 Claude Code Condition C runs got *worse* by iteration 3). `fix` mode encodes five exit mechanisms — four are bounds, one is a *positive* convergence criterion:

| Exit mechanism | Type | Failure mode it prevents |
|---|---|---|
| `consecutiveCleanIters >= N` | **Convergence** (additive when `attack-ai` is enabled) | A single lenient reader ending the loop while readers it didn't rotate to would still flag issues (the F3 failure mode). When `--attack-target-url` is set, the iteration-clean test also requires runtime findings to be empty, so static-only "blindspot fixes" can no longer end the loop. |
| `divergenceStreak >= 2` | Bound (regression detector) | The writer is making the codebase worse, not better — stop before the LOC-growth runaway F2 measured at 33–86%. |
| `block_on_new_critical` | Bound | An iteration that introduces new CRITICAL findings is treated as a regression and short-circuits the loop (the F2 "fixes make it worse" failure mode); on this exit the loop also restores the pre-iteration snapshot. |
| `max_cost_usd`, `max_wall_time_minutes` | Bound | Runaway loops in cases where convergence is genuinely unreachable for the given codebase / model combination. The pre-run cost estimate (see [§ Cross-cutting features](#cross-cutting-features)) makes the budget contract visible *before* spending. |
| `max_iterations` (≤ 10) | Bound | Hard ceiling on write churn; bounds the LOC-growth runaway F2 measured at 33–86%. |

The post-loop **final verification with `all_reviewers`** is a separate safety net for a different failure mode: an iteration verifier saying "clean" while readers it didn't rotate to would still flag issues. It is recommended (and the default for new configs created by `init`) precisely because it directly addresses F3's low single-agent resolution rate.

### Runtime-aware fix loop (`--attack-target-url`)

Static review answers "does the source look unsafe?". When `--attack-target-url <url>` is set on `fix` mode (or `dynamic.target_url` is configured), an authorized attacker model also answers "does the *running app* still misbehave?" using the same machinery as standalone `attack-ai` mode (bounded same-origin crawl, model-planned safe probes, runtime-confirmed findings only). On both `fix` and `attack-ai`, **`--attack-provider`**, **`--attack-model`**, and **`--attack-skill`** override the corresponding fields from `dynamic.attacker` (or `writer`) without editing YAML; omitted parts still come from config. The merge is implemented as `mergeAttackerRef()` in `src/modes/attack-ai.ts`.

| Cadence | When attack-ai runs | What the writer sees | Cost shape |
|---|---|---|---|
| `bookend` (default) | Once before iter 1 + once after final verification | Iter-1 to-do list = static union ∪ initial runtime findings; later iterations carry the same runtime set forward | Two attacker calls per `fix` run |
| `every` (`--attack-every-iter`) | Once before iter 1, after every iteration's verifier audit, and after final verification | Each iteration's verifier output is aggregated with a *fresh* runtime audit on the same revision | Up to `max_iterations + 2` attacker calls |

**Additive convergence.** The early-exit test (`findingsAfter.empty`) is evaluated *after* runtime findings are merged into `findingsAfter`, so a clean static reviewer pass that still leaves runtime probes confirming a vulnerability does **not** end the loop. Both signals must be empty for `consecutiveCleanIters` to advance.

**Stable IDs unify the two signals.** Runtime findings are fingerprinted by `{file, line-bucket}` like static findings, so when the attacker reports a reflected-XSS hypothesis with `sourceFile: "src/server.ts"` and `lineStart: 1`, the fingerprint matches a static finding at `src/server.ts:1` and they merge — keeping the same `S-NNN` across iterations and showing up in the report as a single bug confirmed by both a reviewer and the attacker, not as two separate items.

### Cost gates are not theoretical

`secure-code-despite-ai` measured Condition C (single agent, 3 iterations) at **145K–188K output tokens for Task 01 alone** — roughly $2–3 per Task 01 run on Sonnet 4.6's April 2026 pricing. With multi-model rotation each `fix`-mode iteration adds a writer call plus a verifier call (and the reader fan-out runs once at the start and again at final verification). On a tight feedback loop, `max_cost_usd` and `max_wall_time_minutes` are the difference between a $5 PR check and a $50 one — they're not optional safety belts, they're the budget contract.

To reproduce the same convergence analysis the experiment does, see [§ Output schema](#output-schema) for the exact JSON fields.

---

## Resilience layers

Three safety nets keep the tool running under transient failures:

1. **`withRetry()`** — exponential backoff for any provider call that throws a transient error (429, 5xx, `ECONNRESET`, "high demand", "fetch failed", `cause`-wrapped network errors, etc.). Defined in `src/util/retry.ts`. Default schedule: 3 attempts at 1s → 2s → fail. Adapters can override (the Anthropic adapter uses 1.5s → 3s, for example).
2. **Writer parse-failure retry** — if the writer's JSON output isn't parseable, retry once with a stricter "JSON ONLY, no prose" reminder. Catches Sonnet's occasional drift into prose-around-JSON.
3. **Anthropic prefill `{`** — when `jsonMode=true`, the Anthropic adapter prefills the assistant turn with `{` so the model has to continue inside an open JSON object. Drops most prose drift at the source.

---

## Verifying locally

**This repository (`secure-review`)** implements static modes (`scan`, `review`, `fix`, …). The pseudo-code for **`attack`** / **`attack-ai`** below describes behavior implemented in **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)**, not paths under this repo.

1. **Automated suite (this repo)** — From the repo root: `npm run typecheck` and `npm test` (Vitest). Tests cover parsing, aggregation, static reporters, **`fix`** rotation / gates / reviewer health, and related CLI options — **not** live HTTP attack fixtures (those moved to **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)**).
2. **Runtime package** — Clone or open **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)**: `npm install && npm test` after linking `secure-review`. Use **`npx secure-review-runtime attack …`** / **`attack-ai …`** against a local server when validating Layer 4.
3. **No-key smoke** — `secure-review scan <path>` loads config and runs SAST only (stdout JSON). `secure-review --help` confirms static CLI wiring.
4. **Deterministic Layer 4** — With your app listening, run **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)** from that repo, then inspect `reports/attack-*.json` (`condition: "F-attack"`).

Full checklist (including `estimate`, `build`, and `build:action`): [README § Developing and verifying](README.md#developing-and-verifying).

---

## Limitations

Adapted from `secure-code-despite-ai`'s Section 13 threats-to-validity. None of these are bugs — they're scope boundaries the tool acknowledges so users calibrate trust accordingly.

- **Automation boundary.** **This package** covers static + AI review (layers 1–3). **Layer 4** — deterministic `attack`, bounded same-origin `attack-ai`, optional **ZAP** / **Nuclei**, and **browser-login-script** hooks — ships in **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)**. Built-in probes there remain **bounded** (same-origin-safe categories in `attack-ai`; no autonomous exploit chains beyond configured scanners **plus** Nuclei traffic you explicitly enable).
- **Non-determinism.** AI readers and writers produce different outputs on the same input. The JSON evidence records `model_version` per run, but temperature and seed are not pinned uniformly across providers (and some providers don't expose seeds at all). Studies should plan multiple runs per condition, mirroring the protocol's 3-runs-per-task baseline.
- **TP/FP labeling stays human.** Aggregation downweights single-source findings via `confidence`, but final true-positive vs. false-positive classification still requires a human or a separate evaluation harness. The tool surfaces evidence; it does not adjudicate.
- **Provider model evolution.** Models change between runs — the protocol calls this out explicitly as a threat to reproducibility. JSON evidence captures `model_version` and `timestamp` so historical comparisons remain auditable even when not byte-reproducible.
- **Ground-truth-free fix success rate.** `findings_resolved` counts findings present in the initial scan but absent in final verification. It does **not** prove the underlying vulnerability was fixed — only that no reader plus SAST reported it. F3 measured exactly this gap (resolution rates of 0–54% on a single-model loop). Multi-model rotation reduces this risk but does not eliminate it.

---

## Output schema

`review` and `fix` modes emit three report files per run:

- `reports/<mode>-<timestamp>.md` — human-readable Markdown report.
- `reports/<mode>-<timestamp>.html` — self-contained interactive report (inline CSS + JS, no external assets). Sortable/filterable findings list, collapsible details per finding, fix-mode adds a before/after delta + per-iteration timeline. Works offline; safe to commit, attach to a PR comment, or open from a CI artifact.
- `reports/<mode>-<timestamp>.json` — structured evidence JSON, schema-stable across versions (defined in `src/findings/schema.ts`).

**[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)** (`attack` / `attack-ai`) emits:

- `reports/attack-<timestamp>.md` — human-readable runtime probe report.
- `reports/attack-<timestamp>.json` — structured runtime evidence (`condition: "F-attack"`) including `target_url`, `checks`, `runtime_findings`, `gate_blocked`, and `gate_reasons`.

- `reports/attack-ai-<timestamp>.md` — human-readable AI attack simulation report.
- `reports/attack-ai-<timestamp>.json` — structured runtime evidence (`condition: "F-attack-ai"`) including `target_url`, `crawled_pages`, `hypotheses`, `probes`, `runtime_findings`, safety `limits`, `gate_blocked`, and `gate_reasons`.

The JSON schema is **deliberately compatible with `secure-code-despite-ai`'s Condition D evidence format** — **`secure-review`** runs use `condition: "F-review"` or `"F-fix"`; **[`secure-review-runtime`](https://github.com/sstaempfli/secure-review-runtime)** adds `"F-attack"` and `"F-attack-ai"` so results plot alongside the original A/B/C/D baselines. Think of the combined toolchain as **Condition F**: an extension of the original experimental matrix, not a parallel format.

### Mapping to research metrics

For studies that want to compute the same metrics the protocol defines (see `secure-code-despite-ai/docs/experiment-protocol.md` §10):

| Research metric | JSON field(s) | Notes |
|---|---|---|
| **True-positive rate** (proxy) | `findings[].confidence`, `findings[].reportedBy` | Per-finding signal, not per-run. Use confidence threshold to approximate; final TP/FP labels require human review. |
| **Fix success rate** | `findings_resolved / total_findings_initial` (also pre-computed as `resolution_rate_pct`) | Identical semantics to Condition C/D's resolution rate. |
| **Convergence** | `per_iteration[].findings_in` vs `findings_out`; top-level `new_findings_introduced` | F2's "did fixing make it worse?" is `new_findings_introduced > 0` or any `findings_out > findings_in` across iterations. |
| **Severity distribution** | `findings_by_severity_initial`, `findings_by_severity_after_fix` | Same `SeverityBreakdown` shape as Condition B/C/D output. |
| **Cost per condition** | `total_cost_usd`, `per_iteration[].cost_usd` | USD-denominated; feeds the protocol's productivity metric. |
| **Iteration count** | top-level `iterations`, `per_iteration[].iteration` | Maps to "Number of feedback iterations needed". |
| **Non-determinism control** | `model_version`, `session_id`, `timestamp`, `run` | Enough metadata to identify and replay any single run. |
| **CRITICAL-introduced regressions** | `notes` (set to `"Gate blocked: ..."` when applicable) | Otherwise inferable from `per_iteration` deltas + `findings_by_severity_*`. |
| **Per-iteration verifier identity** | `per_iteration[].reviewer` (alias `verifier`) | Lets you reconstruct which model audited which iteration in `fix` mode — necessary for cross-model coverage analysis. |

See [README's Evidence JSON section](README.md#evidence-json) for the complete schema reference, and `src/findings/schema.ts` for the runtime Zod schema.
