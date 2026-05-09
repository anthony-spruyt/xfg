import { readFileSync } from "node:fs";
import { resolve, isAbsolute, normalize, extname, relative } from "node:path";
import JSON5 from "json5";
import { parse as parseYaml } from "yaml";
import type { ContentValue, RawConfig } from "./types.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { ValidationError } from "../shared/errors.js";

interface FileReferenceOptions {
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
  configDir: string
): ContentValue {
  const relativePath = reference.slice(1); // Remove @ prefix

  if (relativePath.length === 0) {
    throw new ValidationError(
      `Invalid file reference "${reference}": path is empty`
    );
  }

  // Security: block absolute paths
  if (isAbsolute(relativePath)) {
    throw new ValidationError(
      `File reference "${reference}" uses absolute path. Use relative paths only.`
    );
  }

  const resolvedPath = resolve(configDir, relativePath);
  const normalizedResolved = normalize(resolvedPath);
  const normalizedConfigDir = normalize(configDir);

  // Security: ensure path stays within config directory tree
  // Fix for issue #89: Use path.relative() instead of hardcoded "/" separator
  // The old approach (!path.startsWith(configDir + "/")) fails on Windows
  // where normalize() returns paths with backslash separators.
  const pathFromConfig = relative(normalizedConfigDir, normalizedResolved);
  if (pathFromConfig.startsWith("..") || isAbsolute(pathFromConfig)) {
    throw new ValidationError(
      `File reference "${reference}" escapes config directory. ` +
        `References must be within "${configDir}".`
    );
  }

  // Load file
  let content: string;
  try {
    content = readFileSync(resolvedPath, "utf-8");
  } catch (error) {
    const msg = toErrorMessage(error);
    throw new ValidationError(
      `Failed to load file reference "${reference}": ${msg}`,
      { cause: error }
    );
  }

  // Parse based on extension
  const ext = extname(relativePath).toLowerCase();
  if (ext === ".json") {
    return parseWithContext(
      () => JSON.parse(content),
      `Invalid JSON in "${reference}"`
    );
  }
  if (ext === ".json5") {
    return parseWithContext(
      () => JSON5.parse(content),
      `Invalid JSON5 in "${reference}"`
    );
  }
  if (ext === ".yaml" || ext === ".yml") {
    return parseWithContext(
      () => parseYaml(content),
      `Invalid YAML in "${reference}"`
    );
  }

  // Text file - return as string
  return content;
}

function parseWithContext(
  fn: () => ContentValue,
  errorPrefix: string
): ContentValue {
  try {
    return fn();
  } catch (error) {
    throw new ValidationError(`${errorPrefix}: ${toErrorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * Recursively resolve file references in a content value.
 * Only string values starting with @ are resolved.
 */
function resolveContentValue(
  value: ContentValue | undefined,
  configDir: string
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

function resolveContentInFilesMap(
  filesMap: Record<string, unknown> | undefined,
  configDir: string
): void {
  if (!filesMap) {
    return;
  }
  for (const [fileName, fileConfig] of Object.entries(filesMap)) {
    if (fileConfig === false) {
      continue;
    }
    if (
      fileConfig &&
      typeof fileConfig === "object" &&
      "content" in fileConfig
    ) {
      const typed = fileConfig as { content?: ContentValue };
      const resolved = resolveContentValue(typed.content, configDir);
      if (resolved !== undefined) {
        filesMap[fileName] = { ...fileConfig, content: resolved };
      }
    }
  }
}

/**
 * Resolve all file references in a raw config.
 * Walks through files at root level and per-repo level.
 */
export function resolveFileReferencesInConfig(
  raw: RawConfig,
  options: FileReferenceOptions
): RawConfig {
  const { configDir } = options;

  // Deep clone to avoid mutating input
  const result: RawConfig = JSON.parse(JSON.stringify(raw));

  // Resolve prTemplate file reference
  if (result.prTemplate && isFileReference(result.prTemplate)) {
    const resolved = resolveFileReference(result.prTemplate, configDir);
    if (typeof resolved !== "string") {
      throw new ValidationError(
        `prTemplate file reference "${result.prTemplate}" must resolve to a text file, not JSON/YAML`
      );
    }
    result.prTemplate = resolved;
  }

  // Resolve root-level file content
  resolveContentInFilesMap(
    result.files as Record<string, unknown> | undefined,
    configDir
  );

  // Resolve group-level file content
  if (result.groups) {
    for (const group of Object.values(result.groups)) {
      resolveContentInFilesMap(
        group.files as Record<string, unknown> | undefined,
        configDir
      );
    }
  }

  // Resolve conditional group file content
  if (result.conditionalGroups) {
    for (const cg of result.conditionalGroups) {
      resolveContentInFilesMap(
        cg.files as Record<string, unknown> | undefined,
        configDir
      );
    }
  }

  // Resolve per-repo file content
  if (result.repos) {
    for (const repo of result.repos) {
      resolveContentInFilesMap(
        repo.files as Record<string, unknown> | undefined,
        configDir
      );
    }
  }

  return result;
}
