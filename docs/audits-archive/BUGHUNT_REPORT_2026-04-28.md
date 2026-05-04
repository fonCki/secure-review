# Bug Hunt — secure-review v0.5.11

## Findings

### [HIGH] Reviewer/provider failures can turn into a passing "clean" review
**src/roles/reviewer.ts:96** — `runReviewer` catches every adapter or parse failure and returns an empty finding set with `error`, and callers still aggregate that as zero findings. `review`, `pr`, and fix verification can therefore pass when the model call timed out, exhausted retries, hit provider errors, or returned unparseable non-JSON.
**What:** A failed security reviewer is treated operationally like a reviewer that found no bugs. In PR mode this can post a summary and exit 0 unless a separate inline CRITICAL finding exists; in fix mode, a writer failure followed by verifier failures can make `currentFindings` go empty.
**Repro:** Configure one reviewer with a valid key, then make the provider return repeated 5xx/429 errors or force `adapter.complete()` to throw. `runReviewer` returns `{ findings: [], error: ... }`; `runReviewMode` returns zero aggregated findings if no other source reports one; the CLI catches nothing and exits successfully.
**Fix sketch:** Distinguish "no findings" from "review unavailable". Keep partial-review support if desired, but make the mode output carry a fatal/failed-reviewer count and have CLI/PR fail when all reviewers fail, when final verification fails, or when a configured minimum reviewer quorum is not met. For parse failures, keep per-finding salvage, but a totally unparseable response should not be equivalent to a clean audit.

### [HIGH] Writer can still overwrite arbitrary in-root files, including dotfiles and untracked files
**src/roles/writer.ts:146** — each model-supplied `changes[].file` is accepted as long as `resolveWriterTarget` proves it is inside the scan root; `readSourceTree` separately skips dotfiles at `src/util/files.ts:73`.
**What:** The traversal/symlink fix blocks writes outside the root, but it does not bind writer output to files that were shown in the prompt or to files that already had a finding. A bad or compromised writer response can overwrite `.env`, `.github/workflows/*`, an untracked source file, or any other in-root file not present in `files`.
**Repro:** Run fix mode with scan root `.` and a writer adapter response like `{"changes":[{"file":".env","content":"OPENAI_API_KEY=deleted"}]}`. `.env` was not read into context, but `resolveWriterTarget` allows it and `writeFileSafe` truncates/replaces it.
**Fix sketch:** Before writing, compare normalized change paths against an allowlist derived from `FileContent.relPath` and/or the files referenced by current findings. For genuinely new files, require an explicit safe create path policy and refuse overwriting existing files that were not in the scanned source set. Also consider refusing dotfiles and generated/report directories by default unless the finding explicitly targets them.

### [MEDIUM] PR/action gates still ignore max-cost and high-severity blocking
**src/cli.ts:245** — PR mode applies `--max-cost-usd` to config, but `runReviewMode` never evaluates gates. **src/cli.ts:309** only fails PRs for `block_on_new_critical`; `block_on_new_high` is ignored.
**What:** The fix pass wired the action input into the PR command, but the configured cost ceiling remains ineffective for PR reviews. A user who sets `gates.block_on_new_high: true` also gets a passing PR check when HIGH findings are posted inline.
**Repro:** In GitHub Actions, set `max-cost-usd: 0.01` and use reviewers whose reported cost is higher; the run still completes unless CRITICAL findings are inline. Separately, set `block_on_new_high: true` and return one HIGH finding on a changed line; `criticalOnDiff` is 0, so the check exits 0.
**Fix sketch:** Add review/PR gate evaluation after `runReviewMode` using `totalCostUSD`, elapsed time, and inline finding severities. PR mode should fail on HIGH inline findings when `block_on_new_high` is enabled, and should fail or mark blocked when the post-run cost exceeds `max_cost_usd`.

