# Changelog

All notable changes to `secure-review`. Newest first.

## [0.5.8] — 2026-04-26

### `secure-review setup-secrets` — automated GitHub secrets via `gh` CLI

Anyone running the tool in CI needs the same set of provider keys configured as GitHub Actions secrets. Previously this meant clicking through the web UI one-by-one or running `gh secret set` per key by hand. Now:

```bash
npx secure-review setup-secrets
```

What it does:
- Detects `gh` CLI is installed and authenticated; prints a clean install/login hint and exits if not
- Reads `.secure-review.yml` to learn which providers are enabled
- Pulls each enabled provider's `*_API_KEY` from the auto-loaded `.env`
- Pipes the value to `gh secret set <NAME>` via **stdin** (the secret never appears on a shell command line or in the process list)
- Skips silently for any key that's missing or matches placeholder patterns (`sk-ant-...`, `dummy`, etc.)
- Reports `N set · N skipped · N failed`; non-zero exit if any fail

Flags:
- `--repo owner/name` to override target (default: `gh` detects from current git remote)
- `-c, --config <file>` to point at a non-default `.secure-review.yml`

### init now hints about `setup-secrets` in next steps

After init scaffolds the workflow, the printed next-steps now mention:
```
After you push to GitHub, run: npx secure-review setup-secrets
   (sets API keys as GitHub secrets via gh CLI; or set them manually in repo Settings → Secrets)
```

### README documents the "one-key-is-enough" path

A new callout in the subcommands table makes it explicit: secure-review runs with as few as **one reader**. Disable any provider during init (or remove its entry from `.secure-review.yml`) and the tool simply skips it. Useful if you only have an OpenAI key, or want to keep cost down to a single provider.

The new "Setting GitHub Action secrets" section in README documents both the automated path (`setup-secrets` subcommand) and the manual fallbacks (`gh secret set` per key, or the GitHub web UI URL).

---

## [0.5.7] — 2026-04-26

### `init` now scaffolds the GitHub Actions workflow

A user shouldn't have to look up YAML and write `.github/workflows/secure-review.yml` by hand the first time they want to wire the tool into CI. `init` now asks:

```
GitHub Action:
  Auto-runs the tool on every PR and posts inline review comments.
  - active:  writes .github/workflows/secure-review.yml (runs on the next PR)
  - example: writes .github/workflows/secure-review.yml.example
             (you rename to .yml when you want to enable it)
  - skip:    no CI file written
  GitHub Action workflow? (active/example/skip) [example]
```

- Default = `example` (safer — won't auto-arm the action on the user's next PR push without an explicit rename)
- Generated YAML only includes env vars for **enabled** providers — if you said no to Google in init, you don't need to set up a `GOOGLE_API_KEY` GitHub secret
- Includes the `npm ci` step (without it, `node_modules/secure-review/skills/...` paths in the user's `.secure-review.yml` won't resolve in the runner — was a real foot-gun)
- Permissions block is minimal (`contents: read`, `pull-requests: write`, `checks: write`)
- Won't overwrite an existing workflow file unless `--force`

A new exported `generateWorkflow(answers)` function lets other tools generate the same YAML programmatically.

---

## [0.5.6] — 2026-04-26

### Sequence-diagram fixes (caught by Gemini validator on 0.5.5)

- Mermaid `sequenceDiagram` doesn't reliably support `<br/>` inside `participant ... as` aliases — they render as literal `<br/>` text in many viewers. Collapsed each participant alias to a single line.
- The 0.5.5 sequence diagram skipped the **pre-writer** SAST + file-read step. The actual code (`src/modes/fix.ts`) reads `beforeFiles` and runs `sastBefore` BEFORE the writer fires (recorded in `IterationRecord.sastBefore`), so the diagram was missing a load-bearing step. Added it back.

Pure docs accuracy. No behavior changes.

---

## [0.5.5] — 2026-04-26

### `init` asks for `max_iterations` (defaults to N)

Previously `max_iterations` was hardcoded to 3 in the generated YAML, which silently coupled the loop ceiling to the default reader count. With non-default reader counts, the "full-rotation-clean" early-exit could be structurally unreachable.

