import type { Env, Provider, ProviderMode } from '../config/schema.js';
import { AnthropicAPIAdapter } from './anthropic-api.js';
import { AnthropicCLIAdapter } from './anthropic-cli.js';
import { GoogleAPIAdapter } from './google-api.js';
import { GoogleCLIAdapter } from './google-cli.js';
import { OpenAIAPIAdapter } from './openai-api.js';
import type { ModelAdapter } from './types.js';

export interface AdapterSpec {
  provider: Provider;
  model: string;
}

export function getAdapter(spec: AdapterSpec, env: Env): ModelAdapter {
  const inRunner = env.GITHUB_ACTIONS === 'true';
  const mode = pickMode(spec.provider, env);

  if (mode === 'cli' && inRunner) {
    throw new Error(
      `${spec.provider.toUpperCase()}_MODE=cli is local-dev only. ` +
        `GitHub Actions runners cannot invoke the Claude/Gemini CLI binaries. ` +
        `Set ${spec.provider.toUpperCase()}_MODE=api for CI.`,
    );
  }

  switch (spec.provider) {
    case 'anthropic': {
      if (mode === 'cli') return new AnthropicCLIAdapter(spec.model, env.CLAUDE_CLI_BIN);
      const key = env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
      return new AnthropicAPIAdapter(spec.model, key);
    }
    case 'openai': {
      if (mode === 'cli') {
        throw new Error('OpenAI has no local CLI adapter. Set OPENAI_MODE=api.');
      }
      const key = env.OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY is not set');
      return new OpenAIAPIAdapter(spec.model, key);
    }
    case 'google': {
      if (mode === 'cli') return new GoogleCLIAdapter(spec.model, env.GEMINI_CLI_BIN);
      const key = env.GOOGLE_API_KEY;
      if (!key) throw new Error('GOOGLE_API_KEY is not set');
      return new GoogleAPIAdapter(spec.model, key);
    }
    default: {
      const _exhaustive: never = spec.provider;
      throw new Error(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
}

function pickMode(provider: Provider, env: Env): ProviderMode {
  switch (provider) {
    case 'anthropic':
      return env.ANTHROPIC_MODE;
    case 'openai':
      return env.OPENAI_MODE;
    case 'google':
      return env.GOOGLE_MODE;
  }
}
