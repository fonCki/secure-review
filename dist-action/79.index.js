export const id = 79;
export const ids = [79];
export const modules = {

/***/ 4079:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   runInit: () => (/* binding */ runInit)
/* harmony export */ });
/* unused harmony exports generateConfig, generateEnv */
/* harmony import */ var node_fs_promises__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1455);
/* harmony import */ var node_fs_promises__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(node_fs_promises__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var node_readline_promises__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(6848);
/* harmony import */ var node_readline_promises__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(node_readline_promises__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var node_process__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(1708);
/* harmony import */ var node_process__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(node_process__WEBPACK_IMPORTED_MODULE_2__);
/**
 * `secure-review init` — interactive scaffold for a fresh project.
 *
 * Creates a sensible `.secure-review.yml` and `.env` (or `.env.example`)
 * based on a handful of yes/no questions. The aim is that a brand-new
 * user can `npm install -D secure-review && npx secure-review init`
 * and have a working config in under 30 seconds, without reading the
 * README first.
 */



async function runInit(opts = {}) {
    if (!opts.force) {
        for (const f of ['.secure-review.yml']) {
            if (await fileExists(f)) {
                console.error(`[31m✘[0m Refusing to overwrite ${f}. Pass --force to overwrite, or delete the file first.`);
                process.exit(1);
            }
        }
    }
    const answers = opts.yes ? defaultAnswers() : await ask();
    if (!answers.useAnthropic && !answers.useOpenAI && !answers.useGoogle) {
        console.error('[31m✘[0m At least one provider must be enabled.');
        process.exit(1);
    }
    const yaml = generateConfig(answers);
    const envContent = generateEnv(answers);
    const envFile = answers.writeKeys ? '.env' : '.env.example';
    await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.writeFile)('.secure-review.yml', yaml, 'utf8');
    await (0,node_fs_promises__WEBPACK_IMPORTED_MODULE_0__.writeFile)(envFile, envContent, 'utf8');
    console.log('');
    console.log('[32m✔[0m Created .secure-review.yml');
    console.log(`[32m✔[0m Created ${envFile}`);
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
    console.log('Tip: keep .env out of git. The default .gitignore patterns cover it.');
}
function defaultAnswers() {
    return {
        useAnthropic: true,
        useOpenAI: true,
        useGoogle: true,
        enableSast: true,
        writeKeys: false,
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
    try {
        console.log('');
        console.log('[1m[35m━━ secure-review init ━━[0m');
        console.log('');
        console.log('A few questions to scaffold your config.');
        console.log('Press Enter to accept the default in [brackets].');
        console.log('');
        console.log('Reviewers (pick at least one):');
        const useAnthropic = await askBool('Use Anthropic Claude (claude-haiku-4-5)?', true);
        const useOpenAI = await askBool('Use OpenAI GPT (gpt-4o-mini)?', true);
        const useGoogle = await askBool('Use Google Gemini (gemini-2.5-flash)?', true);
        console.log('');
        console.log('Static analysis:');
        const enableSast = await askBool('Enable SAST (semgrep + eslint + npm-audit)? Catches issues AI may miss.', true);
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
            enableSast,
            writeKeys,
            ...(anthropicKey !== undefined ? { anthropicKey } : {}),
            ...(openaiKey !== undefined ? { openaiKey } : {}),
            ...(googleKey !== undefined ? { googleKey } : {}),
        };
    }
    finally {
        rl.close();
    }
}
const SKILLS_BASE = 'node_modules/secure-review/skills';
function generateConfig(a) {
    // Pick a sensible writer: OpenAI gpt-4o-mini is the cheapest and fastest.
    // Fall back to whichever provider is enabled.
    const writer = a.useOpenAI
        ? { provider: 'openai', model: 'gpt-4o-mini' }
        : a.useAnthropic
            ? { provider: 'anthropic', model: 'claude-haiku-4-5' }
            : { provider: 'google', model: 'gemini-2.5-flash' };
    const reviewers = [];
    if (a.useAnthropic) {
        reviewers.push([
            '  - name: anthropic-haiku',
            '    provider: anthropic',
            '    model: claude-haiku-4-5',
            `    skill: ${SKILLS_BASE}/owasp-reviewer.md`,
        ].join('\n'));
    }
    if (a.useOpenAI) {
        reviewers.push([
            '  - name: openai-mini',
            '    provider: openai',
            '    model: gpt-4o-mini',
            `    skill: ${SKILLS_BASE}/web-sec-reviewer.md`,
        ].join('\n'));
    }
    if (a.useGoogle) {
        reviewers.push([
            '  - name: gemini-flash',
            '    provider: google',
            '    model: gemini-2.5-flash',
            `    skill: ${SKILLS_BASE}/dependency-reviewer.md`,
        ].join('\n'));
    }
    return `# secure-review configuration
# Generated by 'secure-review init'. Edit freely.

writer:
  provider: ${writer.provider}
  model: ${writer.model}
  skill: ${SKILLS_BASE}/secure-node-writer.md

reviewers:
${reviewers.join('\n')}

sast:
  enabled: ${a.enableSast ? 'true' : 'false'}
  tools: [semgrep, eslint, npm_audit]
  inject_into_reviewer_context: true

review:
  parallel: true

fix:
  mode: sequential_rotation
  max_iterations: 3
  final_verification: all_reviewers

gates:
  block_on_new_critical: true
  max_cost_usd: 5
  max_wall_time_minutes: 15
`;
}
function generateEnv(a) {
    const lines = [];
    lines.push('# secure-review API keys');
    lines.push('# Keep this file out of git. The default .gitignore catches it.');
    lines.push('');
    if (a.useAnthropic) {
        lines.push(`ANTHROPIC_API_KEY=${a.anthropicKey ?? 'sk-ant-...'}`);
        lines.push('# ANTHROPIC_BASE_URL=http://localhost:8787   # uncomment to route through llm-proxy');
        lines.push('');
    }
    if (a.useOpenAI) {
        lines.push(`OPENAI_API_KEY=${a.openaiKey ?? 'sk-...'}`);
        lines.push('');
    }
    if (a.useGoogle) {
        lines.push(`GOOGLE_API_KEY=${a.googleKey ?? 'AIza...'}`);
        lines.push('# GOOGLE_BASE_URL=http://localhost:8787       # uncomment to route through llm-proxy');
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


/***/ })

};

//# sourceMappingURL=79.index.js.map