`init` now asks:
```
Fix mode behavior:
  Each iteration: writer fixes the current findings, then the next reader
  in rotation audits with fresh eyes. The "full-rotation-clean" early-exit
  only fires after N consecutive verifiers all see clean — so a meaningful
  default is N (= 3 for your setup).
  Max iterations of the fix loop? [3]
```

- Default = number of enabled readers (so the early-exit is always reachable)
- Free-form non-negative integer (1, 5, 10, etc.)
- `0` is allowed → skips the loop entirely; just initial scan + final verification (audit-only mode)
- Warns if user picks `max_iterations < N` that the early-exit can't fire
- Generated YAML now includes a comment block explaining the relationship

### WORKFLOW.md gets Mermaid diagrams

GitHub renders Mermaid natively; npm landing page only shows README so this doc is GitHub-first anyway. Added:
- `scan` mode: simple sequential SAST flowchart
- `review` mode: parallel reader fan-out + dedup flowchart
- `fix` mode: high-level 3-phase flowchart with all gates and decision diamonds
- `fix` mode iteration: sequence diagram showing the writer → verifier interaction in time
- `fix` mode rotation: state diagram showing verifier hopping A→B→C→A→…
- `pr` mode: bucket-split flowchart (inline / summary / dropped)

Pseudo-code retained as collapsible `<details>` blocks under each diagram for those who want to read precise logic.

### New "max_iterations vs N" section in WORKFLOW.md

Explains what happens when the loop ceiling is less than, equal to, or greater than the reader count, with a recommendation table.

---

## [0.5.4] — 2026-04-26

### Documentation accuracy fixes (caught by independent validator agents)

Two parallel validator agents (Gemini second-opinion + general-purpose) cross-checked the 0.5.3 docs against the actual TypeScript source. They found 9 real issues, all fixed here:

**README.md leaks** (seminar artifacts that survived the 0.5.3 cleanup):
- Architecture diagram: `markdown · json (cond-D) · github-pr` → `markdown · json (evidence) · github-pr`
- Evidence JSON example: `"task_id": "01-auth"` → `"task_id": "my-app"`
- Evidence JSON example: `"condition": "F-fix"` → `"mode": "fix"` (matches what the tool actually emits)

**WORKFLOW.md inaccuracies vs source**:
- SAST tools were described as "parallel" — they actually run **sequentially** (`semgrep` → `eslint` → `npm-audit` in `runAllSast`). Wording corrected for `scan`, `review`, and `fix` initial-scan sections.
- `review` mode reader parallelism was presented as unconditional — it's actually gated by `config.review.parallel` (defaults true). Note added.
- `fix` mode rotation was presented as unconditional — `config.fix.mode === 'parallel_aggregate'` skips rotation entirely (verifier always = readers[0]). Now documented.
- Aggregation algorithm claimed "sorted by severity desc, then reportedBy desc" — `aggregate()` returns insertion order with no sort. Corrected to "insertion-ordered; callers sort if they want order".
- Aggregation grouping key: clarified that `cwe` falls back to a 24-char title prefix when missing, and that finding IDs are synthesized "F-NN" in iteration order.
- Resilience layer retry timing claimed "1.5s → 3s → exit" — that's only the Anthropic adapter's override. Default `withRetry` is 1s → 2s → exit. Now distinguishes default from per-adapter overrides.
- `pr` mode bucketing logic was attributed to the CLI — it actually lives in `postPrReview()` (`src/reporters/github-pr.ts`). Attribution corrected.

No code changes — pure documentation accuracy. Underlying behavior unchanged from 0.5.3.

---

## [0.5.3] — 2026-04-26

### Documentation overhaul

