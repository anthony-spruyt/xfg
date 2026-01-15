import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import {
  deepMerge,
  stripMergeDirectives,
  createMergeContext,
  type ArrayMergeStrategy,
} from "./merge.js";
import { interpolateEnvVars } from "./env.js";

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
// Validation
// =============================================================================

function validateRawConfig(config: RawConfig): void {
  if (!config.fileName) {
    throw new Error("Config missing required field: fileName");
  }

  if (!config.repos || !Array.isArray(config.repos)) {
    throw new Error("Config missing required field: repos (must be an array)");
  }

  const validStrategies = ["replace", "append", "prepend"];
  if (
    config.mergeStrategy !== undefined &&
    !validStrategies.includes(config.mergeStrategy)
  ) {
    throw new Error(
      `Invalid mergeStrategy: ${config.mergeStrategy}. Must be one of: ${validStrategies.join(", ")}`,
    );
  }

  if (
    config.content !== undefined &&
    (typeof config.content !== "object" ||
      config.content === null ||
      Array.isArray(config.content))
  ) {
    throw new Error("Root content must be an object");
  }

  const hasRootContent = config.content !== undefined;

  for (let i = 0; i < config.repos.length; i++) {
    const repo = config.repos[i];
    if (!repo.git) {
      throw new Error(`Repo at index ${i} missing required field: git`);
    }
    if (Array.isArray(repo.git) && repo.git.length === 0) {
      throw new Error(`Repo at index ${i} has empty git array`);
    }
    if (!hasRootContent && !repo.content) {
      throw new Error(
        `Repo at index ${i} missing required field: content (no root-level content defined)`,
      );
    }
    if (repo.override && !repo.content) {
      throw new Error(
        `Repo ${getGitDisplayName(repo.git)} has override: true but no content defined`,
      );
    }
  }
}

function getGitDisplayName(git: string | string[]): string {
  if (Array.isArray(git)) {
    return git[0] || "unknown";
  }
  return git;
}

// =============================================================================
// Normalization Pipeline
// =============================================================================

function normalizeConfig(raw: RawConfig): Config {
  const baseContent = raw.content ?? {};
  const defaultStrategy = raw.mergeStrategy ?? "replace";
  const expandedRepos: RepoConfig[] = [];

  for (const rawRepo of raw.repos) {
    // Step 1: Expand git arrays
    const gitUrls = Array.isArray(rawRepo.git) ? rawRepo.git : [rawRepo.git];

    for (const gitUrl of gitUrls) {
      // Step 2: Compute merged content
      let mergedContent: Record<string, unknown>;

      if (rawRepo.override) {
        // Override mode: use only repo content
        mergedContent = stripMergeDirectives(
          structuredClone(rawRepo.content as Record<string, unknown>),
        );
      } else if (!rawRepo.content) {
        // No repo content: use root content as-is
        mergedContent = structuredClone(baseContent);
      } else {
        // Merge mode: deep merge base + overlay
        const ctx = createMergeContext(defaultStrategy);
        mergedContent = deepMerge(
          structuredClone(baseContent),
          rawRepo.content,
          ctx,
        );
        mergedContent = stripMergeDirectives(mergedContent);
      }

      // Step 3: Interpolate env vars
      mergedContent = interpolateEnvVars(mergedContent, { strict: true });

      expandedRepos.push({
        git: gitUrl,
        content: mergedContent,
      });
    }
  }

  return {
    fileName: raw.fileName,
    repos: expandedRepos,
  };
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

type OutputFormat = "json" | "yaml";

function detectOutputFormat(fileName: string): OutputFormat {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "yaml" || ext === "yml") {
    return "yaml";
  }
  return "json";
}

export function convertContentToString(
  content: Record<string, unknown>,
  fileName: string,
): string {
  const format = detectOutputFormat(fileName);

  if (format === "yaml") {
    return stringify(content, { indent: 2 });
  }

  return JSON.stringify(content, null, 2);
}
