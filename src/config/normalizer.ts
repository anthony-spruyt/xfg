import {
  deepMerge,
  stripMergeDirectives,
  createMergeContext,
  isTextContent,
  mergeTextContent,
} from "./merge.js";
import type { ArrayMergeStrategy } from "./merge.js";
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
 * Clone content, stripping merge directives from object content.
 * Text content is cloned as-is since it has no merge directives.
 */
function cloneContent(content: ContentValue): ContentValue {
  if (isTextContent(content)) {
    return structuredClone(content);
  }
  return stripMergeDirectives(structuredClone(content));
}

/**
 * Resolve the final content for a file by applying override/inherit/merge rules.
 *
 * Returns null when the file should be empty (e.g. override with no content,
 * or root file with no content and no repo override).
 */
function resolveFileContent(
  rootContent: ContentValue | undefined,
  repoOverride: RawRepoFileOverride | undefined,
  mergeStrategy: ArrayMergeStrategy
): ContentValue | null {
  // Override mode: use only repo content
  if (repoOverride?.override) {
    return repoOverride.content !== undefined
      ? cloneContent(repoOverride.content)
      : null;
  }

  // Root has no content — use repo content if provided, otherwise empty
  if (rootContent === undefined) {
    return repoOverride?.content ? cloneContent(repoOverride.content) : null;
  }

  // No repo override — use root content as-is
  if (!repoOverride?.content) {
    return structuredClone(rootContent);
  }

  // Both exist — merge
  return mergeContentPair(rootContent, repoOverride.content, mergeStrategy);
}

/**
 * Merge two content values using the appropriate strategy.
 * Handles text+text, object+object, and type mismatch cases.
 */
function mergeContentPair(
  base: ContentValue,
  overlay: ContentValue,
  strategy: ArrayMergeStrategy
): ContentValue {
  if (isTextContent(base) && isTextContent(overlay)) {
    return mergeTextContent(base, overlay, strategy);
  }
  if (!isTextContent(base) && !isTextContent(overlay)) {
    const ctx = createMergeContext(strategy);
    const merged = deepMerge(
      structuredClone(base),
      overlay as Record<string, unknown>,
      ctx
    );
    return stripMergeDirectives(merged);
  }
  // Type mismatch — overlay wins
  return overlay;
}

/**
 * Checks whether an object's `inherit` property is not explicitly set to false.
 * Replaces the repeated `(x )?.inherit !== false` pattern.
 */
function shouldInherit(obj: { inherit?: boolean } | undefined): boolean {
  return obj?.inherit !== false;
}

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
 * Merges root and per-repo label configs.
 * Per-repo labels override root labels by name.
 * inherit: false skips all root labels.
 * label: false opts out of a specific root label.
 */
type LabelMap = Record<string, Label | false> & { inherit?: boolean };