### [MEDIUM] Diff parser marks the trailing newline as a commentable source line
**src/util/diff.ts:37** — `commentableLinesFromPatch` treats `raw === ''` as a context line.
**What:** `patch.split('\n')` produces a final empty string when a patch ends with a newline. The parser adds that as one more commentable new-file line, so `postPrReview` can try to anchor a comment outside the real diff and GitHub can reject the whole review with 422.
**Repro:** `commentableLinesFromPatch('@@ -1,1 +1,1 @@\n line\n')` returns `{1, 2}` even though the hunk has only new-file line 1. A finding on line 2 in that file is treated as inline-commentable.
**Fix sketch:** Ignore the terminal empty element created by `split('\n')`. If blank context lines need support, only count lines that carry the diff context prefix (`' '`) or parse hunks by their declared new-line lengths so the parser cannot advance beyond the hunk.

### [LOW] Invalid `--max-iterations` values silently skip the fix loop
**src/cli.ts:185** — the CLI assigns `Number(opts.maxIterations)` directly into a schema-validated config object after validation has already happened.
**What:** `--max-iterations abc`, `NaN`, negative values, or `0` are accepted after config loading. Because the loop condition is `i < config.fix.max_iterations` at `src/modes/fix.ts:180`, invalid or non-positive values run no writer iterations but still produce reports and final verification.
**Repro:** Run `secure-review fix . --max-iterations abc`; `Number('abc')` is `NaN`, the loop never executes, and the command can still exit successfully depending on verification findings.
**Fix sketch:** Parse this option with the same bounds as the schema (`int` 1-10), and fail fast on invalid input. If `0` is meant to be a dry-run mode, make it an explicit flag and document different output semantics.

### [LOW] Fix evidence can underreport final SAST counts when no iteration ran
**src/reporters/json.ts:69** — `semgrep_after_fix` and `eslint_after_fix` are read from `out.iterations.at(-1)?.sastAfter`, defaulting to 0.
**What:** Final verification runs SAST in `src/modes/fix.ts:310`, and `finalFindings` can include those SAST findings, but the SAST summary is not stored on `FixModeOutput`. If the loop is skipped by a gate, invalid/zero max iterations, or an initially clean run with final verification, evidence JSON reports `semgrep_after_fix: 0` and `eslint_after_fix: 0` even when final SAST found issues.
**Repro:** Use a mocked fix run with `iterations: []`, `finalFindings` containing semgrep findings, and call `renderFixEvidence`; the after-fix SAST counters are 0.
**Fix sketch:** Store the final SAST summary on `FixModeOutput` and render evidence from that. If final verification is disabled, use the latest post-writer SAST run or explicitly mark SAST counts unavailable instead of defaulting to zero.

## Things checked and found clean

- Read every file under `src/` end to end; skipped `dist/`, `dist-action/`, and `node_modules/`.
- Verified the previous `review.parallel: false` bug is fixed: sequential review now calls `runOne` lazily through `sequential(...)` instead of constructing all reviewer promises up front.
- Verified SAST and reviewer finding paths are normalized before aggregation in review and fix modes.
- Verified PR file pagination uses `octokit.paginate` through `listPullRequestFiles`.
- Verified writer traversal and direct symlink-escape checks now reject syntactic `..` escapes and symlink components resolving outside the real scan root.
- Verified `init` no longer emits schema-invalid `max_iterations: 0`; generated values are clamped to 1-10.
- Verified per-finding parse salvage now keeps valid findings when neighboring items are malformed.
- Verified configured `output.report`, `output.findings`, and `output.diff` are honored when they differ from the defaults.
- Verified `scope` was removed from the schema rather than remaining as a silently ignored documented field.
- Verified `runAllSast` short-circuits cleanly when SAST is disabled.
- Verified GitHub fork PRs are skipped before secrets/API calls.
- Verified command execution uses `spawn`/`execFile` argument arrays rather than shell interpolation for provider CLIs, SAST commands, `git diff`, and `gh secret set`.
