# Workflow

How `secure-review` actually executes each mode. Pseudo-code matches the source — every step here corresponds to real code in `src/modes/` and `src/roles/`.

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
| `pr` | The protocol's *"running on every commit"* requirement | Layers 2–3, gated | Operationalizes the research question's commit-time validation, scoped to the PR diff. |

Layer 4 (dynamic / runtime testing) is **out of scope** for `secure-review` today — the protocol calls it out as a separate concern requiring a live target. The tool is sound on layers 1–3 and acknowledges this boundary in [§ Limitations](#limitations).

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

    # Step C: Bookkeeping
    diff = compare(currentFindings, findingsAfter)
        .resolved   = in input but not in audit (matched by fingerprint)
        .introduced = in audit but not in input
        .newCritical = introduced.filter(severity == CRITICAL).count

    # Step D: Divergence detection — if findings grow 2 iterations in a row,
    #   we're regressing; stop the loop before LOC growth runs away (per F2).
    if findingsAfter.length > prevFindingCount: divergenceStreak += 1
    else:                                       divergenceStreak  = 0
    if divergenceStreak >= 2: break

    # Step E: Gate evaluation — break early on any condition. If the writer
    #   introduced new CRITICAL(s) AND a gate fires, the loop also restores
    #   the pre-iteration snapshot before stopping (Improvement 3, fix.ts).
    if config.gates.block_on_new_critical and newCritical > 0:    break
    if cumulativeCost > config.gates.max_cost_usd:                break
    if elapsedMs / 60000 > config.gates.max_wall_time_minutes:    break

    # Step F: Set up next iteration
    currentFindings = findingsAfter

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

Runs `review` mode on the full checkout, then filters the aggregated findings against the PR diff before posting a single review with line-anchored comments where GitHub permits them.

![pr mode: fork guard, diff commentable-line map, full-checkout review, PR review buckets, and exit status](docs/images/pr-mode.png)

<details><summary>Pseudo-code</summary>

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
7. The CLI sets GitHub Check status:
     - if config.gates.block_on_new_critical AND any CRITICAL inline finding → exit code 2 → check fails
     - else → exit code 0 → check passes
```
</details>

Fork PR safety: forks don't have access to repo secrets, so reviewers would fail to authenticate. Skipping prevents wasted CI minutes and confusing failure modes.

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
| `consecutiveCleanIters >= N` | **Convergence** | A single lenient reader ending the loop while readers it didn't rotate to would still flag issues (the F3 failure mode). |
| `divergenceStreak >= 2` | Bound (regression detector) | The writer is making the codebase worse, not better — stop before the LOC-growth runaway F2 measured at 33–86%. |
| `block_on_new_critical` | Bound | An iteration that introduces new CRITICAL findings is treated as a regression and short-circuits the loop (the F2 "fixes make it worse" failure mode); on this exit the loop also restores the pre-iteration snapshot. |
| `max_cost_usd`, `max_wall_time_minutes` | Bound | Runaway loops in cases where convergence is genuinely unreachable for the given codebase / model combination. The pre-run cost estimate (see [§ Cross-cutting features](#cross-cutting-features)) makes the budget contract visible *before* spending. |
| `max_iterations` (≤ 10) | Bound | Hard ceiling on write churn; bounds the LOC-growth runaway F2 measured at 33–86%. |

The post-loop **final verification with `all_reviewers`** is a separate safety net for a different failure mode: an iteration verifier saying "clean" while readers it didn't rotate to would still flag issues. It is recommended (and the default for new configs created by `init`) precisely because it directly addresses F3's low single-agent resolution rate.

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

## Limitations

Adapted from `secure-code-despite-ai`'s Section 13 threats-to-validity. None of these are bugs — they're scope boundaries the tool acknowledges so users calibrate trust accordingly.

- **Layer scope.** Covers static + AI review (defense-in-depth pipeline layers 1–3). It does **not** cover layer 4 — dynamic / runtime testing (OpenClaw or equivalent in-Docker pentest agents). For the fully autonomous runtime story the protocol describes, `secure-review` is necessary but not sufficient.
- **Non-determinism.** AI readers and writers produce different outputs on the same input. The JSON evidence records `model_version` per run, but temperature and seed are not pinned uniformly across providers (and some providers don't expose seeds at all). Studies should plan multiple runs per condition, mirroring the protocol's 3-runs-per-task baseline.
- **TP/FP labeling stays human.** Aggregation downweights single-source findings via `confidence`, but final true-positive vs. false-positive classification still requires a human or a separate evaluation harness. The tool surfaces evidence; it does not adjudicate.
- **Provider model evolution.** Models change between runs — the protocol calls this out explicitly as a threat to reproducibility. JSON evidence captures `model_version` and `timestamp` so historical comparisons remain auditable even when not byte-reproducible.
- **Ground-truth-free fix success rate.** `findings_resolved` counts findings present in the initial scan but absent in final verification. It does **not** prove the underlying vulnerability was fixed — only that no reader plus SAST reported it. F3 measured exactly this gap (resolution rates of 0–54% on a single-model loop). Multi-model rotation reduces this risk but does not eliminate it.

---

## Output schema

Both `review` and `fix` modes emit two report files per run:

- `reports/<mode>-<timestamp>.md` — human-readable Markdown report.
- `reports/<mode>-<timestamp>.json` — structured evidence JSON, schema-stable across versions (defined in `src/findings/schema.ts`).

The JSON schema is **deliberately compatible with `secure-code-despite-ai`'s Condition D evidence format** — `secure-review` runs are tagged `condition: "F-review"` or `condition: "F-fix"` so they plot directly alongside the original A/B/C/D baselines without conversion. Think of `secure-review` output as **Condition F**: an extension of the original experimental matrix, not a parallel format.

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