- **`fix` mode in README was stale** — described pre-0.5.0 behavior (single-reviewer pre-scan, single-reviewer-zero exit, initial scan as vanity metric). Now correctly describes the 0.5.0+ rotating-verifier loop with initial union, full-rotation-clean exit, and all three phases.
- **New `WORKFLOW.md`** with the full per-mode pseudo-code (scan, review, fix, pr) — adapted from the internal methodology doc, scrubbed of seminar-specific notes. Read this if you're evaluating the methodology rather than just running the tool.
- **README opening rewritten**: now lists all four modes (`scan`, `review`, `fix`, `pr`) instead of misleadingly saying "two modes". Quick start moved to the top with the npm install command and badges.
- **Per-mode summaries in README** rewritten to be accurate and link to WORKFLOW.md for depth.
- **npm badges added** to README (version, downloads, license).

### License

- **Co-author added**: Shana Stampfli.

### README cleanup

- Removed the "Research context" / "Phase 5 deliverable" / supervisor / cited-papers section — the README is now framed as a tool for users, not as a research artifact. Academic context belongs in a separate paper, not in the npm landing page.
- Intro paragraph trimmed to drop the seminar reference.

---

## [0.5.2] — 2026-04-25

### Anthropic prefill `{` for JSON-mode (Bug #11 hard fix)

The Anthropic API has no native "structured output" flag, so previously when the writer was set to a Claude model, ~60-70% of responses contained prose around the JSON ("Sure, here's the fix..." then JSON, or sometimes just prose with no JSON at all). The 4-strategy parser couldn't recover and the writer changed 0 files.

`src/adapters/anthropic-api.ts` now prepends an `{ role: 'assistant', content: '{' }` turn to the request when `jsonMode=true`. The model literally cannot emit prose because it has to continue from inside an open JSON object. We re-prepend `{` to the response text so the parser sees a complete object.

Empirical: validation run with Sonnet writer went from **0/3 successful writer attempts → 2/3 successful**. The remaining failure is recovered by the next layer.

### Writer retry on parse failure (Bug #11 fallback)

`src/roles/writer.ts` now retries the LLM call ONCE with an explicit "PREVIOUS RESPONSE WAS NOT VALID JSON. Return ONLY a JSON object. NO prose. NO markdown fences." appended when `extractJson` fails on attempt 1. Cost: at most one extra LLM call per failed iteration.

### Transient-error classifier extended

`src/util/retry.ts` now classifies these as retriable (was missing them, so a `fetch failed` from a llm-proxy hiccup or extension cold-start would fail the whole run instead of retrying):

- Error codes: `EPIPE`, `ECONNABORTED`
- Message patterns: `fetch failed`, `connect timeout`, `socket hang up`, `network error`, `econnreset`, `econnrefused`, `econnaborted`, `etimedout`
- Now also peeks through `err.cause` (Node global fetch / undici wraps the real network error there)

---

## [0.5.1] — 2026-04-25

### Live progress spinner during long-running operations

LLM calls take 10-90s and previously the terminal looked frozen between log lines, making it hard to tell if the tool was working or stalled. Now there's a live braille spinner with elapsed-seconds counter on every long-running step:

- Initial scan: SAST spinner + parallel reviewer-count spinner ("Reviewers: 2/3 done")
- Each iteration: writer spinner + verifier spinner
- Final verification: parallel reviewer-count spinner

Behavior:
- TTY: animated spinner with elapsed time, 80ms redraw cadence
- Non-TTY (CI, pipes, redirected output): single "started" + "done" lines, no animation, log-friendly
- `--quiet`: spinner suppressed entirely, only final lines

Zero new dependencies — ~150 lines in `src/util/spinner.ts`.

---

## [0.5.0] — 2026-04-25

### Fix-mode loop redesign (semantic change — see notes below)

`fix` mode now uses the **initial union scan as the writer's first to-do list** and rotates the **verifier** per iteration (instead of having each iteration's reviewer scan first and act as both pre-scanner and verifier).

**Before 0.5.0** (problems):
- Each iteration's reviewer scanned alone → writer fixed only that single reviewer's view
- Loop terminated on **single-reviewer-zero** — one lenient reader could end the loop while others still saw issues
- Initial parallel scan was a vanity baseline metric, never fed the writer

