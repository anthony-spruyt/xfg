import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "yaml";
import { validateRawConfig } from "../config-validator.js";
import { normalizeConfig as normalizeConfigInternal } from "../config-normalizer.js";
import { resolveFileReferencesInConfig } from "../file-reference-resolver.js";
import type { RawConfig, Config } from "./types.js";

export { normalizeConfigInternal as normalizeConfig };

/**
 * Load and validate raw config without normalization.
 * Use this when you need to perform command-specific validation before normalizing.
 */
export function loadRawConfig(filePath: string): RawConfig {
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

  return rawConfig;
}

export function loadConfig(filePath: string): Config {
  const rawConfig = loadRawConfig(filePath);
  return normalizeConfigInternal(rawConfig);
}
