import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import * as YAML from 'js-yaml';
import { SecureReviewConfigSchema, type SecureReviewConfig, EnvSchema, type Env } from './schema.js';

export interface LoadedConfig {
  config: SecureReviewConfig;
  configPath: string;
  configDir: string;
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const abs = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  let raw: string;
  try {
    raw = await readFile(abs, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config at ${abs}: ${message}`);
  }
  const parsed = YAML.load(raw);
  const result = SecureReviewConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid config ${abs}:\n${issues}`);
  }
  return { config: result.data, configPath: abs, configDir: dirname(abs) };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return result.data;
}

/** Resolve a skill path relative to the config dir if not absolute. */
export function resolveSkillPath(skill: string, configDir: string): string {
  return isAbsolute(skill) ? skill : resolve(configDir, skill);
}

export async function loadSkill(skillPath: string): Promise<string> {
  try {
    return await readFile(skillPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read skill at ${skillPath}: ${message}`);
  }
}
