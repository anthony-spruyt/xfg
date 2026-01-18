import { isAbsolute } from "node:path";
import type { RawConfig } from "./config.js";

const VALID_STRATEGIES = ["replace", "append", "prepend"];

/**
 * Validates raw config structure before normalization.
 * @throws Error if validation fails
 */
export function validateRawConfig(config: RawConfig): void {
  if (!config.files || typeof config.files !== "object") {
    throw new Error("Config missing required field: files (must be an object)");
  }

  const fileNames = Object.keys(config.files);
  if (fileNames.length === 0) {
    throw new Error("Config files object cannot be empty");
  }

  // Validate each file definition
  for (const fileName of fileNames) {
    validateFileName(fileName);

    const fileConfig = config.files[fileName];
    if (!fileConfig || typeof fileConfig !== "object") {
      throw new Error(`File '${fileName}' must have a configuration object`);
    }

    if (
      fileConfig.content !== undefined &&
      (typeof fileConfig.content !== "object" ||
        fileConfig.content === null ||
        Array.isArray(fileConfig.content))
    ) {
      throw new Error(`File '${fileName}' content must be an object`);
    }

    if (
      fileConfig.mergeStrategy !== undefined &&
      !VALID_STRATEGIES.includes(fileConfig.mergeStrategy)
    ) {
      throw new Error(
        `File '${fileName}' has invalid mergeStrategy: ${fileConfig.mergeStrategy}. Must be one of: ${VALID_STRATEGIES.join(", ")}`,
      );
    }

    if (
      fileConfig.createOnly !== undefined &&
      typeof fileConfig.createOnly !== "boolean"
    ) {
      throw new Error(`File '${fileName}' createOnly must be a boolean`);
    }

    if (fileConfig.header !== undefined) {
      if (
        typeof fileConfig.header !== "string" &&
        (!Array.isArray(fileConfig.header) ||
          !fileConfig.header.every((h) => typeof h === "string"))
      ) {
        throw new Error(
          `File '${fileName}' header must be a string or array of strings`,
        );
      }
    }

    if (
      fileConfig.schemaUrl !== undefined &&
      typeof fileConfig.schemaUrl !== "string"
    ) {
      throw new Error(`File '${fileName}' schemaUrl must be a string`);
    }
  }

  if (!config.repos || !Array.isArray(config.repos)) {
    throw new Error("Config missing required field: repos (must be an array)");
  }

  // Validate each repo
  for (let i = 0; i < config.repos.length; i++) {
    const repo = config.repos[i];
    if (!repo.git) {
      throw new Error(`Repo at index ${i} missing required field: git`);
    }
    if (Array.isArray(repo.git) && repo.git.length === 0) {
      throw new Error(`Repo at index ${i} has empty git array`);
    }

    // Validate per-repo file overrides
    if (repo.files) {
      if (typeof repo.files !== "object" || Array.isArray(repo.files)) {
        throw new Error(`Repo at index ${i}: files must be an object`);
      }

      for (const fileName of Object.keys(repo.files)) {
        // Ensure the file is defined at root level
        if (!config.files[fileName]) {
          throw new Error(
            `Repo at index ${i} references undefined file '${fileName}'. File must be defined in root 'files' object.`,
          );
        }

        const fileOverride = repo.files[fileName];

        // false means exclude this file for this repo - no further validation needed
        if (fileOverride === false) {
          continue;
        }

        if (fileOverride.override && !fileOverride.content) {
          throw new Error(
            `Repo ${getGitDisplayName(repo.git)} has override: true for file '${fileName}' but no content defined`,
          );
        }

        if (
          fileOverride.content !== undefined &&
          (typeof fileOverride.content !== "object" ||
            fileOverride.content === null ||
            Array.isArray(fileOverride.content))
        ) {
          throw new Error(
            `Repo at index ${i}: file '${fileName}' content must be an object`,
          );
        }

        if (
          fileOverride.createOnly !== undefined &&
          typeof fileOverride.createOnly !== "boolean"
        ) {
          throw new Error(
            `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' createOnly must be a boolean`,
          );
        }

        if (fileOverride.header !== undefined) {
          if (
            typeof fileOverride.header !== "string" &&
            (!Array.isArray(fileOverride.header) ||
              !fileOverride.header.every((h) => typeof h === "string"))
          ) {
            throw new Error(
              `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' header must be a string or array of strings`,
            );
          }
        }

        if (
          fileOverride.schemaUrl !== undefined &&
          typeof fileOverride.schemaUrl !== "string"
        ) {
          throw new Error(
            `Repo ${getGitDisplayName(repo.git)}: file '${fileName}' schemaUrl must be a string`,
          );
        }
      }
    }
  }
}

/**
 * Validates a file name for security issues
 */
function validateFileName(fileName: string): void {
  if (!fileName || typeof fileName !== "string") {
    throw new Error("File name must be a non-empty string");
  }

  // Validate fileName doesn't allow path traversal
  if (fileName.includes("..") || isAbsolute(fileName)) {
    throw new Error(
      `Invalid fileName '${fileName}': must be a relative path without '..' components`,
    );
  }

  // Validate fileName doesn't contain control characters that could bypass shell escaping
  if (/[\n\r\0]/.test(fileName)) {
    throw new Error(
      `Invalid fileName '${fileName}': cannot contain newlines or null bytes`,
    );
  }
}

function getGitDisplayName(git: string | string[]): string {
  if (Array.isArray(git)) {
    return git[0] || "unknown";
  }
  return git;
}
