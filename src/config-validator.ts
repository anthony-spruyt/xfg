import { isAbsolute } from "node:path";
import type { RawConfig } from "./config.js";

/**
 * Validates raw config structure before normalization.
 * @throws Error if validation fails
 */
export function validateRawConfig(config: RawConfig): void {
  if (!config.fileName) {
    throw new Error("Config missing required field: fileName");
  }

  // Validate fileName doesn't allow path traversal
  if (config.fileName.includes("..") || isAbsolute(config.fileName)) {
    throw new Error(
      `Invalid fileName: must be a relative path without '..' components`,
    );
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
