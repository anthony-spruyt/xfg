import {
  deepMerge,
  stripMergeDirectives,
  createMergeContext,
  isTextContent,
  mergeTextContent,
} from "./merge.js";
import type { ArrayMergeStrategy } from "./merge.js";
import { interpolateContent } from "./env.js";
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
  RawRepoConfig,
  RawRepoSettings,
  RawRepoFileOverride,
  RawConditionalGroupWhen,
  RawConditionalGroupConfig,
  Ruleset,
  Label,
  GitHubRepoSettings,
  VariablesConfig,
} from "./types.js";
import { expandRepoGroups } from "./extends-resolver.js";

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

  const merged = { ...global, ...perRepo };
  const result = Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined)
  ) as PRMergeOptions;

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

  // Deep merge using the existing merge utility with replace strategy.
  // deepMerge operates on Record<string, unknown> — the cast is safe because
  // merging two Ruleset-shaped objects preserves the Ruleset structure.
  const ctx = createMergeContext("replace");
  return deepMerge(
    structuredClone(root) as Record<string, unknown>,
    perRepo as Record<string, unknown>,
    ctx
  ) as Ruleset;
}

/**
 * Label map from config: each key is a label name mapped to a Label config
 * or `false` to opt out. The special `inherit` key controls whether parent
 * labels are inherited (defaults to true).
 *
 * The index signature accommodates both label entries and the boolean
 * `inherit` flag to avoid a type intersection conflict.
 */
interface LabelMap {
  inherit?: boolean;
  [key: string]: Label | false | boolean | undefined;
}

