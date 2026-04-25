/**
 * `secure-review init` — interactive scaffold for a fresh project.
 *
 * Creates a sensible `.secure-review.yml` and `.env` (or `.env.example`)
 * based on a handful of yes/no questions. The aim is that a brand-new
 * user can `npm install -D secure-review && npx secure-review init`
 * and have a working config in under 30 seconds, without reading the
 * README first.
 */
import { writeFile, access, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export interface InitOptions {
  force?: boolean;
  yes?: boolean;
}

export interface InitAnswers {
  useAnthropic: boolean;
  useOpenAI: boolean;
  useGoogle: boolean;
  enableSast: boolean;
  writeKeys: boolean;
  useLlmProxy: boolean;
  anthropicKey?: string;
  openaiKey?: string;
  googleKey?: string;
}

export async function runInit(opts: InitOptions = {}): Promise<void> {
  if (!opts.force) {
    for (const f of ['.secure-review.yml']) {
      if (await fileExists(f)) {
        console.error(
          `[31m✘[0m Refusing to overwrite ${f}. Pass --force to overwrite, or delete the file first.`,
        );
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

  await writeFile('.secure-review.yml', yaml, 'utf8');
  const envAction = await appendOrCreate(envFile, envContent);

  console.log('');
  console.log('[32m✔[0m Created .secure-review.yml');
  if (envAction === 'created') {
    console.log(`[32m✔[0m Created ${envFile}`);
  } else if (envAction === 'appended') {
    console.log(`[32m✔[0m Appended secure-review section to existing ${envFile}`);
  } else {
    console.log(`[36mℹ[0m ${envFile} already had secure-review keys — left untouched`);
  }
  console.log('');
  if (envFile === '.env.example') {
    console.log('Next steps:');
    console.log('  1. cp .env.example .env');
    console.log('  2. Edit .env and set your API keys');
    console.log('  3. npx secure-review scan ./src      # SAST only, no AI calls');
    console.log('  4. npx secure-review review ./src    # Full multi-model review');
  } else {
    console.log('Next steps:');
    console.log('  1. npx secure-review scan ./src      # SAST only, no AI calls');
    console.log('  2. npx secure-review review ./src    # Full multi-model review');
  }
  console.log('');
  console.log('Tip: keep .env out of git. The default .gitignore patterns cover it.');
}

function defaultAnswers(): InitAnswers {
  return {
    useAnthropic: true,
    useOpenAI: true,
    useGoogle: true,
    enableSast: true,
    writeKeys: false,
    useLlmProxy: false,
  };
}

async function ask(): Promise<InitAnswers> {
  const rl = createInterface({ input: stdin, output: stdout });
  const askBool = async (q: string, def: boolean): Promise<boolean> => {
    const hint = def ? '[Y/n]' : '[y/N]';
    const raw = (await rl.question(`  ${q} ${hint} `)).trim().toLowerCase();
    if (!raw) return def;
    return raw.startsWith('y');
  };
  const askText = async (q: string, allowEmpty = false): Promise<string | undefined> => {
    const raw = (await rl.question(`  ${q} `)).trim();
    if (!raw && allowEmpty) return undefined;
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
    const enableSast = await askBool(
      'Enable SAST (semgrep + eslint + npm-audit)? Catches issues AI may miss.',
      true,
    );
    console.log('');

    console.log('Local proxy:');
    const useLlmProxy = await askBool(
      'Are you using llm-proxy locally for Anthropic/Gemini? (free via Claude Max / Gemini Pro subscriptions)',
      false,
    );
    console.log('');

    console.log('API keys:');
    const writeKeys = await askBool(
      'Enter API keys now? (No = create .env.example for you to fill in later)',
      false,
    );

    let anthropicKey: string | undefined;
    let openaiKey: string | undefined;
    let googleKey: string | undefined;
    if (writeKeys) {
      console.log('');
      console.log('  Paste each key, or press Enter to leave blank.');
      if (useAnthropic && !useLlmProxy) anthropicKey = await askText('ANTHROPIC_API_KEY:', true);
      if (useOpenAI) openaiKey = await askText('OPENAI_API_KEY:', true);
      if (useGoogle && !useLlmProxy) googleKey = await askText('GOOGLE_API_KEY:', true);
    }

    return {
      useAnthropic,
      useOpenAI,
      useGoogle,
      enableSast,
      writeKeys,
      useLlmProxy,
      ...(anthropicKey !== undefined ? { anthropicKey } : {}),
      ...(openaiKey !== undefined ? { openaiKey } : {}),
      ...(googleKey !== undefined ? { googleKey } : {}),
    };
  } finally {
    rl.close();
  }
}

const SKILLS_BASE = 'node_modules/secure-review/skills';

export function generateConfig(a: InitAnswers): string {
  // Pick a sensible writer: OpenAI gpt-4o-mini is the cheapest and fastest.
  // Fall back to whichever provider is enabled.
  const writer = a.useOpenAI
    ? { provider: 'openai', model: 'gpt-4o-mini' }
    : a.useAnthropic
      ? { provider: 'anthropic', model: 'claude-haiku-4-5' }
      : { provider: 'google', model: 'gemini-2.5-flash' };

  const reviewers: string[] = [];
  if (a.useAnthropic) {
    reviewers.push(
      [
        '  - name: anthropic-haiku',
        '    provider: anthropic',
        '    model: claude-haiku-4-5',
        `    skill: ${SKILLS_BASE}/owasp-reviewer.md`,
      ].join('\n'),
    );
  }
  if (a.useOpenAI) {
    reviewers.push(
      [
        '  - name: openai-mini',
        '    provider: openai',
        '    model: gpt-4o-mini',
        `    skill: ${SKILLS_BASE}/web-sec-reviewer.md`,
      ].join('\n'),
    );
  }
  if (a.useGoogle) {
    reviewers.push(
      [
        '  - name: gemini-flash',
        '    provider: google',
        '    model: gemini-2.5-flash',
        `    skill: ${SKILLS_BASE}/dependency-reviewer.md`,
      ].join('\n'),
    );
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

export const SECURE_REVIEW_ENV_MARKER = '# === secure-review ===';

export function generateEnv(a: InitAnswers): string {
  const lines: string[] = [];
  lines.push(SECURE_REVIEW_ENV_MARKER);
  lines.push('# Generated by `secure-review init`. Edit values, keep the marker line.');
  lines.push('');
  if (a.useAnthropic) {
    if (a.useLlmProxy) {
      lines.push('ANTHROPIC_BASE_URL=http://localhost:8787');
      lines.push('ANTHROPIC_API_KEY=dummy');
    } else {
      lines.push(`ANTHROPIC_API_KEY=${a.anthropicKey ?? 'sk-ant-...'}`);
    }
    lines.push('');
  }
  if (a.useOpenAI) {
    lines.push(`OPENAI_API_KEY=${a.openaiKey ?? 'sk-...'}`);
    lines.push('');
  }
  if (a.useGoogle) {
    if (a.useLlmProxy) {
      lines.push('GOOGLE_BASE_URL=http://localhost:8787');
      lines.push('GOOGLE_API_KEY=dummy');
    } else {
      lines.push(`GOOGLE_API_KEY=${a.googleKey ?? 'AIza...'}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function appendOrCreate(file: string, content: string): Promise<'created' | 'appended' | 'unchanged'> {
  const exists = await fileExists(file);
  if (!exists) {
    await writeFile(file, content, 'utf8');
    return 'created';
  }
  const cur = await readFile(file, 'utf8');
  if (cur.includes(SECURE_REVIEW_ENV_MARKER)) return 'unchanged';
  const sep = cur.endsWith('\n') ? '\n' : '\n\n';
  await writeFile(file, cur + sep + content, 'utf8');
  return 'appended';
}
