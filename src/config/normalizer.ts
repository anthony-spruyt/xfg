import {
  deepMerge,
  stripMergeDirectives,
  createMergeContext,
  isTextContent,
  mergeTextContent,
} from "./merge.js";
import { interpolateContent } from "../shared/env.js";
import type {
  RawConfig,
  RawGroupConfig,
  RawFileConfig,
  Config,
  RepoConfig,
  FileContent,
  ContentValue,
  PRMergeOptions,
  RepoSettings,
  RawRootSettings,
  RawRepoSettings,
  RawRepoFileOverride,
  Ruleset,
  Label,
  GitHubRepoSettings,
} from "./types.js";

/**
 * Normalizes header to array format.
 */
function normalizeHeader(
  header: string | string[] | undefined
): string[] | undefined {
  if (header === undefined) return undefined;
  if (typeof header === "string") return [header];
  return header;
}

/**
 * Merges PR options: per-repo overrides global defaults.
 * Returns undefined if no options are set.
 */
function mergePROptions(
  global: PRMergeOptions | undefined,
  perRepo: PRMergeOptions | undefined
): PRMergeOptions | undefined {
  if (!global && !perRepo) return undefined;
  if (!global) return perRepo;
  if (!perRepo) return global;

  const result: PRMergeOptions = {};
  const merge = perRepo.merge ?? global.merge;
  const mergeStrategy = perRepo.mergeStrategy ?? global.mergeStrategy;
  const deleteBranch = perRepo.deleteBranch ?? global.deleteBranch;
  const bypassReason = perRepo.bypassReason ?? global.bypassReason;
  const labels = perRepo.labels ?? global.labels;

  if (merge !== undefined) result.merge = merge;
  if (mergeStrategy !== undefined) result.mergeStrategy = mergeStrategy;
  if (deleteBranch !== undefined) result.deleteBranch = deleteBranch;
  if (bypassReason !== undefined) result.bypassReason = bypassReason;
  if (labels !== undefined) result.labels = labels;

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Deep merges two rulesets: per-repo values override root values.
 */
function mergeRuleset(
  root: Ruleset | undefined,
  perRepo: Ruleset | undefined
): Ruleset {
  if (!root) return structuredClone(perRepo ?? {});
  if (!perRepo) return structuredClone(root);

  // Deep merge using the existing merge utility with replace strategy
  const ctx = createMergeContext("replace");
  const merged = deepMerge(
    structuredClone(root) as Record<string, unknown>,
    perRepo as Record<string, unknown>,
    ctx
  );
  return merged as unknown as Ruleset;
}

/**
 * Merges settings: per-repo settings deep merge with root settings.
 * Returns undefined if no settings are defined.
 */
/**
 * Merges root and per-repo label configs.
 * Per-repo labels override root labels by name.
 * inherit: false skips all root labels.
 * label: false opts out of a specific root label.
 */
function mergeLabels(
  rootLabels: Record<string, unknown> | undefined,
  repoLabels: Record<string, unknown> | undefined
): Record<string, Label> | undefined {
  if (!rootLabels && !repoLabels) return undefined;

  const root = rootLabels ?? {};
  const repo = repoLabels ?? {};
  const inheritLabels = (repo as Record<string, unknown>)?.inherit !== false;

  const allLabelNames = new Set([
    ...Object.keys(root).filter((name) => name !== "inherit"),
    ...Object.keys(repo).filter((name) => name !== "inherit"),
  ]);

  if (allLabelNames.size === 0) return undefined;

  const result: Record<string, Label> = {};
  for (const name of allLabelNames) {
    const rootLabel = root[name];
    const repoLabel = repo[name];

    if (repoLabel === false) continue;
    if (!inheritLabels && !repoLabel && rootLabel) continue;

    const merged: Label = {
      ...((rootLabel && rootLabel !== false ? rootLabel : {}) as Label),
      ...((repoLabel && repoLabel !== false ? repoLabel : {}) as Label),
    };
    // Strip # from color and lowercase
    merged.color = merged.color.replace(/^#/, "").toLowerCase();
    result[name] = merged;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function mergeSettings(
  root: RawRootSettings | undefined,
  perRepo: RawRepoSettings | undefined
): RepoSettings | undefined {
  if (!root && !perRepo) return undefined;

  const result: RepoSettings = {};

  // Merge rulesets by name - each ruleset is deep merged
  const rootRulesets = root?.rulesets ?? {};
  const repoRulesets = perRepo?.rulesets ?? {};

  // Check if repo opts out of all inherited rulesets
  const inheritRulesets =
    (repoRulesets as Record<string, unknown>)?.inherit !== false;

  const allRulesetNames = new Set([
    ...Object.keys(rootRulesets).filter((name) => name !== "inherit"),
    ...Object.keys(repoRulesets).filter((name) => name !== "inherit"),
  ]);

  if (allRulesetNames.size > 0) {
    result.rulesets = {};
    for (const name of allRulesetNames) {
      const rootRuleset = rootRulesets[name];
      const repoRuleset = repoRulesets[name];

      // Skip if repo explicitly opts out of this ruleset
      if (repoRuleset === false) {
        continue;
      }

      // Skip root rulesets if inherit: false (unless repo has override)
      if (!inheritRulesets && !repoRuleset && rootRuleset) {
        continue;
      }

      result.rulesets[name] = mergeRuleset(
        rootRuleset as Ruleset | undefined,
        repoRuleset as Ruleset | undefined
      );
    }

    // Clean up empty rulesets object
    if (Object.keys(result.rulesets).length === 0) {
      delete result.rulesets;
    }
  }

  // deleteOrphaned: per-repo overrides root
  const deleteOrphaned = perRepo?.deleteOrphaned ?? root?.deleteOrphaned;
  if (deleteOrphaned !== undefined) {
    result.deleteOrphaned = deleteOrphaned;
  }

  // Merge repo settings: per-repo overrides root (shallow merge)
  // repo: false means opt out of all root repo settings
  if (perRepo?.repo === false) {
    // Opt-out: don't include any repo settings
  } else {
    const rootRepo = root?.repo;
    const perRepoRepo = perRepo?.repo;
    if (rootRepo || perRepoRepo) {
      result.repo = {
        ...(rootRepo === false ? {} : rootRepo),
        ...perRepoRepo,
      } as GitHubRepoSettings;
    }
  }

  // Merge labels by name
  const mergedLabels = mergeLabels(
    root?.labels as Record<string, unknown> | undefined,
    perRepo?.labels as Record<string, unknown> | undefined
  );
  if (mergedLabels) {
    result.labels = mergedLabels;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Merges group file layers onto root files, producing an effective root file map.
 * Each group layer is processed in order: inherit:false clears accumulated,
 * file:false removes a file, otherwise deep-merge content.
 */
function mergeGroupFiles(
  rootFiles: Record<string, RawFileConfig>,
  groupNames: string[],
  groupDefs: Record<string, RawGroupConfig>
): Record<string, RawFileConfig> {
  let accumulated: Record<string, RawFileConfig> = { ...rootFiles };

  for (const groupName of groupNames) {
    const group = groupDefs[groupName];
    if (!group?.files) continue;

    const inheritFiles =
      (group.files as Record<string, unknown>)?.inherit !== false;

    if (!inheritFiles) {
      // Intentionally clear: "discard everything above me"
      accumulated = {};
    }

    for (const [fileName, fileConfig] of Object.entries(group.files)) {
      if (fileName === "inherit") continue;

      // file: false removes from accumulated set
      if (fileConfig === false) {
        delete accumulated[fileName];
        continue;
      }

      if (fileConfig === undefined) continue;

      const existing = accumulated[fileName];
      if (existing) {
        // Deep-merge content if both sides have object content
        const overlay = fileConfig as RawRepoFileOverride;
        let mergedContent: ContentValue | undefined;

        if (overlay.override || !existing.content || !overlay.content) {
          // override:true or one side missing content — use overlay content
          mergedContent = overlay.content ?? existing.content;
        } else if (
          isTextContent(existing.content) &&
          isTextContent(overlay.content)
        ) {
          mergedContent = mergeTextContent(
            existing.content,
            overlay.content,
            existing.mergeStrategy ?? "replace"
          );
        } else if (
          !isTextContent(existing.content) &&
          !isTextContent(overlay.content)
        ) {
          const ctx = createMergeContext(existing.mergeStrategy ?? "replace");
          mergedContent = deepMerge(
            structuredClone(existing.content as Record<string, unknown>),
            overlay.content as Record<string, unknown>,
            ctx
          );
          mergedContent = stripMergeDirectives(mergedContent);
        } else {
          // Type mismatch — overlay wins
          mergedContent = overlay.content;
        }

        accumulated[fileName] = {
          ...existing,
          ...fileConfig,
          content: mergedContent,
        };
      } else {
        // New file introduced by group
        accumulated[fileName] = fileConfig as RawFileConfig;
      }
    }
  }

  return accumulated;
}

/**
 * Merges group PR options layers onto root PR options.
 */
function mergeGroupPROptions(
  rootPR: PRMergeOptions | undefined,
  groupNames: string[],
  groupDefs: Record<string, RawGroupConfig>
): PRMergeOptions | undefined {
  let accumulated = rootPR;
  for (const name of groupNames) {
    const group = groupDefs[name];
    if (group?.prOptions) {
      accumulated = mergePROptions(accumulated, group.prOptions);
    }
  }
  return accumulated;
}

/**
 * Merges two raw settings layers (root/group into accumulated).
 * Unlike mergeSettings(), this operates on raw types and returns raw types,
 * preserving false values and inherit keys for downstream processing.
 * The final accumulated result feeds into the existing mergeSettings(accumulated, repoSettings).
 */
function mergeRawSettings(
  base: RawRootSettings | undefined,
  overlay: RawRepoSettings | undefined
): RawRootSettings | undefined {
  if (!base && !overlay) return undefined;
  if (!base) return overlayToRoot(overlay!);
  if (!overlay) return structuredClone(base);

  const result: RawRootSettings = structuredClone(base);

  // Merge rulesets
  if (overlay.rulesets) {
    const inheritRulesets =
      (overlay.rulesets as Record<string, unknown>)?.inherit !== false;
    if (!inheritRulesets) {
      // Discard accumulated rulesets, start fresh with overlay's own
      result.rulesets = {};
    }
    if (!result.rulesets) result.rulesets = {};
    for (const [name, ruleset] of Object.entries(overlay.rulesets)) {
      if (name === "inherit") continue;
      if (ruleset === false) {
        result.rulesets[name] = false;
      } else {
        const existing = result.rulesets[name];
        result.rulesets[name] =
          existing && existing !== false
            ? (mergeRuleset(existing, ruleset) as Ruleset)
            : structuredClone(ruleset);
      }
    }
  }

  // Merge repo settings: overlay replaces base (shallow merge, same as mergeSettings)
  if (overlay.repo !== undefined) {
    if (overlay.repo === false) {
      result.repo = false;
    } else {
      result.repo = {
        ...(result.repo === false ? {} : result.repo),
        ...overlay.repo,
      } as GitHubRepoSettings;
    }
  }

  // Merge labels
  if (overlay.labels) {
    const inheritLabels =
      (overlay.labels as Record<string, unknown>)?.inherit !== false;
    if (!inheritLabels) {
      result.labels = {};
    }
    if (!result.labels) result.labels = {};
    for (const [name, label] of Object.entries(overlay.labels)) {
      if (name === "inherit") continue;
      if (label === false) {
        result.labels[name] = false;
      } else {
        const existing = result.labels[name];
        result.labels[name] = {
          ...(existing && existing !== false ? existing : {}),
          ...label,
        };
      }
    }
  }

  // deleteOrphaned: overlay wins
  if (overlay.deleteOrphaned !== undefined) {
    result.deleteOrphaned = overlay.deleteOrphaned;
  }

  return result;
}

/**
 * Converts a RawRepoSettings to RawRootSettings by stripping inherit keys.
 * Used when there's no base to merge with.
 */
function overlayToRoot(overlay: RawRepoSettings): RawRootSettings {
  const result: RawRootSettings = {};
  if (overlay.rulesets) {
    result.rulesets = {};
    for (const [name, ruleset] of Object.entries(overlay.rulesets)) {
      if (name === "inherit") continue;
      result.rulesets[name] = structuredClone(ruleset);
    }
  }
  if (overlay.repo !== undefined)
    result.repo = structuredClone(overlay.repo) as GitHubRepoSettings | false;
  if (overlay.labels) {
    result.labels = {};
    for (const [name, label] of Object.entries(overlay.labels)) {
      if (name === "inherit") continue;
      result.labels[name] = structuredClone(label);
    }
  }
  if (overlay.deleteOrphaned !== undefined)
    result.deleteOrphaned = overlay.deleteOrphaned;
  return result;
}

/**
 * Merges group settings layers onto root settings.
 */
function mergeGroupSettings(
  rootSettings: RawRootSettings | undefined,
  groupNames: string[],
  groupDefs: Record<string, RawGroupConfig>
): RawRootSettings | undefined {
  let accumulated = rootSettings;
  for (const name of groupNames) {
    const group = groupDefs[name];
    if (group?.settings) {
      accumulated = mergeRawSettings(accumulated, group.settings);
    }
  }
  return accumulated;
}

/**
 * Normalizes raw config into expanded, merged config.
 * Pipeline: expand git arrays -> merge content -> interpolate env vars
 */
export function normalizeConfig(raw: RawConfig): Config {
  const expandedRepos: RepoConfig[] = [];
  const fileNames = raw.files ? Object.keys(raw.files) : [];

  for (const rawRepo of raw.repos) {
    // Step 1: Expand git arrays
    const gitUrls = Array.isArray(rawRepo.git) ? rawRepo.git : [rawRepo.git];

    for (const gitUrl of gitUrls) {
      const files: FileContent[] = [];

      // Check if repo opts out of all inherited files
      const inheritFiles =
        (rawRepo.files as Record<string, unknown> | undefined)?.inherit !==
        false;

      // Step 2: Process each file definition
      for (const fileName of fileNames) {
        // Skip reserved key
        if (fileName === "inherit") continue;

        const repoOverride = rawRepo.files?.[fileName];

        // Skip excluded files (set to false)
        if (repoOverride === false) {
          continue;
        }

        // Skip if inherit: false and no repo-specific override
        if (!inheritFiles && !repoOverride) {
          continue;
        }

        const fileConfig = raw.files![fileName];
        const fileStrategy = fileConfig.mergeStrategy ?? "replace";

        // Step 3: Compute merged content for this file
        let mergedContent: ContentValue | null;

        if (repoOverride?.override) {
          // Override mode: use only repo file content (may be undefined for empty file)
          if (repoOverride.content === undefined) {
            mergedContent = null;
          } else if (isTextContent(repoOverride.content)) {
            // Text content: use as-is (no merge directives to strip)
            mergedContent = structuredClone(repoOverride.content);
          } else {
            mergedContent = stripMergeDirectives(
              structuredClone(repoOverride.content as Record<string, unknown>)
            );
          }
        } else if (fileConfig.content === undefined) {
          // Root file has no content = empty file (unless repo provides content)
          if (repoOverride?.content) {
            if (isTextContent(repoOverride.content)) {
              mergedContent = structuredClone(repoOverride.content);
            } else {
              mergedContent = stripMergeDirectives(
                structuredClone(repoOverride.content as Record<string, unknown>)
              );
            }
          } else {
            mergedContent = null;
          }
        } else if (!repoOverride?.content) {
          // No repo override: use file base content as-is
          mergedContent = structuredClone(fileConfig.content);
        } else {
          // Merge mode: handle text vs object content
          if (isTextContent(fileConfig.content)) {
            // Text content merging - validate overlay is also text
            if (!isTextContent(repoOverride.content)) {
              throw new Error(
                `Expected text content for ${fileName}, got object`
              );
            }
            mergedContent = mergeTextContent(
              fileConfig.content,
              repoOverride.content,
              fileStrategy
            );
          } else {
            // Object content: deep merge file base + repo overlay
            const ctx = createMergeContext(fileStrategy);
            mergedContent = deepMerge(
              structuredClone(fileConfig.content as Record<string, unknown>),
              repoOverride.content as Record<string, unknown>,
              ctx
            );
            mergedContent = stripMergeDirectives(mergedContent);
          }
        }

        // Step 4: Interpolate env vars (only if content exists)
        if (mergedContent !== null) {
          mergedContent = interpolateContent(mergedContent, { strict: true });
        }

        // Resolve fields: per-repo overrides root level
        const createOnly = repoOverride?.createOnly ?? fileConfig.createOnly;
        const executable = repoOverride?.executable ?? fileConfig.executable;
        const header = normalizeHeader(
          repoOverride?.header ?? fileConfig.header
        );
        const schemaUrl = repoOverride?.schemaUrl ?? fileConfig.schemaUrl;

        // Template: per-repo overrides root level
        const template = repoOverride?.template ?? fileConfig.template;

        // Vars: merge root + per-repo (per-repo takes precedence)
        const vars =
          fileConfig.vars || repoOverride?.vars
            ? { ...fileConfig.vars, ...repoOverride?.vars }
            : undefined;

        // deleteOrphaned: per-repo overrides per-file overrides global
        const deleteOrphaned =
          repoOverride?.deleteOrphaned ??
          fileConfig.deleteOrphaned ??
          raw.deleteOrphaned;

        files.push({
          fileName,
          content: mergedContent,
          createOnly,
          executable,
          header,
          schemaUrl,
          template,
          vars,
          deleteOrphaned,
        });
      }

      // Merge PR options: per-repo overrides global
      const prOptions = mergePROptions(raw.prOptions, rawRepo.prOptions);

      // Merge settings: per-repo deep merges with root settings
      const settings = mergeSettings(raw.settings, rawRepo.settings);

      expandedRepos.push({
        git: gitUrl,
        files,
        prOptions,
        settings,
        upstream: rawRepo.upstream,
        source: rawRepo.source,
      });
    }
  }

  // Normalize root settings (filter out inherit key if present)
  let normalizedRootSettings: RepoSettings | undefined;
  if (raw.settings) {
    normalizedRootSettings = {};
    if (raw.settings.rulesets) {
      const filteredRulesets: Record<string, Ruleset> = {};
      for (const [name, ruleset] of Object.entries(raw.settings.rulesets)) {
        if (name === "inherit" || ruleset === false) continue;
        filteredRulesets[name] = ruleset as Ruleset;
      }
      if (Object.keys(filteredRulesets).length > 0) {
        normalizedRootSettings.rulesets = filteredRulesets;
      }
    }
    if (raw.settings.repo) {
      normalizedRootSettings.repo = raw.settings.repo as GitHubRepoSettings;
    }
    if (raw.settings.labels) {
      const filteredLabels: Record<string, Label> = {};
      for (const [name, label] of Object.entries(raw.settings.labels)) {
        if (name === "inherit" || label === false) continue;
        const l = label as Label;
        filteredLabels[name] = {
          ...l,
          color: l.color.replace(/^#/, "").toLowerCase(),
        };
      }
      if (Object.keys(filteredLabels).length > 0) {
        normalizedRootSettings.labels = filteredLabels;
      }
    }
    if (raw.settings.deleteOrphaned !== undefined) {
      normalizedRootSettings.deleteOrphaned = raw.settings.deleteOrphaned;
    }
    if (Object.keys(normalizedRootSettings).length === 0) {
      normalizedRootSettings = undefined;
    }
  }

  return {
    id: raw.id,
    repos: expandedRepos,
    prTemplate: raw.prTemplate,
    githubHosts: raw.githubHosts,
    deleteOrphaned: raw.deleteOrphaned,
    settings: normalizedRootSettings,
  };
}
