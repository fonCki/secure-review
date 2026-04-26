# Changelog

All notable changes to `secure-review`. Newest first.

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
