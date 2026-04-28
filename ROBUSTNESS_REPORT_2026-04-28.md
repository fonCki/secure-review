# Robustness & UX — secure-review v0.5.11

## High-value improvements (real friction users will hit)

### Issue: A fully failed AI review can still look like a successful clean run
**File:line** — `src/roles/reviewer.ts:96`, `src/modes/review.ts:59`, `src/cli.ts:158`.

**Symptom:** A provider auth/rate-limit/network failure is converted into `findings: []`, then review mode aggregates those empty outputs with SAST and exits 0. If every reviewer fails and SAST is disabled or unavailable, CI can publish "Total: 0 findings" as if the code was clean. The Markdown report shows reviewer rows as `FAILED`, but the CLI success lines and exit code still communicate success.

**Why it matters:** This is the highest-risk failure mode for a CI security tool: broken credentials, exhausted quota, or provider outage can become a green check. It will happen in normal use when secrets expire, new repos forget one secret, or provider APIs throttle.

**Fix sketch:** Track review health separately from findings. Exit non-zero when all configured reviewers fail, or when fewer than a configured minimum succeed. In `fix`, a failed verifier should not count as a clean verifier. Include an explicit top-level status in JSON/Markdown such as `review_status: degraded|failed|ok` and a concise remediation hint for missing/invalid keys.

### Issue: Large repos are silently and nondeterministically only partially reviewed
**File:line** — `src/util/files.ts:70`, `src/util/files.ts:87`, `src/util/files.ts:101`.

**Symptom:** `readSourceTree` walks directories in filesystem order, silently skips files over 200 KB, then `serializeCodeContext` sends only the first 120,000 characters to each reviewer. The user sees `Loaded N source files`, but not which files were skipped, which files made it into the model prompt, or that most of a monorepo may have been omitted. Because entries are not sorted, different machines/filesystems can feed different files to the reviewers.

**Why it matters:** On a 10k-file repo, "review ./src" will mostly review whichever files happen to appear first. That makes results irreproducible and can miss the PR code entirely, especially in CI where checkout ordering differs from local machines.

**Fix sketch:** Sort traversal by relative path and return scan metadata: included files, skipped-by-size files, ignored dirs, prompt-truncated files, and total bytes. Print/report that metadata. For PR mode, prefer diff-aware file selection or chunked multi-pass review instead of one global 120 KB context.

### Issue: Wall-time gates do not stop hung provider calls or SAST subprocesses
**File:line** — `src/util/retry.ts:61`, `src/sast/semgrep.ts:86`, `src/sast/eslint.ts:52`, `src/sast/npm-audit.ts:62`, `src/modes/fix.ts:252`.

**Symptom:** `max_wall_time_minutes` is evaluated only after a call returns. SDK calls and spawned tools have no abort signal or timeout, so a slow LLM, stuck CLI, Semgrep download/cache stall, or hanging `npm audit` can run until the outer CI job times out.

**Why it matters:** Users set a wall-time cap because CI minutes and PR feedback latency matter. In the current shape, that cap is mostly bookkeeping, not enforcement.

**Fix sketch:** Create a run deadline at mode start. Pass an `AbortSignal` or provider timeout to API SDK calls, and add `setTimeout`/`child.kill()` handling to SAST and CLI adapters. Report `timed_out` as a distinct failure reason and apply the same review-health rules above.

### Issue: SAST skips are under-explained, and `npm audit` can lose the real error
**File:line** — `src/sast/npm-audit.ts:13`, `src/sast/npm-audit.ts:15`, `src/sast/index.ts:35`, `src/modes/review.ts:127`.

**Symptom:** If `npm audit` exits with code >1, the wrapper returns `available: false` with no `error`, even though stderr was captured. Review logging then prints `npm-audit=skipped (not installed)`. Similar "skipped" wording is used for ESLint/Semgrep whether the tool is missing, misconfigured, produced invalid JSON, or failed because the target is not a Node package.

**Why it matters:** First-run users often do not have Semgrep installed, ESLint configured, or a lockfile in the scanned path. They need to know whether zero SAST findings means "clean" or "none of the tools actually ran."

**Fix sketch:** Preserve stderr/stdout tails for all non-success paths. Use structured reasons like `missing_binary`, `config_error`, `invalid_json`, `unsupported_project`, and `tool_exit_code`. Consider failing `scan` when an explicitly enabled tool cannot run, or add `sast.required_tools`.

### Issue: `fix --max-iterations` can silently disable the fix loop
**File:line** — `src/cli.ts:173`, `src/cli.ts:185`, `src/modes/fix.ts:180`.

