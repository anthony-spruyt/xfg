import { readFileSync } from "node:fs";
import { resolve, isAbsolute, normalize, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ContentValue, RawConfig } from "./config.js";

export interface FileReferenceOptions {
  configDir: string;
}

/**
 * Check if a value is a file reference (string starting with @)
 */
export function isFileReference(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("@");
}

/**
 * Resolve a file reference to its content.
 * - JSON files are parsed as objects
 * - YAML files are parsed as objects
 * - Other files are returned as strings
 */
export function resolveFileReference(
  reference: string,
  configDir: string,
): ContentValue {
  const relativePath = reference.slice(1); // Remove @ prefix

  if (relativePath.length === 0) {
    throw new Error(`Invalid file reference "${reference}": path is empty`);
  }

  // Security: block absolute paths
  if (isAbsolute(relativePath)) {
    throw new Error(
      `File reference "${reference}" uses absolute path. Use relative paths only.`,
    );
  }

  const resolvedPath = resolve(configDir, relativePath);
  const normalizedResolved = normalize(resolvedPath);
  const normalizedConfigDir = normalize(configDir);

  // Security: ensure path stays within config directory tree
  // Use path separator to ensure we're checking directory boundaries
  if (
    !normalizedResolved.startsWith(normalizedConfigDir + "/") &&
    normalizedResolved !== normalizedConfigDir
  ) {
    throw new Error(
      `File reference "${reference}" escapes config directory. ` +
        `References must be within "${configDir}".`,
    );
  }

  // Load file
  let content: string;
  try {
    content = readFileSync(resolvedPath, "utf-8");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load file reference "${reference}": ${msg}`);
  }

  // Parse based on extension
  const ext = extname(relativePath).toLowerCase();
  if (ext === ".json") {
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON in "${reference}": ${msg}`);
    }
  }
  if (ext === ".yaml" || ext === ".yml") {
    try {
      return parseYaml(content) as Record<string, unknown>;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid YAML in "${reference}": ${msg}`);
    }
  }

  // Text file - return as string
  return content;
}

/**
 * Recursively resolve file references in a content value.
 * Only string values starting with @ are resolved.
 */
function resolveContentValue(
  value: ContentValue | undefined,
  configDir: string,
): ContentValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  // If it's a file reference, resolve it
  if (isFileReference(value)) {
    return resolveFileReference(value, configDir);
  }

  // Otherwise return as-is (objects, arrays, plain strings)
  return value;
}

/**
 * Resolve all file references in a raw config.
 * Walks through files at root level and per-repo level.
 */
export function resolveFileReferencesInConfig(
  raw: RawConfig,
  options: FileReferenceOptions,
): RawConfig {
  const { configDir } = options;

  // Deep clone to avoid mutating input
  const result: RawConfig = JSON.parse(JSON.stringify(raw));

  // Resolve root-level file content
  if (result.files) {
    for (const [fileName, fileConfig] of Object.entries(result.files)) {
      if (
        fileConfig &&
        typeof fileConfig === "object" &&
        "content" in fileConfig
      ) {
        const resolved = resolveContentValue(fileConfig.content, configDir);
        if (resolved !== undefined) {
          result.files[fileName] = { ...fileConfig, content: resolved };
        }
      }
    }
  }

  // Resolve per-repo file content
  if (result.repos) {
    for (const repo of result.repos) {
      if (repo.files) {
        for (const [fileName, fileOverride] of Object.entries(repo.files)) {
          // Skip false (exclusion) entries
          if (fileOverride === false) {
            continue;
          }
          if (
            fileOverride &&
            typeof fileOverride === "object" &&
            "content" in fileOverride
          ) {
            const resolved = resolveContentValue(
              fileOverride.content,
              configDir,
            );
            if (resolved !== undefined) {
              repo.files[fileName] = { ...fileOverride, content: resolved };
            }
          }
        }
      }
    }
  }

  return result;
}
