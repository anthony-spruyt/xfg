import { readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
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

function loadRawConfigFromDirectory(dirPath: string): RawConfig {
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    throw new ValidationError(
      `Failed to read config directory ${dirPath}: ${toErrorMessage(error)}`,
      { cause: error }
    );
  }
  const yamlFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        [".yaml", ".yml"].includes(extname(entry.name).toLowerCase())
    )
    .map((entry) => entry.name)
    .sort();

  if (yamlFiles.length === 0) {
    throw new ValidationError(
      `No .yaml or .yml files found in directory: ${dirPath}`
    );
  }

  const fragments: ConfigFragment[] = yamlFiles.map((fileName) => {
    const filePath = join(dirPath, fileName);
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

    let config: Partial<RawConfig>;
    try {
      config = parse(content) as Partial<RawConfig>;
    } catch (error) {
      const message = toErrorMessage(error);
      throw new ValidationError(
        `Failed to parse YAML config at ${filePath}: ${message}`,
        { cause: error }
      );
    }

    if (!config || typeof config !== "object") {
      throw new ValidationError(
        `Config file ${fileName} is empty or invalid — expected a YAML mapping`
      );
    }

    // Safe cast: resolveFileReferencesInConfig only accesses optional fields
    // (files, groups, etc.), so fragments missing id/repos work correctly.
    config = resolveFileReferencesInConfig(config as RawConfig, {
      configDir,
    });

    return { fileName, config };
  });

  const merged = mergeConfigFragments(fragments);

  validateRawConfig(merged);

  return merged;
}
