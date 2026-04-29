export const id = 722;
export const ids = [722];
export const modules = {

/***/ 722:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   runInit: () => (/* binding */ runInit)
/* harmony export */ });
/* unused harmony exports WRITER_MODEL_DEFAULTS, READER_MODEL_DEFAULTS, generateConfig, generateWorkflow, SECURE_REVIEW_ENV_MARKER, generateEnv */
/* harmony import */ var node_fs_promises__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1455);
/* harmony import */ var node_fs_promises__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_fs_promises__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_readline_promises__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(6848);
/* harmony import */ var node_readline_promises__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_readline_promises__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_process__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(1708);
/* harmony import */ var node_process__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_process__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(6760);
/* harmony import */ var node_path__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(node_path__WEBPACK_IMPORTED_MODULE_3__);
/**
 * `secure-review init` — interactive scaffold for a fresh project.
 *
 * Creates a sensible `.secure-review.yml` and `.env` (or `.env.example`)
 * based on a handful of yes/no questions. The aim is that a brand-new
 * user can `npm install -D secure-review && npx secure-review init`
 * and have a working config in under 30 seconds, without reading the
 * README first.
 */




// Sensible *strong* defaults for the writer. The writer MODIFIES files,
// so it's worth spending more on it than on readers (which only report).
// Reader models stay on the cheapest tier — see READER_MODEL_DEFAULTS.
const WRITER_MODEL_DEFAULTS = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    google: 'gemini-2.5-pro',
};
const READER_MODEL_DEFAULTS = {
    anthropic: 'claude-haiku-4-5',
    openai: 'gpt-4o-mini',
    google: 'gemini-2.5-flash',
};
async function runInit(opts = {}) {
    if (!opts.force) {
        for (const f of ['.secure-review.yml']) {
            if (await fileExists(f)) {
                console.error(`[31m✘[0m Refusing to overwrite ${f}. Pass --force to overwrite, or delete the file first.`);
                process.exit(1);
            }
        }
    }
    const answers = opts.yes ? defaultAnswers() : await ask();
    if (!answers.useAnthropic && !answers.useOpenAI && !answers.useGoogle) {
        console.error('[31m✘[0m At least one provider must be enabled.');
        process.exit(1);
    }
    const enabled = [
        ...(answers.useAnthropic ? ['anthropic'] : []),
        ...(answers.useOpenAI ? ['openai'] : []),
        ...(answers.useGoogle ? ['google'] : []),
    ];
    if (!enabled.includes(answers.writerProvider)) {
        console.error(`[31m✘[0m Writer provider "${answers.writerProvider}" is not enabled. Enabled: ${enabled.join(', ')}.`);
        process.exit(1);
    }
    const localSkills = await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.access)('skills').then(() => true).catch(() => false);
    const skillsBase = localSkills ? SKILLS_BASE_LOCAL : SKILLS_BASE_DEFAULT;
    const yaml = generateConfig(answers, skillsBase);
    const envContent = generateEnv(answers);
    const envFile = answers.writeKeys ? '.env' : '.env.example';
    await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.writeFile)('.secure-review.yml', yaml, 'utf8');
    const envAction = await appendOrCreate(envFile, envContent);
    // GitHub Actions workflow file (active or example, depending on user choice)
    let workflowAction = 'skipped';
    let workflowPath;
    if (answers.githubAction !== 'skip') {
        workflowPath =
            answers.githubAction === 'active'
                ? '.github/workflows/secure-review.yml'
                : '.github/workflows/secure-review.yml.example';
        if ((await fileExists(workflowPath)) && !opts.force) {
            workflowAction = 'preexisted';
        }
        else {
            await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.mkdir)((0,node_path__WEBPACK_IMPORTED_MODULE_3__.dirname)(workflowPath), { recursive: true });
            await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.writeFile)(workflowPath, generateWorkflow(answers), 'utf8');
            workflowAction = 'created';
        }
    }
    console.log('');
    console.log('[32m✔[0m Created .secure-review.yml');
    if (envAction === 'created') {
        console.log(`[32m✔[0m Created ${envFile}`);
    }
    else if (envAction === 'appended') {
        console.log(`[32m✔[0m Appended secure-review section to existing ${envFile}`);
    }
    else {
        console.log(`[36mℹ[0m ${envFile} already had secure-review keys — left untouched`);
    }
    if (workflowAction === 'created' && workflowPath) {
        console.log(`[32m✔[0m Created ${workflowPath}`);
        if (answers.githubAction === 'example') {
            console.log(`[36mℹ[0m To activate later: mv ${workflowPath} .github/workflows/secure-review.yml`);
        }
        console.log(`[36mℹ[0m After you push to GitHub, run: npx secure-review setup-secrets`);
        console.log(`   (sets API keys as GitHub secrets via gh CLI; or set them manually in repo Settings → Secrets)`);
    }
    else if (workflowAction === 'preexisted' && workflowPath) {
        console.log(`[33m![0m ${workflowPath} already exists — left untouched (pass --force to overwrite)`);
    }
    console.log('');
    console.log(`[36mℹ[0m Writer: ${answers.writerProvider}/${answers.writerModel}  ·  Readers: ${enabled.length} (defaults are cheap; edit .secure-review.yml to change)`);
    console.log('');
    if (envFile === '.env.example') {
        console.log('Next steps:');
        console.log('  1. cp .env.example .env');
        console.log('  2. Edit .env and set your API keys');
        console.log('  3. npx secure-review scan ./src      # SAST only, no AI calls');
        console.log('  4. npx secure-review review ./src    # Full multi-model review');
    }
    else {
        console.log('Next steps:');
        console.log('  1. npx secure-review scan ./src      # SAST only, no AI calls');
        console.log('  2. npx secure-review review ./src    # Full multi-model review');
    }
    console.log('');
    console.log('Tip: every model (writer and readers) is just a string in .secure-review.yml.');
    console.log('     Edit freely — e.g. switch a reader to gpt-4o or gemini-2.5-pro for stronger audits.');
}
function defaultAnswers() {
    return {
        useAnthropic: true,
        useOpenAI: true,
        useGoogle: true,
        writerProvider: 'anthropic',
        writerModel: WRITER_MODEL_DEFAULTS.anthropic,
        // Default = 3 since --yes enables all 3 providers; full-rotation-clean
        // exit needs max_iterations >= N to be reachable.
        maxIterations: 3,
        enableSast: true,
        writeKeys: false,
        // Safer default for --yes: emit the example file (renamed by user to activate)
        // rather than auto-arming the action on the user's next PR push.
        githubAction: 'example',
    };
}
async function ask() {
    const rl = (0,node_readline_promises__WEBPACK_IMPORTED_MODULE_1__.createInterface)({ input: node_process__WEBPACK_IMPORTED_MODULE_2__.stdin, output: node_process__WEBPACK_IMPORTED_MODULE_2__.stdout });
    const askBool = async (q, def) => {
        const hint = def ? '[Y/n]' : '[y/N]';
        const raw = (await rl.question(`  ${q} ${hint} `)).trim().toLowerCase();
        if (!raw)
            return def;
        return raw.startsWith('y');
    };
    const askText = async (q, allowEmpty = false) => {
        const raw = (await rl.question(`  ${q} `)).trim();
        if (!raw && allowEmpty)
            return undefined;
        return raw;
    };
    const askChoice = async (q, choices, def) => {
        const raw = (await rl.question(`  ${q} (${choices.join('/')}) [${def}] `)).trim().toLowerCase();
        if (!raw)
            return def;
        if (choices.includes(raw))
            return raw;
        console.log(`    Invalid choice "${raw}", using default "${def}"`);
        return def;
    };
    try {
        console.log('');
        console.log('[1m[35m━━ secure-review init ━━[0m');
        console.log('');
        console.log('A few questions to scaffold your config.');
        console.log('Press Enter to accept the default in [brackets].');
        console.log('');
        console.log('[36mℹ[0m  Heads-up: every model choice below (readers AND writer) is just a string');
        console.log('   in the generated .secure-review.yml. Edit it later to swap any model — pick');
        console.log('   sensible starts now, refine after seeing the first run.');
        console.log('');
        console.log('Reviewers — they only READ code and report findings (pick at least one):');
        const useAnthropic = await askBool('Use Anthropic Claude (reader: claude-haiku-4-5)?', true);
        const useOpenAI = await askBool('Use OpenAI GPT (reader: gpt-4o-mini)?', true);
        const useGoogle = await askBool('Use Google Gemini (reader: gemini-2.5-flash)?', true);
        console.log('');
        if (!useAnthropic && !useOpenAI && !useGoogle) {
            throw new Error('At least one provider must be enabled.');
        }
        const enabledProviders = [
            ...(useAnthropic ? ['anthropic'] : []),
            ...(useOpenAI ? ['openai'] : []),
            ...(useGoogle ? ['google'] : []),
        ];
        console.log('Writer — the ONE model that EDITS files in fix mode.');
        console.log('  Readers report; the writer applies fixes. Pick at least as strong as');
        console.log('  whatever generated the original code (e.g. Sonnet, GPT-4o, or Gemini Pro).');
        const defaultWriterProvider = useAnthropic ? 'anthropic' : useOpenAI ? 'openai' : 'google';
        const writerProvider = (await askChoice('Writer provider?', enabledProviders, defaultWriterProvider));
        const defaultWriterModel = WRITER_MODEL_DEFAULTS[writerProvider];
        const writerModelInput = await askText(`Writer model? [${defaultWriterModel}] (free-form — type any model name your provider supports)`, true);
        const writerModel = writerModelInput || defaultWriterModel;
        console.log('');
        console.log('Fix mode behavior:');
        console.log('  Each iteration: writer fixes the current findings, then the next reader');
        console.log('  in rotation audits with fresh eyes. The "full-rotation-clean" early-exit');
        console.log('  only fires after N consecutive verifiers all see clean — so a meaningful');
        console.log(`  default is N (= ${enabledProviders.length} for your setup).`);
        const N = enabledProviders.length;
        const maxIterInput = await askText(`  Max iterations of the fix loop? [${N}]`, true);
        const parsedMaxIter = maxIterInput ? Number.parseInt(maxIterInput, 10) : NaN;
        const maxIterations = Number.isFinite(parsedMaxIter) && parsedMaxIter >= 1 && parsedMaxIter <= 10 ? parsedMaxIter : N;
        if (maxIterInput && !Number.isFinite(parsedMaxIter)) {
            console.log(`    "${maxIterInput}" isn't an integer from 1 to 10 — using default ${N}`);
        }
        else if (maxIterInput && (parsedMaxIter < 1 || parsedMaxIter > 10)) {
            console.log(`    max_iterations must be between 1 and 10 — using default ${N}`);
        }
        else if (maxIterations < N) {
            console.log(`    Note: max_iterations=${maxIterations} < N=${N}; the "full-rotation-clean" early-exit cannot fire (needs ${N} consecutive cleans).`);
        }
        console.log('');
        console.log('Static analysis:');
        const enableSast = await askBool('Enable SAST (semgrep + eslint + npm-audit)? Catches issues AI may miss.', true);
        console.log('');
        console.log('GitHub Action:');
        console.log('  Auto-runs the tool on every PR and posts inline review comments.');
        console.log('  - active:  writes .github/workflows/secure-review.yml (runs on the next PR)');
        console.log('  - example: writes .github/workflows/secure-review.yml.example');
        console.log('             (you rename to .yml when you want to enable it)');
        console.log('  - skip:    no CI file written');
        const githubAction = (await askChoice('GitHub Action workflow?', ['active', 'example', 'skip'], 'example'));
        console.log('');
        console.log('API keys:');
        const writeKeys = await askBool('Enter API keys now? (No = create .env.example for you to fill in later)', false);
        let anthropicKey;
        let openaiKey;
        let googleKey;
        if (writeKeys) {
            console.log('');
            console.log('  Paste each key, or press Enter to leave blank.');
            if (useAnthropic)
                anthropicKey = await askText('ANTHROPIC_API_KEY:', true);
            if (useOpenAI)
                openaiKey = await askText('OPENAI_API_KEY:', true);
            if (useGoogle)
                googleKey = await askText('GOOGLE_API_KEY:', true);
        }
        return {
            useAnthropic,
            useOpenAI,
            useGoogle,
            writerProvider,
            writerModel,
            maxIterations,
            enableSast,
            writeKeys,
            githubAction,
            ...(anthropicKey !== undefined ? { anthropicKey } : {}),
            ...(openaiKey !== undefined ? { openaiKey } : {}),
            ...(googleKey !== undefined ? { googleKey } : {}),
        };
    }
    finally {
        rl.close();
    }
}
const SKILLS_BASE_DEFAULT = 'node_modules/secure-review/skills';
const SKILLS_BASE_LOCAL = 'skills';
function generateConfig(a, skillsBase = SKILLS_BASE_DEFAULT) {
    const maxIterations = normalizeMaxIterations(a.maxIterations);
    const reviewers = [];
    if (a.useAnthropic) {
        reviewers.push([
            '  - name: anthropic-haiku',
            '    provider: anthropic',
            `    model: ${READER_MODEL_DEFAULTS.anthropic}`,
            `    skill: ${skillsBase}/owasp-reviewer.md`,
        ].join('\n'));
    }
    if (a.useOpenAI) {
        reviewers.push([
            '  - name: openai-mini',
            '    provider: openai',
            `    model: ${READER_MODEL_DEFAULTS.openai}`,
            `    skill: ${skillsBase}/web-sec-reviewer.md`,
        ].join('\n'));
    }
    if (a.useGoogle) {
        reviewers.push([
            '  - name: gemini-flash',
            '    provider: google',
            `    model: ${READER_MODEL_DEFAULTS.google}`,
            `    skill: ${skillsBase}/dependency-reviewer.md`,
        ].join('\n'));
    }
    return `# secure-review configuration
# Generated by 'secure-review init'. Edit freely — every model name below
# is just a string. Swap providers, upgrade models, change skills, etc.

writer:
  # The ONLY role that modifies files. Pick at least as strong as whatever
  # generated the original code being reviewed.
  provider: ${a.writerProvider}
  model: ${a.writerModel}
  skill: ${skillsBase}/secure-node-writer.md

reviewers:
  # Readers only REPORT. Defaults are the cheapest tier per provider —
  # upgrade to gpt-4o / claude-sonnet-4-6 / gemini-2.5-pro for stronger audits.
${reviewers.join('\n')}

sast:
  enabled: ${a.enableSast ? 'true' : 'false'}
  tools: [semgrep, eslint, npm_audit]
  inject_into_reviewer_context: true

review:
  parallel: true

fix:
  mode: sequential_rotation
  # max_iterations is the loop ceiling. The "full-rotation-clean" early
  # exit needs N consecutive verifiers to all see clean (where N = number
  # of readers above), so max_iterations >= N is recommended.
  max_iterations: ${maxIterations}
  final_verification: all_reviewers

gates:
  block_on_new_critical: true
  max_cost_usd: 5
  max_wall_time_minutes: 15
`;
}
function normalizeMaxIterations(n) {
    if (!Number.isFinite(n))
        return 1;
    return Math.min(10, Math.max(1, Math.trunc(n)));
}
/**
 * Render the GitHub Actions workflow for this project. Only includes env
 * vars for providers the user actually enabled, so the user only needs to
 * set up GitHub secrets for the keys they actually use.
 *
 * The `npm ci` step is critical: without it, the action runs in a fresh
 * checkout where `node_modules/secure-review/skills/...` (the path written
 * into the user's .secure-review.yml) doesn't exist and skill loading fails.
 */
