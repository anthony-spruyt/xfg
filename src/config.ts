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

// Per-file configuration at root level
export interface RawFileConfig {
  content?: Record<string, unknown>;
  mergeStrategy?: ArrayMergeStrategy;
  createOnly?: boolean;
  header?: string | string[];
  schemaUrl?: string;
}

// Per-repo file override
export interface RawRepoFileOverride {
  content?: Record<string, unknown>;
  override?: boolean;
  createOnly?: boolean;
  header?: string | string[];
  schemaUrl?: string;
}

// Repo configuration
// files can map to false to exclude, or an object to override
export interface RawRepoConfig {
  git: string | string[];
  files?: Record<string, RawRepoFileOverride | false>;
}

// Root config structure
export interface RawConfig {
  files: Record<string, RawFileConfig>;
  repos: RawRepoConfig[];
}

// =============================================================================
// Normalized Config Types (output)
// =============================================================================

// File content for a single file in a repo
export interface FileContent {
  fileName: string;
  content: Record<string, unknown> | null;
  createOnly?: boolean;
  header?: string[];
  schemaUrl?: string;
}

// Normalized repo config with all files to sync
export interface RepoConfig {
  git: string;
  files: FileContent[];
}

// Normalized config
export interface Config {
  repos: RepoConfig[];
}

// =============================================================================
// Public API
// =============================================================================

export function loadConfig(filePath: string): Config {
  const content = readFileSync(filePath, "utf-8");

  let rawConfig: RawConfig;
  try {
    rawConfig = parse(content) as RawConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML config at ${filePath}: ${message}`);
  }

  validateRawConfig(rawConfig);

  return normalizeConfig(rawConfig);
}
