import { describe, it, expect } from 'vitest';
import { generateConfig, generateEnv, generateWorkflow, WRITER_MODEL_DEFAULTS, type InitAnswers } from '../src/commands/init.js';

const all: InitAnswers = {
  useAnthropic: true, useOpenAI: true, useGoogle: true,
  writerProvider: 'anthropic', writerModel: WRITER_MODEL_DEFAULTS.anthropic,
  maxIterations: 3,
  enableSast: true, writeKeys: false,
  githubAction: 'example',
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
    expect(yml).toContain('dynamic:\n  attacker:');
    expect(yml).toContain('skill: node_modules/secure-review/skills/authorized-attack-simulator.md');
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

  it('clamps max_iterations below the schema minimum', () => {
    const yml = generateConfig({ ...all, maxIterations: 0 });
    expect(yml).toContain('max_iterations: 1');
    expect(yml).not.toContain('Set to 0');
  });

  it('generates GitHub Actions workflow with all enabled providers + npm ci', () => {
    const wf = generateWorkflow(all);
    expect(wf).toContain('name: Secure Review');
    expect(wf).toContain('uses: fonCki/secure-review@v1');
    expect(wf).toContain('npm ci');
    expect(wf).toContain('ANTHROPIC_API_KEY');
    expect(wf).toContain('OPENAI_API_KEY');
    expect(wf).toContain('GOOGLE_API_KEY');
    expect(wf).toContain('GITHUB_TOKEN');
    expect(wf).toContain('on: pull_request');
  });

  it('omits unused-provider env vars from the workflow', () => {
    const wf = generateWorkflow({ ...all, useAnthropic: false, useGoogle: false });
    expect(wf).not.toContain('ANTHROPIC_API_KEY');
    expect(wf).not.toContain('GOOGLE_API_KEY');
    expect(wf).toContain('OPENAI_API_KEY');
    expect(wf).toContain('GITHUB_TOKEN');
  });

  it('workflow always grants the right minimum permissions', () => {
    const wf = generateWorkflow(all);
    expect(wf).toContain('contents: read');
    expect(wf).toContain('pull-requests: write');
    expect(wf).toContain('checks: write');
  });
});