function generateWorkflow(a) {
    const envLines = [];
    if (a.useAnthropic)
        envLines.push('          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}');
    if (a.useOpenAI)
        envLines.push('          OPENAI_API_KEY:    ${{ secrets.OPENAI_API_KEY }}');
    if (a.useGoogle)
        envLines.push('          GOOGLE_API_KEY:    ${{ secrets.GOOGLE_API_KEY }}');
    envLines.push('          GITHUB_TOKEN:      ${{ secrets.GITHUB_TOKEN }}');
    return `# Generated by 'secure-review init'. Edit freely.
# To activate this workflow if it was emitted as .yml.example, rename to .yml.
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
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      # npm ci is required so the .secure-review.yml's
      # node_modules/secure-review/skills/... paths resolve in the runner.
      - run: npm ci
      - uses: fonCki/secure-review@v1
        env:
${envLines.join('\n')}
`;
}
const SECURE_REVIEW_ENV_MARKER = '# === secure-review ===';
function generateEnv(a) {
    const lines = [];
    lines.push(SECURE_REVIEW_ENV_MARKER);
    lines.push('# Generated by `secure-review init`. Edit values, keep the marker line.');
    lines.push('');
    if (a.useAnthropic) {
        lines.push(`ANTHROPIC_API_KEY=${a.anthropicKey ?? 'sk-ant-...'}`);
        lines.push('');
    }
    if (a.useOpenAI) {
        lines.push(`OPENAI_API_KEY=${a.openaiKey ?? 'sk-...'}`);
        lines.push('');
    }
    if (a.useGoogle) {
        lines.push(`GOOGLE_API_KEY=${a.googleKey ?? 'AIza...'}`);
        lines.push('');
    }
    return lines.join('\n');
}
async function fileExists(p) {
    try {
        await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.access)(p);
        return true;
    }
    catch {
        return false;
    }
}
async function appendOrCreate(file, content) {
    const exists = await fileExists(file);
    if (!exists) {
        await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.writeFile)(file, content, 'utf8');
        return 'created';
    }
    const cur = await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.readFile)(file, 'utf8');
    if (cur.includes(SECURE_REVIEW_ENV_MARKER))
        return 'unchanged';
    const sep = cur.endsWith('\n') ? '\n' : '\n\n';
    await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.writeFile)(file, cur + sep + content, 'utf8');
    return 'appended';
}


/***/ })

};

//# sourceMappingURL=722.index.js.map