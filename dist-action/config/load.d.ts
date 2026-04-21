import { type SecureReviewConfig, type Env } from './schema.js';
export interface LoadedConfig {
    config: SecureReviewConfig;
    configPath: string;
    configDir: string;
}
export declare function loadConfig(configPath: string): Promise<LoadedConfig>;
export declare function loadEnv(source?: NodeJS.ProcessEnv): Env;
/** Resolve a skill path relative to the config dir if not absolute. */
export declare function resolveSkillPath(skill: string, configDir: string): string;
export declare function loadSkill(skillPath: string): Promise<string>;
//# sourceMappingURL=load.d.ts.map