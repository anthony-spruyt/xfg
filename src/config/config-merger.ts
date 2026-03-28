import type { RawConfig } from "./types.js";
import { ValidationError } from "../shared/errors.js";

export interface ConfigFragment {
  fileName: string;
  config: Partial<RawConfig>;
}

/**
 * Merge multiple config fragments into a single RawConfig.
 * Rules:
 * - groups, conditionalGroups, repos can span multiple files
 * - group names must be unique across files
 * - all other keys must appear in at most one file
 * - exactly one file must define 'id'
 */
export function mergeConfigFragments(fragments: ConfigFragment[]): RawConfig {
  if (fragments.length === 0) {
    throw new ValidationError("No config fragments to merge");
  }

  const merged: Partial<RawConfig> = {};
  const repos: RawConfig["repos"] = [];

  for (const { fileName, config } of fragments) {
    if (config.repos) {
      repos.push(...config.repos);
    }

    if (config.id !== undefined) {
      if (merged.id !== undefined) {
        throw new ValidationError(
          `'id' is defined in multiple files — this key can only appear in one file`
        );
      }
      merged.id = config.id;
    }

    if (config.files !== undefined) {
      if (merged.files !== undefined) {
        throw new ValidationError(
          `'files' is defined in multiple files — this key can only appear in one file`
        );
      }
      merged.files = config.files;
    }
  }

  if (!merged.id) {
    throw new ValidationError(
      "No 'id' found in any config file — exactly one file must define 'id'"
    );
  }

  return {
    ...merged,
    id: merged.id,
    repos,
  } as RawConfig;
}
