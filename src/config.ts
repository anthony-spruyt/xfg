import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "yaml";
import type { ArrayMergeStrategy } from "./merge.js";
import { validateRawConfig } from "./config-validator.js";
import { normalizeConfig } from "./config-normalizer.js";
import { resolveFileReferencesInConfig } from "./file-reference-resolver.js";

// Re-export formatter functions for backwards compatibility
export { convertContentToString } from "./config-formatter.js";

// =============================================================================
// PR Merge Options Types
// =============================================================================

export type MergeMode = "manual" | "auto" | "force";
export type MergeStrategy = "merge" | "squash" | "rebase";

export interface PRMergeOptions {
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
  bypassReason?: string;
}

// =============================================================================
// Raw Config Types (as parsed from YAML)
// =============================================================================

// Content can be object (JSON/YAML), string (text), or string[] (text lines)
export type ContentValue = Record<string, unknown> | string | string[];

// Per-file configuration at root level
export interface RawFileConfig {
  content?: ContentValue;
  mergeStrategy?: ArrayMergeStrategy;
  createOnly?: boolean;
  executable?: boolean;
  header?: string | string[];
  schemaUrl?: string;
}

// Per-repo file override
export interface RawRepoFileOverride {
  content?: ContentValue;
  override?: boolean;
  createOnly?: boolean;
  executable?: boolean;
  header?: string | string[];
  schemaUrl?: string;
}

// Repo configuration
// files can map to false to exclude, or an object to override
export interface RawRepoConfig {
  git: string | string[];
  files?: Record<string, RawRepoFileOverride | false>;
  prOptions?: PRMergeOptions;
}

// Root config structure
export interface RawConfig {
  files: Record<string, RawFileConfig>;
  repos: RawRepoConfig[];
  prOptions?: PRMergeOptions;
  prTemplate?: string;
}

// =============================================================================
// Normalized Config Types (output)
// =============================================================================

// File content for a single file in a repo
export interface FileContent {
  fileName: string;
  content: ContentValue | null;
  createOnly?: boolean;
  executable?: boolean;
  header?: string[];
  schemaUrl?: string;
}

// Normalized repo config with all files to sync
export interface RepoConfig {
  git: string;
  files: FileContent[];
  prOptions?: PRMergeOptions;
}

// Normalized config
export interface Config {
  repos: RepoConfig[];
  prTemplate?: string;
}

// =============================================================================
// Public API
// =============================================================================

export function loadConfig(filePath: string): Config {
  const content = readFileSync(filePath, "utf-8");
  const configDir = dirname(filePath);

  let rawConfig: RawConfig;
  try {
    rawConfig = parse(content) as RawConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML config at ${filePath}: ${message}`);
  }

  // Resolve file references before validation so content type checking works
  rawConfig = resolveFileReferencesInConfig(rawConfig, { configDir });

  validateRawConfig(rawConfig);

  return normalizeConfig(rawConfig);
}