function mergeLabels(
  rootLabels: LabelMap | undefined,
  repoLabels: LabelMap | undefined
): Record<string, Label> | undefined {
  if (!rootLabels && !repoLabels) return undefined;

  const root = rootLabels ?? ({} as LabelMap);
  const repo = repoLabels ?? ({} as LabelMap);
  const inheritLabels = shouldInherit(repo);

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

    const base = rootLabel && typeof rootLabel === "object" ? rootLabel : {};
    const overlay = repoLabel && typeof repoLabel === "object" ? repoLabel : {};
    const merged: Label = { ...base, ...overlay } as Label;
    // Strip # from color and lowercase
    merged.color = merged.color.replace(/^#/, "").toLowerCase();
    result[name] = merged;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Merges settings: per-repo settings deep merge with root settings.
 * Returns undefined if no settings are defined.
 */
export function mergeSettings(
  root: RawRootSettings | undefined,
  perRepo: RawRepoSettings | undefined
): RepoSettings | undefined {
  if (!root && !perRepo) return undefined;

  const result: RepoSettings = {};

  // Merge rulesets by name - each ruleset is deep merged
  const rootRulesets = root?.rulesets ?? {};
  const repoRulesets = perRepo?.rulesets ?? {};

  const inheritRulesets = shouldInherit(repoRulesets);

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
  const mergedLabels = mergeLabels(root?.labels, perRepo?.labels);
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
  let accumulated: Record<string, RawFileConfig> = structuredClone(rootFiles);

  for (const groupName of groupNames) {
    const group = groupDefs[groupName];
    if (!group?.files) continue;

    const inheritFiles = shouldInherit(group.files);

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
        } else {
          mergedContent = mergeContentPair(
            existing.content,
            overlay.content,
            existing.mergeStrategy ?? "replace"
          );
        }

        const { override: _override, ...restFileConfig } = fileConfig as Record<
          string,
          unknown
        >;
        accumulated[fileName] = {
          ...existing,
          ...restFileConfig,
          content: mergedContent,
        } as RawFileConfig;
      } else {
        // New file introduced by group
        accumulated[fileName] = structuredClone(fileConfig) as RawFileConfig;
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
  if (!overlay) return structuredClone(base);

  const result: RawRootSettings = base ? structuredClone(base) : {};

  // Merge rulesets
  if (overlay.rulesets) {
    const inheritRulesets = shouldInherit(overlay.rulesets);
    if (!inheritRulesets) {
      // Discard accumulated rulesets, start fresh with overlay's own
      result.rulesets = {};
    }
    if (!result.rulesets) result.rulesets = {};
    for (const [name, ruleset] of Object.entries(overlay.rulesets)) {
      if (name === "inherit") continue;
      if (ruleset === false) {
        result.rulesets[name] = false;
      } else if (typeof ruleset === "object") {
        const existing = result.rulesets[name];
        result.rulesets[name] = existing
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
    const inheritLabels = shouldInherit(overlay.labels);
    if (!inheritLabels) {
      result.labels = {};
    }
    if (!result.labels) result.labels = {};
    for (const [name, label] of Object.entries(overlay.labels)) {
      if (name === "inherit") continue;
      if (label === false) {
        result.labels[name] = false;
      } else if (typeof label === "object") {
        const existing = result.labels[name];
        result.labels[name] = {
          ...(existing && typeof existing === "object" ? existing : {}),
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
 * Resolves a single file entry by merging root config with repo overrides.
 * Returns null if the file should be skipped.
 */
function resolveFileEntry(
  fileName: string,
  fileConfig: RawFileConfig,
  repoOverride: RawRepoFileOverride | false | undefined,
  inheritFiles: boolean,
  globalDeleteOrphaned: boolean | undefined
): FileContent | null {
  if (repoOverride === false) return null;
  if (!inheritFiles && !repoOverride) return null;

  const fileStrategy = fileConfig.mergeStrategy ?? "replace";

  let mergedContent = resolveFileContent(
    fileConfig.content,
    repoOverride,
    fileStrategy
  );

  if (mergedContent !== null) {
    mergedContent = interpolateContent(mergedContent, { strict: true });
  }

  return {
    fileName,
    content: mergedContent,
    createOnly: repoOverride?.createOnly ?? fileConfig.createOnly,
    executable: repoOverride?.executable ?? fileConfig.executable,
    header: normalizeHeader(repoOverride?.header ?? fileConfig.header),
    schemaUrl: repoOverride?.schemaUrl ?? fileConfig.schemaUrl,
    template: repoOverride?.template ?? fileConfig.template,
    vars:
      fileConfig.vars || repoOverride?.vars
        ? { ...fileConfig.vars, ...repoOverride?.vars }
        : undefined,
    deleteOrphaned:
      repoOverride?.deleteOrphaned ??
      fileConfig.deleteOrphaned ??
      globalDeleteOrphaned,
  };
}

/**
 * Normalizes raw config into expanded, merged config.
 * Pipeline: expand git arrays -> merge content -> interpolate env vars
 */
export function normalizeConfig(raw: RawConfig): Config {
  const expandedRepos: RepoConfig[] = [];

  for (const rawRepo of raw.repos) {
    const gitUrls = Array.isArray(rawRepo.git) ? rawRepo.git : [rawRepo.git];

    // Resolve groups: build effective root files/prOptions/settings by merging group layers
    const effectiveRootFiles = rawRepo.groups?.length
      ? mergeGroupFiles(raw.files ?? {}, rawRepo.groups, raw.groups ?? {})
      : (raw.files ?? {});

    const effectivePROptions = rawRepo.groups?.length
      ? mergeGroupPROptions(raw.prOptions, rawRepo.groups, raw.groups ?? {})
      : raw.prOptions;

    const effectiveSettings = rawRepo.groups?.length
      ? mergeGroupSettings(raw.settings, rawRepo.groups, raw.groups ?? {})
      : raw.settings;

    const fileNames = Object.keys(effectiveRootFiles);

    for (const gitUrl of gitUrls) {
      const files: FileContent[] = [];

      const inheritFiles = shouldInherit(rawRepo.files);

      for (const fileName of fileNames) {
        // Skip reserved key
        if (fileName === "inherit") continue;

        const entry = resolveFileEntry(
          fileName,
          effectiveRootFiles[fileName],
          rawRepo.files?.[fileName],
          inheritFiles,
          raw.deleteOrphaned
        );
        if (entry) files.push(entry);
      }

      // Merge PR options: per-repo overrides effective (root + groups)
      const prOptions = mergePROptions(effectivePROptions, rawRepo.prOptions);

      // Merge settings: per-repo deep merges with effective (root + groups)
      const settings = mergeSettings(effectiveSettings, rawRepo.settings);

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

  // Normalize root settings by reusing mergeSettings with no per-repo overlay.
  // This filters out inherit/false entries from rulesets/labels, normalizes
  // label colors, and handles deleteOrphaned — the same logic that per-repo
  // merging already applies.
  const normalizedRootSettings = mergeSettings(raw.settings, undefined);

  return {
    id: raw.id,
    repos: expandedRepos,
    prTemplate: raw.prTemplate,
    githubHosts: raw.githubHosts,
    deleteOrphaned: raw.deleteOrphaned,
    settings: normalizedRootSettings,
  };
}
