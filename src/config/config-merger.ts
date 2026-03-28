import type { RawConfig } from "./types.js";
import { ValidationError } from "../shared/errors.js";

export interface ConfigFragment {
  fileName: string;
  config: Partial<RawConfig>;
}

/** Keys that can only appear in one file across a config directory. */
const SINGLE_FILE_KEYS: ReadonlyArray<keyof RawConfig> = [
  "id",
  "files",
  "prOptions",
  "prTemplate",
  "settings",
  "githubHosts",
  "deleteOrphaned",
];

export function mergeConfigFragments(fragments: ConfigFragment[]): RawConfig {
  if (fragments.length === 0) {
    throw new ValidationError("No config fragments to merge");
  }

  const merged: Record<string, unknown> = {};
  const singleKeySource: Partial<Record<keyof RawConfig, string>> = {};
  const allRepos: RawConfig["repos"][number][] = [];
  const allGroups: Record<string, unknown> = {};
  const groupSource: Record<string, string> = {};
  const allConditionalGroups: RawConfig["conditionalGroups"] = [];

  for (const { fileName, config } of fragments) {
    // Enforce single-file keys
    for (const key of SINGLE_FILE_KEYS) {
      if (config[key] !== undefined) {
        if (singleKeySource[key] !== undefined) {
          throw new ValidationError(
            `'${key}' is defined in both ${singleKeySource[key]} and ${fileName} — this key can only appear in one file`
          );
        }
        singleKeySource[key] = fileName;
        merged[key] = config[key];
      }
    }

    // Concatenate repos
    if (config.repos) {
      allRepos.push(...config.repos);
    }

    // Merge groups (unique names only)
    if (config.groups) {
      for (const [groupName, groupConfig] of Object.entries(config.groups)) {
        if (groupName in allGroups) {
          throw new ValidationError(
            `group '${groupName}' is defined in both ${groupSource[groupName]} and ${fileName} — group names must be unique across files`
          );
        }
        allGroups[groupName] = groupConfig;
        groupSource[groupName] = fileName;
      }
    }

    // Concatenate conditional groups
    if (config.conditionalGroups) {
      allConditionalGroups.push(...config.conditionalGroups);
    }
  }

  if (!merged.id) {
    throw new ValidationError(
      "No 'id' found in any config file — exactly one file must define 'id'"
    );
  }

  if (allRepos.length === 0) {
    throw new ValidationError(
      "No 'repos' found in any config file — at least one file must define 'repos'"
    );
  }

  return {
    ...merged,
    repos: allRepos,
    ...(Object.keys(allGroups).length > 0 ? { groups: allGroups } : {}),
    ...(allConditionalGroups.length > 0
      ? { conditionalGroups: allConditionalGroups }
      : {}),
  } as RawConfig;
}