**Symptom:** The config schema validates `max_iterations`, but the CLI override assigns `Number(opts.maxIterations)` after schema parsing. `--max-iterations 0`, `--max-iterations -1`, or `--max-iterations nope` all bypass validation. The loop may run zero iterations, then still write a report and exit successfully unless another gate fires.

**Why it matters:** This is a classic CI footgun. A typo in a workflow input can turn `secure-review fix` into "scan plus final verification" with no file changes, while the summary still looks like a completed fix-mode run.

**Fix sketch:** Share a validated parser with the schema: integer, finite, 1..10. Reject invalid overrides before calling `runFixMode`. The report should also make zero executed iterations visually loud when fixes were requested.

### Issue: PR status ignores configured gates and summary-only severe findings
**File:line** — `src/reporters/github-pr.ts:47`, `src/reporters/github-pr.ts:107`, `src/cli.ts:309`.

**Symptom:** PR mode returns only `criticalOnDiff`, and the CLI only checks `block_on_new_critical`. A CRITICAL finding in a changed file but outside commentable diff lines is moved to the summary and the check passes. `block_on_new_high` has no effect in PR mode.

**Why it matters:** In real PRs, a security bug may be in a touched file but not on a GitHub-commentable line, especially after formatting changes or when the model points to a nearby context line. Users will see a severe finding in the review body but a green check.

**Fix sketch:** Return severity counts for inline, summary-on-touched-files, and dropped buckets. Evaluate the same gate config against inline plus summary-on-touched-files, or add explicit PR gate settings with defaults documented in README.

### Issue: Entered API keys are echoed and written without `.gitignore` help
**File:line** — `src/commands/init.ts:86`, `src/commands/init.ts:182`, `src/commands/init.ts:292`.

**Symptom:** If a user chooses "Enter API keys now", `readline.question` echoes the secret into the terminal, then writes `.env`. The init flow does not check whether `.env` is ignored by git or add it to `.gitignore`.

**Why it matters:** This is first-run UX around credentials. Users can leak keys into terminal scrollback, screen recordings, or accidentally stage `.env` in repos that do not already ignore it.

**Fix sketch:** Use a masked/no-echo prompt for secrets. Before writing `.env`, ensure `.gitignore` contains `.env` or print a blocking confirmation. Defaulting to `.env.example` is good; make the risky path safer when users opt into it.

## Nice-to-have polish

- **`src/reporters/github-pr.ts:76`** — All inline findings are sent in one `pulls.createReview` request. Large PRs with many findings may hit GitHub payload/comment limits. Chunk comments or cap inline comments with a clear overflow summary.

- **`src/cli.ts:12`** — Malformed `.env` files are ignored silently. Warn once that auto-loading failed, because the later "API key is not set" message points users in the wrong direction.

- **`src/cli.ts:328`** — `secure-review scan` requires a full `.secure-review.yml` even though it is advertised as SAST-only/no API keys. A configless default scan would make first-run triage much smoother.

- **`src/config/schema.ts:67`** — Unknown config keys are stripped by Zod defaults. Typos like `max_cost` or `finalVerification` are silently ignored. Use `.strict()` or warn on unknown keys.

- **`src/modes/fix.ts:185`** — Each fix iteration runs SAST before the writer and after the writer, but the before run is only used for counts. On large repos this doubles SAST time with little user value.

- **`WORKFLOW.md:176`** — The docs still mention the `--max-iterations 0` override and say config rejection is in `0.5.10`. That stale version note is confusing in a `0.5.11` tree.

- **`examples/.secure-review.yml:25`** — The example still says "SAST runs alongside the AI reviewers"; the current implementation runs SAST before reviewers.

## Things that are already good

- Provider calls use retry logic for common transient errors, including 429, 5xx, overloaded/high-demand messages, and nested `cause` network failures.

- Reviewer JSON parsing salvages valid items from partially malformed model responses instead of dropping the whole reviewer payload.

- Writer output is sanitized for NUL/control characters before writing, and writer target paths are checked against traversal and symlink escapes.

- `review.parallel: false` now actually runs reviewer calls sequentially in review mode.

- SAST and AI findings are normalized to scan-root-relative paths before aggregation/PR filtering.

- PR file listing uses Octokit pagination, so PRs over 300 files are no longer silently truncated at the file-list stage.

- Fork PRs are skipped before provider calls, avoiding confusing secret-access failures on untrusted forks.

- Reports include per-reviewer status and SAST status tables, which gives a useful foundation for making degraded runs fail more explicitly.
