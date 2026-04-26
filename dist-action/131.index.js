export const id = 131;
export const ids = [131];
export const modules = {

/***/ 131:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   runSetupSecrets: () => (/* binding */ runSetupSecrets)
/* harmony export */ });
/* harmony import */ var node_child_process__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1421);
/* harmony import */ var node_child_process__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_child_process__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_fs_promises__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(1455);
/* harmony import */ var node_fs_promises__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_fs_promises__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var js_yaml__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(3243);
/* harmony import */ var _util_logger_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(6618);
/**
 * `secure-review setup-secrets` — sets the API keys from your local `.env`
 * as GitHub Actions secrets via the `gh` CLI.
 *
 * Why this exists: anyone running the tool in CI needs the same set of
 * provider keys configured as GitHub secrets, and most users do this by
 * clicking through the GitHub web UI one-by-one. With `gh` already
 * installed and authenticated, the tool can do it in one command.
 *
 * Behavior:
 *   - Reads which providers are enabled from `.secure-review.yml`
 *   - For each enabled provider, looks up the corresponding `*_API_KEY`
 *     from `process.env` (auto-loaded from `.env` by the CLI shim)
 *   - Pipes the value to `gh secret set <NAME>` via stdin (so the secret
 *     never appears on a shell command line / process list)
 *   - Skips silently for any key that's missing or looks like a placeholder
 *
 * If `gh` isn't installed or the user isn't authenticated, prints the
 * manual fallback (`gh secret set NAME` instructions / web UI URL) and exits.
 */




const PROVIDER_ENV_KEY = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
};
const PLACEHOLDER_PATTERNS = [
    /^$/,
    /^sk-ant-\.\.\.$/,
    /^sk-\.\.\.$/,
    /^AIza\.\.\.$/,
    /^dummy$/i,
    /^placeholder$/i,
    /^changeme$/i,
];
function isPlaceholder(value) {
    return PLACEHOLDER_PATTERNS.some((re) => re.test(value));
}
function ghSecretSet(name, value, repo) {
    return new Promise((resolve, reject) => {
        const args = ['secret', 'set', name];
        if (repo)
            args.push('--repo', repo);
        // Pipe the value via stdin — never appears on the command line / in `ps`.
        const proc = (0,node_child_process__WEBPACK_IMPORTED_MODULE_0__.spawn)('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        proc.on('error', reject);
        proc.on('exit', (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`gh exited ${code}: ${stderr.trim()}`));
            }
        });
        proc.stdin.write(value);
        proc.stdin.end();
    });
}
function ghOk(args) {
    return new Promise((resolve) => {
        const proc = (0,node_child_process__WEBPACK_IMPORTED_MODULE_0__.spawn)('gh', args, { stdio: 'ignore' });
        proc.on('error', () => resolve(false));
        proc.on('exit', (code) => resolve(code === 0));
    });
}
function manualFallbackHint(repo) {
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('');
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('Manual setup (without gh CLI):');
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('  Option 1 — gh CLI later:');
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('    gh secret set ANTHROPIC_API_KEY   # paste when prompted');
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('    gh secret set OPENAI_API_KEY');
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('    gh secret set GOOGLE_API_KEY');
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('  Option 2 — GitHub web UI:');
    if (repo) {
        _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info(`    https://github.com/${repo}/settings/secrets/actions`);
    }
    else {
        _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('    https://github.com/<owner>/<repo>/settings/secrets/actions');
    }
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('');
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('You only need to set secrets for providers you actually use. One key (e.g. OPENAI_API_KEY only) is fine — secure-review runs with as few as 1 reader.');
}
async function runSetupSecrets(opts = {}) {
    // 1) gh installed?
    if (!(await ghOk(['--version']))) {
        _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.error('GitHub CLI (gh) not found.');
        _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('Install: https://cli.github.com/');
        manualFallbackHint(opts.repo);
        process.exit(1);
    }
    // 2) gh authenticated?
    if (!(await ghOk(['auth', 'status']))) {
        _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.error('Not logged in to GitHub. Run: gh auth login');
        manualFallbackHint(opts.repo);
        process.exit(1);
    }
    // 3) Load config to figure out which providers are enabled
    const configPath = opts.config ?? '.secure-review.yml';
    let config;
    try {
        const raw = await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_1__.readFile)(configPath, 'utf8');
        config = js_yaml__WEBPACK_IMPORTED_MODULE_2__/* .load */ .Hh(raw);
    }
    catch (err) {
        _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.error(`Could not read ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
        _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('Run `secure-review init` first to generate a config.');
        process.exit(1);
    }
    const enabledProviders = new Set();
    for (const r of config.reviewers ?? []) {
        if (r.provider)
            enabledProviders.add(r.provider);
    }
    if (config.writer?.provider)
        enabledProviders.add(config.writer.provider);
    if (enabledProviders.size === 0) {
        _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.error(`No providers found in ${configPath} (no reviewers and no writer.provider).`);
        process.exit(1);
    }
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.header(`Setting GitHub secrets${opts.repo ? ` on ${opts.repo}` : ' (auto-detected repo)'}`);
    // 4) Set each enabled provider's secret
    let setCount = 0;
    let skipCount = 0;
    let failCount = 0;
    for (const provider of enabledProviders) {
        const envKey = PROVIDER_ENV_KEY[provider];
        if (!envKey) {
            _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.warn(`Unknown provider "${provider}" — no env-key mapping; skipping.`);
            continue;
        }
        const value = process.env[envKey];
        if (!value || isPlaceholder(value)) {
            _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.warn(`${envKey}: ${value ? 'looks like a placeholder' : 'not set in environment'} — skipping.`);
            skipCount += 1;
            continue;
        }
        try {
            await ghSecretSet(envKey, value, opts.repo);
            _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.success(`${envKey}: set on GitHub`);
            setCount += 1;
        }
        catch (err) {
            _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.error(`${envKey}: failed — ${err instanceof Error ? err.message : String(err)}`);
            failCount += 1;
        }
    }
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('');
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info(`Summary: ${setCount} set · ${skipCount} skipped · ${failCount} failed`);
    _util_logger_js__WEBPACK_IMPORTED_MODULE_3__/* .log */ .Rm.info('Verify with: gh secret list');
    if (failCount > 0)
        process.exit(2);
}


/***/ })

};

//# sourceMappingURL=131.index.js.map