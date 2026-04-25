# Changelog

All notable changes to `secure-review`. Newest first.

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
