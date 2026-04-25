import { describe, it, expect } from 'vitest';
import { generateConfig, generateEnv, type InitAnswers } from '../src/commands/init.js';

const all: InitAnswers = {
  useAnthropic: true, useOpenAI: true, useGoogle: true,
  enableSast: true, writeKeys: false,
  useLlmProxy: false,
};

describe('init generators', () => {
  it('generates config with all 3 reviewers', () => {
    const yml = generateConfig(all);
    expect(yml).toContain('writer:');
    expect(yml).toContain('anthropic-haiku');
    expect(yml).toContain('openai-mini');
    expect(yml).toContain('gemini-flash');
    expect(yml).toContain('sast:\n  enabled: true');
    expect(yml).toContain('block_on_new_critical: true');
  });

  it('omits unselected reviewers', () => {
    const yml = generateConfig({ ...all, useGoogle: false, useOpenAI: false });
    expect(yml).toContain('anthropic-haiku');
    expect(yml).not.toContain('openai-mini');
    expect(yml).not.toContain('gemini-flash');
  });

  it('picks writer fallback when openai disabled', () => {
    const yml = generateConfig({ ...all, useOpenAI: false });
    expect(yml).toMatch(/writer:\n  provider: anthropic/);
  });

  it('SAST disabled when enableSast=false', () => {
    const yml = generateConfig({ ...all, enableSast: false });
    expect(yml).toContain('sast:\n  enabled: false');
  });

  it('env contains placeholders when no keys provided', () => {
    const env = generateEnv(all);
    expect(env).toContain('ANTHROPIC_API_KEY=sk-ant-...');
    expect(env).toContain('OPENAI_API_KEY=sk-...');
    expect(env).toContain('GOOGLE_API_KEY=AIza...');
  });

  it('env writes real keys when provided', () => {
    const env = generateEnv({ ...all, writeKeys: true,
      anthropicKey: 'sk-ant-real', openaiKey: 'sk-real', googleKey: 'AIzaReal' });
    expect(env).toContain('ANTHROPIC_API_KEY=sk-ant-real');
    expect(env).toContain('OPENAI_API_KEY=sk-real');
    expect(env).toContain('GOOGLE_API_KEY=AIzaReal');
  });
});
