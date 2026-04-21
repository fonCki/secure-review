import { describe, expect, it } from 'vitest';
import { getAdapter } from '../src/adapters/factory.js';
import { EnvSchema } from '../src/config/schema.js';
import { AnthropicAPIAdapter } from '../src/adapters/anthropic-api.js';
import { AnthropicCLIAdapter } from '../src/adapters/anthropic-cli.js';

describe('factory', () => {
  it('selects API adapter by default', () => {
    const env = EnvSchema.parse({ ANTHROPIC_API_KEY: 'x' });
    const adapter = getAdapter({ provider: 'anthropic', model: 'claude-sonnet-4-6' }, env);
    expect(adapter).toBeInstanceOf(AnthropicAPIAdapter);
    expect(adapter.mode).toBe('api');
  });

  it('selects CLI adapter when ANTHROPIC_MODE=cli', () => {
    const env = EnvSchema.parse({ ANTHROPIC_MODE: 'cli' });
    const adapter = getAdapter({ provider: 'anthropic', model: 'claude-sonnet-4-6' }, env);
    expect(adapter).toBeInstanceOf(AnthropicCLIAdapter);
    expect(adapter.mode).toBe('cli');
  });

  it('refuses CLI mode inside GitHub Actions runner', () => {
    const env = EnvSchema.parse({ ANTHROPIC_MODE: 'cli', GITHUB_ACTIONS: 'true' });
    expect(() => getAdapter({ provider: 'anthropic', model: 'claude-sonnet-4-6' }, env)).toThrow(/local-dev only/);
  });

  it('refuses OpenAI CLI mode (no local CLI)', () => {
    const env = EnvSchema.parse({ OPENAI_MODE: 'cli', OPENAI_API_KEY: 'x' });
    expect(() => getAdapter({ provider: 'openai', model: 'gpt-5' }, env)).toThrow(/no local CLI/);
  });

  it('errors when API key missing and mode=api', () => {
    const env = EnvSchema.parse({});
    expect(() => getAdapter({ provider: 'openai', model: 'gpt-5' }, env)).toThrow(/OPENAI_API_KEY/);
  });
});
