import { readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, extname, relative } from "node:path";
import { parse } from "yaml";
import { validateRawConfig } from "./validator.js";
import { normalizeConfig as normalizeConfigInternal } from "./normalizer.js";
import { resolveFileReferencesInConfig } from "./file-reference-resolver.js";
import type { RawConfig, Config } from "./types.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { ValidationError } from "../shared/errors.js";
import { mergeConfigFragments, type ConfigFragment } from "./config-merger.js";

export { normalizeConfigInternal as normalizeConfig };

/**
 * Load and validate raw config without normalization.
 * Use this when you need to perform command-specific validation before normalizing.
 */
export function loadRawConfig(configPath: string): RawConfig {
  let stat;
  try {
    stat = statSync(configPath);
  } catch (error) {
    throw new ValidationError(
      `Failed to read config at ${configPath}: ${toErrorMessage(error)}`,
      { cause: error }
    );
  }

  if (stat.isDirectory()) {
    return loadRawConfigFromDirectory(configPath);
  }

  return loadRawConfigFromFile(configPath);
}

export function loadConfig(
  configPath: string,
  env: Record<string, string | undefined>
): Config {
  const rawConfig = loadRawConfig(configPath);
  return normalizeConfigInternal(rawConfig, env);
}

function loadRawConfigFromFile(filePath: string): RawConfig {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new ValidationError(
      `Failed to read config file ${filePath}: ${toErrorMessage(error)}`,
      { cause: error }
    );
  }
  const configDir = dirname(filePath);

  let rawConfig: RawConfig;
  try {
    rawConfig = parse(content) as RawConfig;
  } catch (error) {
    const message = toErrorMessage(error);
    throw new ValidationError(
      `Failed to parse YAML config at ${filePath}: ${message}`,
      { cause: error }
    );
  }

  // Resolve file references before validation so content type checking works
  rawConfig = resolveFileReferencesInConfig(rawConfig, { configDir });

  validateRawConfig(rawConfig);

  return rawConfig;
}

const MAX_CONFIG_DEPTH = 10;

function collectYamlFiles(
  rootDir: string,
  currentDir: string,
  depth: number
): Array<{ relativePath: string; absolutePath: string }> {
  if (depth > MAX_CONFIG_DEPTH) {
    /* c8 ignore next -- rootDir === currentDir impossible at depth > MAX_CONFIG_DEPTH */
    const rel = relative(rootDir, currentDir) || ".";
    throw new ValidationError(
      `Config directory nesting exceeds maximum depth of ${MAX_CONFIG_DEPTH} at ${rel}`
    );
  }

  let entries;
  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch (error) {
    const displayPath = relative(rootDir, currentDir) || currentDir;
    throw new ValidationError(
      `Failed to read config directory ${displayPath}: ${toErrorMessage(error)}`,
      { cause: error }
    );
  }

  const files: Array<{ relativePath: string; absolutePath: string }> = [];
  const subdirs: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const ext = extname(entry.name).toLowerCase();
    const isYaml = ext === ".yaml" || ext === ".yml";

    if ((entry.isFile() || entry.isSymbolicLink()) && isYaml) {
      files.push({
        relativePath: relative(rootDir, join(currentDir, entry.name)),
        absolutePath: join(currentDir, entry.name),
      });
    } else if (entry.isDirectory()) {
      subdirs.push(entry.name);
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  subdirs.sort((a, b) => a.localeCompare(b));

  const result = [...files];
  for (const subdir of subdirs) {
    result.push(
      ...collectYamlFiles(rootDir, join(currentDir, subdir), depth + 1)
    );
  }

  return result;
}

function loadRawConfigFromDirectory(dirPath: string): RawConfig {
  const yamlFiles = collectYamlFiles(dirPath, dirPath, 0);

  if (yamlFiles.length === 0) {
    throw new ValidationError(
      `No .yaml or .yml files found in directory: ${dirPath}`
    );
  }

  const fragments: ConfigFragment[] = yamlFiles.map(
    ({ relativePath, absolutePath }) => {
      let content: string;
      try {
        content = readFileSync(absolutePath, "utf-8");
      } catch (error) {
        throw new ValidationError(
          `Failed to read config file ${relativePath}: ${toErrorMessage(error)}`,
          { cause: error }
        );
      }
      const configDir = dirname(absolutePath);

      let config: Partial<RawConfig>;
      try {
        config = parse(content) as Partial<RawConfig>;
      } catch (error) {
        const message = toErrorMessage(error);
        throw new ValidationError(
          `Failed to parse YAML config at ${relativePath}: ${message}`,
          { cause: error }
        );
      }

      if (!config || typeof config !== "object") {
        throw new ValidationError(
          `Config file ${relativePath} is empty or invalid — expected a YAML mapping`
        );
      }

      // Safe cast: resolveFileReferencesInConfig only accesses optional fields
      // (files, groups, etc.), so fragments missing id/repos work correctly.
      config = resolveFileReferencesInConfig(config as RawConfig, {
        configDir,
      });

      return { fileName: relativePath, config };
    }
  );

  const merged = mergeConfigFragments(fragments);

  validateRawConfig(merged);

  return merged;
}