**After 0.5.0** (fixes both):
- Initial union (all readers + SAST in parallel) **is** the writer's iter-1 input — no reader's blind spots get a free pass
- Each iter: writer fixes current findings → next reader (rotation) audits with fresh eyes → that audit becomes next iter's input
- Loop only exits when **N consecutive verifiers** all see clean (full rotation), or gates fire
- All initial reviewer costs are now correctly counted toward `totalCostUSD` (was counting only the first reviewer's cost — a long-standing accounting bug)

### Reporter changes

- Markdown table columns renamed for clarity:
  - `Reviewer` → `Verifier` (the rotating reader that audits each iteration's writer output)
  - `Before` → `Findings In` (what the writer was asked to fix this iteration)
  - `After` → `Findings Out` (what the verifier saw post-writer)
  - Footnote added explaining iter 1 (initial union) vs iter 2+ (previous verifier's audit)
- JSON `per_iteration` adds new fields (`verifier`, `findings_in`, `findings_out`, `findings_resolved`) while keeping old field names (`reviewer`, `findings_found`, `findings_severity`) as aliases for backward compatibility

### Trigger

A real run on a Sonnet-generated tutorial app where iter-1 anthropic-haiku reported "0 findings" → loop terminated → final verification (all 3 readers parallel) revealed 6 issues openai+gemini saw. Single-reader-zero is no longer a sufficient termination signal.

### Migration

No config changes required — your existing `.secure-review.yml` works as-is. Just upgrade and run:

```bash
npm install --save-dev secure-review@latest
npx secure-review fix ./src
```

Output table headers will look different, but the JSON evidence schema is backward-compatible (additive only).

### Known issue surfaced during validation

When `writer = anthropic / claude-sonnet-4-6` is used via the local `llm-proxy` (Claude Max routing), the writer's response often doesn't parse as JSON → `Writer failed: No parseable JSON in model response`. The 0.5.0 loop logic itself is fine; the writer just doesn't produce file changes for that combination. Workaround: switch `writer.model` to `gpt-4o-mini` or `claude-haiku-4-5` until this is fixed in 0.5.1.

---

## [0.4.0] — 2026-04-25

### `init` asks for writer provider + free-form model name

Previously, `init` silently defaulted the writer to `gpt-4o-mini` because OpenAI was the cheapest enabled provider. For a tool studying AI-generated code, this is a model-quality choice that the user should make consciously — not a hidden default.

- New "Writer" section in interactive `init`: pick provider, then type any model name (free-form text accepted)
- Default writer is now `anthropic / claude-sonnet-4-6` — strong reasoning, good for fixing AI-generated code
- Up-front notice tells the user every model name in the generated YAML is just a string and can be edited later
- Generated YAML has explanatory comments on writer + reader blocks
- Validates the chosen writer provider is in the enabled set; errors out with a clear message if not
- `WRITER_MODEL_DEFAULTS` and `READER_MODEL_DEFAULTS` exposed as exported constants

---

## [0.3.5] — 2026-04-25

- Auto-load `.env` from CWD via `process.loadEnvFile` (Node 20.12+) — no more manual `set -a; source .env; set +a`

## [0.3.4] — 2026-04-25

- `init` output hints that models in `.secure-review.yml` are editable (e.g. switch to stronger models for stronger audits)

## [0.3.3] — 2026-04-25

- `--version` reads our own `package.json` via `import.meta.url` (was reading the user's CWD `package.json`)

## [0.3.1] — 2026-04-25

- Removed leaked llm-proxy question from `init` (it's a private dev workflow, not for public users)

## [0.3.0] — 2026-04-25

- `secure-review init` subcommand — interactive scaffold for `.secure-review.yml` + `.env`

## [0.2.x] — 2026-04-25

- Initial public publish to npm
- `prepare` script so installing from GitHub builds `dist/` on the user's machine

## [0.1.0] — 2026-04-24

- First public release
- Multi-model security review with rotating fix loop
- GitHub Action with line-anchored PR comments
- SAST integration (semgrep + eslint + npm-audit)
- Diff-aware filtering for PR comments (`c55d17a`)
- Exponential-backoff retry for transient provider errors (`f46ba78`)
- Writer NUL/control-char sanitization (`438e3ef`)
- 4-strategy JSON extractor with jsonrepair fallback (`0b524ca`)
