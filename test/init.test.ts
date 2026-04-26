import { describe, it, expect } from 'vitest';
import { generateConfig, generateEnv, WRITER_MODEL_DEFAULTS, type InitAnswers } from '../src/commands/init.js';

const all: InitAnswers = {
  useAnthropic: true, useOpenAI: true, useGoogle: true,
  writerProvider: 'anthropic', writerModel: WRITER_MODEL_DEFAULTS.anthropic,
  maxIterations: 3,
  enableSast: true, writeKeys: false,
};

describe('init generators', () => {
  it('generates config with all 3 reviewers and Sonnet writer by default', () => {
    const yml = generateConfig(all);
    expect(yml).toContain('writer:');
    expect(yml).toContain('provider: anthropic');
    expect(yml).toContain('model: claude-sonnet-4-6');
    expect(yml).toContain('anthropic-haiku');
    expect(yml).toContain('openai-mini');
    expect(yml).toContain('gemini-flash');
    expect(yml).toContain('sast:\n  enabled: true');
    expect(yml).toContain('block_on_new_critical: true');
  });

  it('omits unselected reviewers', () => {
    const yml = generateConfig({
      ...all, useGoogle: false, useOpenAI: false,
      // writer must point at an enabled provider
      writerProvider: 'anthropic', writerModel: WRITER_MODEL_DEFAULTS.anthropic,
    });
    expect(yml).toContain('anthropic-haiku');
    expect(yml).not.toContain('openai-mini');
    expect(yml).not.toContain('gemini-flash');
  });

  it('honours an explicitly-chosen OpenAI writer with custom model', () => {
    const yml = generateConfig({
      ...all,
      writerProvider: 'openai',
      writerModel: 'gpt-4o',
    });
    expect(yml).toMatch(/writer:\n[^]*?provider: openai\n[^]*?model: gpt-4o\n/);
  });

  it('honours a free-form custom writer model name', () => {
    const yml = generateConfig({
      ...all,
      writerProvider: 'google',
      writerModel: 'gemini-2.5-pro-experimental',
    });
    expect(yml).toContain('provider: google');
    expect(yml).toContain('model: gemini-2.5-pro-experimental');
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

  it('exposes sensible writer-model defaults per provider', () => {
    expect(WRITER_MODEL_DEFAULTS.anthropic).toBe('claude-sonnet-4-6');
    expect(WRITER_MODEL_DEFAULTS.openai).toBe('gpt-4o');
    expect(WRITER_MODEL_DEFAULTS.google).toBe('gemini-2.5-pro');
  });

  it('honours custom max_iterations and emits the comment block', () => {
    const yml = generateConfig({ ...all, maxIterations: 7 });
    expect(yml).toContain('max_iterations: 7');
    expect(yml).toContain('full-rotation-clean');
  });

  it('allows max_iterations: 0 (initial scan + final verification only)', () => {
    const yml = generateConfig({ ...all, maxIterations: 0 });
    expect(yml).toContain('max_iterations: 0');
  });
});
