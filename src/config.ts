import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { ArrayMergeStrategy } from "./merge.js";
import { validateRawConfig } from "./config-validator.js";
import { normalizeConfig } from "./config-normalizer.js";

// Re-export formatter functions for backwards compatibility
export { convertContentToString } from "./config-formatter.js";

// =============================================================================
// Raw Config Types (as parsed from YAML)
// =============================================================================

export interface RawRepoConfig {
  git: string | string[];
  content?: Record<string, unknown>;
  override?: boolean;
}

export interface RawConfig {
  fileName: string;
  content?: Record<string, unknown>;
  mergeStrategy?: ArrayMergeStrategy;
  repos: RawRepoConfig[];
}

// =============================================================================
// Normalized Config Types (output)
// =============================================================================

export interface RepoConfig {
  git: string;
  content: Record<string, unknown>;
}

export interface Config {
  fileName: string;
  repos: RepoConfig[];
}

// =============================================================================
// Public API
// =============================================================================

export function loadConfig(filePath: string): Config {
  const content = readFileSync(filePath, "utf-8");
  const rawConfig = parse(content) as RawConfig;

  validateRawConfig(rawConfig);

  return normalizeConfig(rawConfig);
}
