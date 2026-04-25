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

export type ProviderName = 'anthropic' | 'openai' | 'google';

export interface InitAnswers {
  useAnthropic: boolean;
  useOpenAI: boolean;
  useGoogle: boolean;
  writerProvider: ProviderName;
  writerModel: string;
  enableSast: boolean;
  writeKeys: boolean;
  anthropicKey?: string;
  openaiKey?: string;
  googleKey?: string;
}

// Sensible *strong* defaults for the writer. The writer MODIFIES files,
// so it's worth spending more on it than on readers (which only report).
// Reader models stay on the cheapest tier — see READER_MODEL_DEFAULTS.
export const WRITER_MODEL_DEFAULTS: Record<ProviderName, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  google: 'gemini-2.5-pro',
};

export const READER_MODEL_DEFAULTS: Record<ProviderName, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.5-flash',
};

export async function runInit(opts: InitOptions = {}): Promise<void> {
  if (!opts.force) {
    for (const f of ['.secure-review.yml']) {
      if (await fileExists(f)) {
        console.error(
          `[31m✘[0m Refusing to overwrite ${f}. Pass --force to overwrite, or delete the file first.`,
        );
        process.exit(1);
      }
    }
  }

  const answers = opts.yes ? defaultAnswers() : await ask();
  if (!answers.useAnthropic && !answers.useOpenAI && !answers.useGoogle) {
    console.error('[31m✘[0m At least one provider must be enabled.');
    process.exit(1);
  }

  const enabled: ProviderName[] = [
    ...(answers.useAnthropic ? (['anthropic'] as const) : []),
    ...(answers.useOpenAI ? (['openai'] as const) : []),
    ...(answers.useGoogle ? (['google'] as const) : []),
  ];
  if (!enabled.includes(answers.writerProvider)) {
    console.error(
      `[31m✘[0m Writer provider "${answers.writerProvider}" is not enabled. Enabled: ${enabled.join(', ')}.`,
    );
    process.exit(1);
  }

  const yaml = generateConfig(answers);
  const envContent = generateEnv(answers);
  const envFile = answers.writeKeys ? '.env' : '.env.example';

  await writeFile('.secure-review.yml', yaml, 'utf8');
  const envAction = await appendOrCreate(envFile, envContent);

  console.log('');
  console.log('[32m✔[0m Created .secure-review.yml');
  if (envAction === 'created') {
    console.log(`[32m✔[0m Created ${envFile}`);
  } else if (envAction === 'appended') {
    console.log(`[32m✔[0m Appended secure-review section to existing ${envFile}`);
  } else {
    console.log(`[36mℹ[0m ${envFile} already had secure-review keys — left untouched`);
  }
  console.log('');
  console.log(
    `[36mℹ[0m Writer: ${answers.writerProvider}/${answers.writerModel}  ·  Readers: ${enabled.length} (defaults are cheap; edit .secure-review.yml to change)`,
  );
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
  console.log('Tip: every model (writer and readers) is just a string in .secure-review.yml.');
  console.log('     Edit freely — e.g. switch a reader to gpt-4o or gemini-2.5-pro for stronger audits.');
}

function defaultAnswers(): InitAnswers {
  return {
    useAnthropic: true,
    useOpenAI: true,
    useGoogle: true,
    writerProvider: 'anthropic',
    writerModel: WRITER_MODEL_DEFAULTS.anthropic,
    enableSast: true,
    writeKeys: false,
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
  const askChoice = async (q: string, choices: string[], def: string): Promise<string> => {
    const raw = (await rl.question(`  ${q} (${choices.join('/')}) [${def}] `)).trim().toLowerCase();
    if (!raw) return def;
    if (choices.includes(raw)) return raw;
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

    const enabledProviders: string[] = [
      ...(useAnthropic ? ['anthropic'] : []),
      ...(useOpenAI ? ['openai'] : []),
      ...(useGoogle ? ['google'] : []),
    ];

    console.log('Writer — the ONE model that EDITS files in fix mode.');
    console.log('  Readers report; the writer applies fixes. Pick at least as strong as');
    console.log('  whatever generated the original code (e.g. Sonnet, GPT-4o, or Gemini Pro).');
    const defaultWriterProvider = useAnthropic ? 'anthropic' : useOpenAI ? 'openai' : 'google';
    const writerProvider = (await askChoice(
      'Writer provider?',
      enabledProviders,
      defaultWriterProvider,
    )) as ProviderName;
    const defaultWriterModel = WRITER_MODEL_DEFAULTS[writerProvider];
    const writerModelInput = await askText(
      `Writer model? [${defaultWriterModel}] (free-form — type any model name your provider supports)`,
      true,
    );
    const writerModel = writerModelInput || defaultWriterModel;
    console.log('');

    console.log('Static analysis:');
    const enableSast = await askBool(
      'Enable SAST (semgrep + eslint + npm-audit)? Catches issues AI may miss.',
      true,
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
      if (useAnthropic) anthropicKey = await askText('ANTHROPIC_API_KEY:', true);
      if (useOpenAI) openaiKey = await askText('OPENAI_API_KEY:', true);
      if (useGoogle) googleKey = await askText('GOOGLE_API_KEY:', true);
    }

    return {
      useAnthropic,
      useOpenAI,
      useGoogle,
      writerProvider,
      writerModel,
      enableSast,
      writeKeys,
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
  const reviewers: string[] = [];
  if (a.useAnthropic) {
    reviewers.push(
      [
        '  - name: anthropic-haiku',
        '    provider: anthropic',
        `    model: ${READER_MODEL_DEFAULTS.anthropic}`,
        `    skill: ${SKILLS_BASE}/owasp-reviewer.md`,
      ].join('\n'),
    );
  }
  if (a.useOpenAI) {
    reviewers.push(
      [
        '  - name: openai-mini',
        '    provider: openai',
        `    model: ${READER_MODEL_DEFAULTS.openai}`,
        `    skill: ${SKILLS_BASE}/web-sec-reviewer.md`,
      ].join('\n'),
    );
  }
  if (a.useGoogle) {
    reviewers.push(
      [
        '  - name: gemini-flash',
        '    provider: google',
        `    model: ${READER_MODEL_DEFAULTS.google}`,
        `    skill: ${SKILLS_BASE}/dependency-reviewer.md`,
      ].join('\n'),
    );
  }

  return `# secure-review configuration
# Generated by 'secure-review init'. Edit freely — every model name below
# is just a string. Swap providers, upgrade models, change skills, etc.

writer:
  # The ONLY role that modifies files. Pick at least as strong as whatever
  # generated the original code being reviewed.
  provider: ${a.writerProvider}
  model: ${a.writerModel}
  skill: ${SKILLS_BASE}/secure-node-writer.md

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