function mergeLabels(
  rootLabels: LabelMap | undefined,
  repoLabels: LabelMap | undefined
): Record<string, Label> | undefined {
  if (!rootLabels && !repoLabels) return undefined;

  const root: LabelMap = rootLabels ?? {};
  const repo: LabelMap = repoLabels ?? {};
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

    const base: Partial<Label> =
      rootLabel && typeof rootLabel === "object" ? rootLabel : {};
    const overlay: Partial<Label> =
      repoLabel && typeof repoLabel === "object" ? repoLabel : {};
    const color = (overlay.color ?? base.color ?? "")
      .replace(/^#/, "")
      .toLowerCase();
    const merged: Label = { ...base, ...overlay, color };
    result[name] = merged;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// GitHub treats variable names case-insensitively; overlay keys win over base keys with same name but different casing.
function mergeVariablesCaseInsensitive(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>
): Record<string, unknown> {
  const overlayUpper = new Map<string, string>();
  for (const key of Object.keys(overlay)) {
    overlayUpper.set(key.toUpperCase(), key);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    if (!overlayUpper.has(key.toUpperCase())) {
      result[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = value;
  }
  return result;
}

/**
 * Variable map from config: each key is a variable name mapped to a string
 * value or `false` to opt out. The special `inherit` and `deleteOrphaned`
 * keys are meta-keys controlling merge behavior.
 */
interface VariableMap {
  inherit?: boolean;
  deleteOrphaned?: boolean;
  [key: string]: string | boolean | undefined;
}

/**
 * Merges two variable maps: handles `inherit`, `deleteOrphaned` meta-keys
 * and case-insensitive variable name merging.
 *
 * Follows the same pattern as `mergeLabels`: extract meta-keys, merge data
 * entries, filter opt-outs, and re-inject meta-keys into the result.
 *
 * Returns undefined when no variable entries or meta-keys remain.
 */
function mergeVariablesWithMeta(
  rootVars: VariableMap | undefined,
  repoVars: VariableMap | undefined
): Record<string, unknown> | undefined {
  if (!rootVars && !repoVars) return undefined;

  const root: VariableMap = rootVars ?? {};
  const repo: VariableMap = repoVars ?? {};
  const inheritVars = shouldInherit(repo);

  // Resolve deleteOrphaned: repo overrides root
  const effectiveDeleteOrphaned =
    repo.deleteOrphaned !== undefined
      ? repo.deleteOrphaned
      : root.deleteOrphaned;

  // Separate data entries from meta-keys
  const stripMeta = (vars: VariableMap): Record<string, unknown> => {
    const entries: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(vars)) {
      if (key === "inherit" || key === "deleteOrphaned") continue;
      entries[key] = value;
    }
    return entries;
  };

  const rootEntries = stripMeta(root);
  const repoEntries = stripMeta(repo);

  // Merge: inherit:false uses only repo entries; otherwise case-insensitive merge
  const merged = inheritVars
    ? mergeVariablesCaseInsensitive(rootEntries, repoEntries)
    : repoEntries;

  // Filter out false opt-outs
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== false) {
      result[key] = value;
    }
  }

  // Re-inject deleteOrphaned meta-key
  if (effectiveDeleteOrphaned !== undefined) {
    result.deleteOrphaned = effectiveDeleteOrphaned;
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

      const merged = mergeRuleset(
        rootRuleset as Ruleset | undefined,
        repoRuleset as Ruleset | undefined
      );
      result.rulesets[name] = stripMergeDirectives(
        merged as Record<string, unknown>
      ) as Ruleset;
    }

    // Clean up empty rulesets object
    if (Object.keys(result.rulesets).length === 0) {
      delete result.rulesets;
    }
  }

  // deleteOrphaned: per-repo overrides root
  const deleteOrphaned =
    perRepo?.deleteOrphaned !== undefined
      ? perRepo.deleteOrphaned
      : root?.deleteOrphaned;
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

  // Merge code scanning: per-repo fully replaces root (not shallow merge).
  // Unlike `repo` settings (which shallow-merge via spread), code scanning
  // uses full replacement because its 3 fields (state, querySuite, languages)
  // are tightly coupled — partial inheritance (e.g., inheriting languages
  // from root while changing querySuite) would be confusing.
  // codeScanning: false means opt out of all root code scanning settings
  if (perRepo?.codeScanning === false) {
    // Opt-out: don't include any code scanning settings
  } else {
    const mergedCodeScanning = perRepo?.codeScanning ?? root?.codeScanning;
    if (mergedCodeScanning) {
      // At this point mergedCodeScanning is CodeScanningSettings (not false),
      // because root uses RawRootSettings where false is filtered by the
      // outer check on perRepo?.codeScanning === false
      if (typeof mergedCodeScanning === "object") {
        result.codeScanning = mergedCodeScanning;
      }
    }
  }

  // Variables merging — deleteOrphaned is a peer key (like secrets' deleteOrphaned)
  const mergedVars = mergeVariablesWithMeta(
    root?.variables,
    perRepo?.variables
  );
  if (mergedVars) {
    const { deleteOrphaned: varDeleteOrphaned, ...varEntries } = mergedVars;
    // Only include if there are actual variable entries, or deleteOrphaned is actionable
    if (Object.keys(varEntries).length > 0 || varDeleteOrphaned) {
      result.variables = varEntries as VariablesConfig;
      if (varDeleteOrphaned !== undefined) {
        result.variables.deleteOrphaned = varDeleteOrphaned as boolean;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Applies a single file-layer onto an accumulated file map: inherit:false clears,
 * file:false removes entries, otherwise deep-merges content.
 */
function applyFileLayer(
  accumulated: Record<string, RawFileConfig>,
  layerFiles: Record<
    string,
    RawFileConfig | RawRepoFileOverride | false | boolean | undefined
  >
): Record<string, RawFileConfig> {
  const inheritFiles = shouldInherit(layerFiles);

  const result: Record<string, RawFileConfig> = inheritFiles ? accumulated : {};

  for (const [fileName, fileConfig] of Object.entries(layerFiles)) {
    if (fileName === "inherit") continue;

    if (fileConfig === false) {
      delete result[fileName];
      continue;
    }

    if (fileConfig === undefined || fileConfig === true) continue;

    const existing = result[fileName];
    if (existing) {
      const overlay = fileConfig as RawRepoFileOverride;
      let mergedContent: ContentValue | undefined;

      if (overlay.override || !existing.content || !overlay.content) {
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
      result[fileName] = {
        ...existing,
        ...restFileConfig,
        content: mergedContent,
      } as RawFileConfig;
    } else {
      result[fileName] = structuredClone(fileConfig) as RawFileConfig;
    }
  }

  return result;
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

    accumulated = applyFileLayer(accumulated, group.files);
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
 * Merges a named-entry map (e.g. rulesets, labels) where overlay entries
 * extend or replace base entries. `inherit: false` in the overlay discards
 * the base; `false` values mark explicit opt-outs. The merge callback runs
 * when both base and overlay have an entry with the same name.
 */
function mergeNamedEntries<T>(
  base: Record<string, T | false> | undefined,
  overlay: Record<string, T | false | boolean | undefined>,
  merge: (existing: T | false | undefined, entry: T) => T
): Record<string, T | false> {
  const inherit = shouldInherit(overlay);
  const result: Record<string, T | false> = inherit ? { ...(base ?? {}) } : {};

  for (const [name, entry] of Object.entries(overlay)) {
    if (name === "inherit") continue;
    if (entry === false) {
      result[name] = false;
    } else if (typeof entry === "object" && entry !== null) {
      const existing = result[name];
      result[name] = merge(existing, entry as T);
    }
  }

  return result;
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
    result.rulesets = mergeNamedEntries(
      result.rulesets,
      overlay.rulesets,
      (existing, entry) =>
        existing && typeof existing === "object"
          ? mergeRuleset(existing as Ruleset, entry as Ruleset)
          : structuredClone(entry)
    );
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
    result.labels = mergeNamedEntries(
      result.labels,
      overlay.labels,
      (existing, entry) => ({
        ...(existing && typeof existing === "object" ? existing : {}),
        ...(entry as Label),
      })
    );
  }

  // Merge code scanning: overlay fully replaces base (same semantics as mergeSettings)
  if (overlay.codeScanning !== undefined) {
    if (overlay.codeScanning === false) {
      result.codeScanning = false;
    } else {
      result.codeScanning = structuredClone(overlay.codeScanning);
    }
  }

  // Variables: simple string values with false opt-outs (mergeNamedEntries won't work for strings)
  if (overlay.variables) {
    const mergedVars = mergeVariablesWithMeta(
      result.variables as VariableMap | undefined,
      overlay.variables as VariableMap | undefined
    );
    result.variables = (mergedVars ?? {}) as typeof result.variables;
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
 * Evaluates a conditional group's `when` clause against a repo's effective groups.
 * All specified operators must be satisfied: `allOf` (every listed group present),
 * `anyOf` (at least one present), and `noneOf` (none of the listed groups present).
 * Absent conditions are treated as satisfied.
 */
function evaluateWhenClause(
  when: RawConditionalGroupWhen,
  effectiveGroups: ReadonlySet<string>
): boolean {
  // Defensive: if no condition is specified, don't match
  if (!when.allOf && !when.anyOf && !when.noneOf) return false;

  const allOfSatisfied =
    !when.allOf || when.allOf.every((g) => effectiveGroups.has(g));
  const anyOfSatisfied =
    !when.anyOf || when.anyOf.some((g) => effectiveGroups.has(g));
  const noneOfSatisfied =
    !when.noneOf || when.noneOf.every((g) => !effectiveGroups.has(g));
  return allOfSatisfied && anyOfSatisfied && noneOfSatisfied;
}

/**
 * Merges matching conditional groups into the accumulated files/prOptions/settings.
 * Each matching conditional group is applied in array order, using the same
 * merge semantics as regular group layers (inherit:false, file:false, override:true).
 */
function mergeConditionalGroups(
  accumulatedFiles: Record<string, RawFileConfig>,
  accumulatedPROptions: PRMergeOptions | undefined,
  accumulatedSettings: RawRootSettings | undefined,
  effectiveGroups: ReadonlySet<string>,
  conditionalGroups: RawConditionalGroupConfig[]
): {
  files: Record<string, RawFileConfig>;
  prOptions: PRMergeOptions | undefined;
  settings: RawRootSettings | undefined;
} {
  let files = structuredClone(accumulatedFiles);
  let prOptions = accumulatedPROptions
    ? structuredClone(accumulatedPROptions)
    : undefined;
  let settings = accumulatedSettings;

  for (const cg of conditionalGroups) {
    if (!evaluateWhenClause(cg.when, effectiveGroups)) continue;

    if (cg.files) {
      files = applyFileLayer(files, cg.files);
    }

    // Merge prOptions
    if (cg.prOptions) {
      prOptions = mergePROptions(prOptions, cg.prOptions);
    }

    // Merge settings
    if (cg.settings) {
      settings = mergeRawSettings(settings, cg.settings);
    }
  }

  return { files, prOptions, settings };
}

/**
 * Resolves a single file entry by merging root config with repo overrides.
 * Returns null if the file should be skipped.
 */
function resolveFileEntry(
  fileName: string,
  fileConfig: RawFileConfig,
  repoOverride: RawRepoFileOverride | false | boolean | undefined,
  inheritFiles: boolean,
  globalDeleteOrphaned: boolean | undefined,
  env: Record<string, string | undefined>
): FileContent | null {
  if (repoOverride === false) return null;
  // true is only valid for the inherit meta-key, not for file entries
  if (repoOverride === true) return null;
  if (!inheritFiles && !repoOverride) return null;

  const fileStrategy = fileConfig.mergeStrategy ?? "replace";

  let mergedContent = resolveFileContent(
    fileConfig.content,
    repoOverride,
    fileStrategy
  );

  if (mergedContent !== null) {
    mergedContent = interpolateContent(mergedContent, { strict: true, env });
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

interface NormalizeRepoEntryContext {
  gitUrl: string;
  rawRepo: RawRepoConfig;
  effectiveRootFiles: Record<string, RawFileConfig>;
  fileNames: string[];
  repoOnlyFileNames: string[];
  effectivePROptions: PRMergeOptions | undefined;
  effectiveSettings: RawRootSettings | undefined;
  globalDeleteOrphaned: boolean | undefined;
  env: Record<string, string | undefined>;
}

function normalizeRepoEntry(ctx: NormalizeRepoEntryContext): RepoConfig {
  const files: FileContent[] = [];
  const inheritFiles = shouldInherit(ctx.rawRepo.files);

  for (const fileName of ctx.fileNames) {
    if (fileName === "inherit") continue;

    const entry = resolveFileEntry(
      fileName,
      ctx.effectiveRootFiles[fileName],
      ctx.rawRepo.files?.[fileName],
      inheritFiles,
      ctx.globalDeleteOrphaned,
      ctx.env
    );
    if (entry) files.push(entry);
  }

  for (const fileName of ctx.repoOnlyFileNames) {
    const repoOverride = ctx.rawRepo.files![fileName];
    if (repoOverride === false) continue;

    const entry = resolveFileEntry(
      fileName,
      {} as RawFileConfig,
      repoOverride,
      true,
      ctx.globalDeleteOrphaned,
      ctx.env
    );
    if (entry) files.push(entry);
  }

  const prOptions = mergePROptions(
    ctx.effectivePROptions,
    ctx.rawRepo.prOptions
  );
  const settings = mergeSettings(ctx.effectiveSettings, ctx.rawRepo.settings);

  return {
    git: ctx.gitUrl,
    files,
    prOptions,
    settings,
    upstream: ctx.rawRepo.upstream,
    source: ctx.rawRepo.source,
  };
}

/**
 * Normalizes raw config into expanded, merged config.
 * Pipeline: expand git arrays -> merge content -> interpolate env vars
 */
export function normalizeConfig(
  raw: RawConfig,
  env: Record<string, string | undefined>
): Config {
  const expandedRepos: RepoConfig[] = [];

  for (const rawRepo of raw.repos) {
    const gitUrls = Array.isArray(rawRepo.git) ? rawRepo.git : [rawRepo.git];

    // Phase 0: Expand extends chains
    const expandedGroups = rawRepo.groups?.length
      ? expandRepoGroups(rawRepo.groups, raw.groups ?? {})
      : [];

    // Phase 1: Resolve groups - build effective root files/prOptions/settings by merging group layers
    let effectiveRootFiles = expandedGroups.length
      ? mergeGroupFiles(raw.files ?? {}, expandedGroups, raw.groups ?? {})
      : (raw.files ?? {});

    let effectivePROptions = expandedGroups.length
      ? mergeGroupPROptions(raw.prOptions, expandedGroups, raw.groups ?? {})
      : raw.prOptions;

    let effectiveSettings = expandedGroups.length
      ? mergeGroupSettings(raw.settings, expandedGroups, raw.groups ?? {})
      : raw.settings;

    // Phase 2 + 3: Evaluate and merge conditional groups
    if (raw.conditionalGroups?.length) {
      const effectiveGroups = new Set(expandedGroups);
      const merged = mergeConditionalGroups(
        effectiveRootFiles,
        effectivePROptions,
        effectiveSettings,
        effectiveGroups,
        raw.conditionalGroups
      );
      effectiveRootFiles = merged.files;
      effectivePROptions = merged.prOptions;
      effectiveSettings = merged.settings;
    }

    const fileNames = Object.keys(effectiveRootFiles);

    // Collect repo-only file names (defined at repo level but not in root/groups)
    const repoOnlyFileNames: string[] = [];
    if (rawRepo.files) {
      for (const name of Object.keys(rawRepo.files)) {
        if (name === "inherit") continue;
        if (!effectiveRootFiles[name]) {
          repoOnlyFileNames.push(name);
        }
      }
    }

    for (const gitUrl of gitUrls) {
      expandedRepos.push(
        normalizeRepoEntry({
          gitUrl,
          rawRepo,
          effectiveRootFiles,
          fileNames,
          repoOnlyFileNames,
          effectivePROptions,
          effectiveSettings,
          globalDeleteOrphaned: raw.deleteOrphaned,
          env,
        })
      );
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
    secrets: raw.secrets,
  };
}
