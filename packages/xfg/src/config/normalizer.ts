import {
  applyInherit,
  deepMerge,
  stripMergeDirectives,
  createMergeContext,
  isTextContent,
  mergeTextContent,
} from "./merge.js";
import type { ArrayMergeStrategy } from "./merge.js";
import { arrayValues, isArrayMergeDirective } from "./array-directive.js";
import { dropRepeatedItems } from "./drop-repeated-items.js";
import { interpolateContent } from "./env.js";
import type {
  RawConfig,
  RawGroupConfig,
  RawFileConfig,
  Config,
  RepoConfig,
  FileContent,
  ContentValue,
  AiConfig,
  PRMergeOptions,
  RawPRMergeOptions,
  RepoPROptions,
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
  ActionsSettings,
  CollaboratorsConfig,
  RawCollaboratorsConfig,
  EnvironmentConfig,
  EnvironmentsConfig,
  RawEnvironmentConfig,
} from "./types.js";
import { expandRepoGroups } from "./extends-resolver.js";

/**
 * Clone content, stripping merge directives from object content.
 * Text content is cloned as-is since it has no merge directives.
 */
function cloneContent(content: ContentValue, fileName: string): ContentValue {
  if (isTextContent(content)) {
    return structuredClone(content);
  }
  return stripMergeDirectives(structuredClone(content), fileName);
}

/**
 * Resolve the final content for a file by applying override/inherit/merge rules.
 *
 * Returns null when the file should be empty (e.g. override with no content,
 * or root file with no content and no repo override).
 */
function resolveFileContent(
  fileName: string,
  rootContent: ContentValue | undefined,
  repoOverride: RawRepoFileOverride | undefined,
  mergeStrategy: ArrayMergeStrategy
): ContentValue | null {
  if (repoOverride?.override) {
    return repoOverride.content !== undefined
      ? cloneContent(repoOverride.content, fileName)
      : null;
  }

  if (rootContent === undefined) {
    return repoOverride?.content
      ? cloneContent(repoOverride.content, fileName)
      : null;
  }

  if (!repoOverride?.content) {
    return cloneContent(rootContent, fileName);
  }

  return mergeContentPair(
    fileName,
    rootContent,
    repoOverride.content,
    mergeStrategy
  );
}

function mergeContentPair(
  fileName: string,
  base: ContentValue,
  overlay: ContentValue,
  strategy: ArrayMergeStrategy
): ContentValue {
  if (isTextContent(base) && isTextContent(overlay)) {
    return mergeTextContent(base, overlay, strategy);
  }
  if (!isTextContent(base) && !isTextContent(overlay)) {
    const ctx = createMergeContext(strategy, fileName);
    const merged = deepMerge(
      structuredClone(base),
      overlay as Record<string, unknown>,
      ctx
    );
    return stripMergeDirectives(merged, fileName);
  }
  return cloneContent(overlay, fileName);
}

function shouldInherit(obj: { inherit?: boolean } | undefined): boolean {
  return obj?.inherit !== false;
}

function normalizeHeader(
  header: string | string[] | undefined
): string[] | undefined {
  if (header === undefined) return undefined;
  if (typeof header === "string") return [header];
  return header;
}

const PR_OPTIONS_LOCATION = "prOptions";

// lastAi remembers the ai object hidden by `ai: false` so a later `ai: true` can re-enable it.
type MergedPROptions = PRMergeOptions & { lastAi?: AiConfig };

function mergePROptions(
  global: MergedPROptions | undefined,
  perRepo: RawPRMergeOptions | undefined
): MergedPROptions | undefined {
  if (!global && !perRepo) return undefined;
  if (!perRepo) return global;

  const layer = applyInherit(
    global as Record<string, unknown> | undefined,
    perRepo as Record<string, unknown>
  );
  const base = layer.base as MergedPROptions;
  const overlay = layer.overlay as PRMergeOptions;
  const lastAi = typeof base.ai === "object" ? base.ai : base.lastAi;
  const { ai: _baseAi, lastAi: _baseLastAi, ...baseRest } = base;
  const { ai: _overlayAi, ...overlayRest } = overlay;
  const merged: MergedPROptions = {
    ...base,
    ...overlay,
    lastAi: undefined,
    ...deepMerge(
      baseRest,
      overlayRest,
      createMergeContext("replace", PR_OPTIONS_LOCATION)
    ),
  };
  if (merged.ai === true && lastAi) merged.ai = lastAi;
  if (merged.ai === false) merged.lastAi = lastAi;
  const result = Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined)
  ) as MergedPROptions;

  return Object.keys(result).length > 0 ? result : undefined;
}

function finalizePROptions(
  prOptions: MergedPROptions | undefined
): RepoPROptions | undefined {
  const normalized = normalizeAiOption(prOptions);
  if (normalized === undefined) return undefined;
  return dropRepeatedItems(
    stripMergeDirectives(
      normalized as Record<string, unknown>,
      PR_OPTIONS_LOCATION
    )
  ) as RepoPROptions;
}

function normalizeAiOption(
  prOptions: MergedPROptions | undefined
): RepoPROptions | undefined {
  if (prOptions === undefined) return undefined;
  const { ai, lastAi: _lastAi, ...rest } = prOptions;
  if (ai === true) return { ...rest, ai: { provider: "anthropic" } };
  if (ai) {
    const { fallback, ...primary } = ai;
    return {
      ...rest,
      ai: {
        ...primary,
        provider: primary.provider ?? "anthropic",
        ...(fallback
          ? {
              fallback: {
                ...fallback,
                provider: fallback.provider ?? "anthropic",
              },
            }
          : {}),
      },
    };
  }
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function rulesetLocation(name: string): string {
  return `ruleset '${name}'`;
}

function mergeRuleset(
  name: string,
  root: Ruleset | undefined,
  perRepo: Ruleset | undefined
): Ruleset {
  if (!root) return structuredClone(perRepo ?? {});
  if (!perRepo) return structuredClone(root);

  // deepMerge operates on Record<string, unknown> — the cast is safe because
  // merging two Ruleset-shaped objects preserves the Ruleset structure.
  const ctx = createMergeContext("replace", rulesetLocation(name));
  return deepMerge(
    structuredClone(root) as Record<string, unknown>,
    perRepo as Record<string, unknown>,
    ctx
  ) as Ruleset;
}

// GitHub treats variable and secret names case-insensitively; overlay keys win over base keys with same name but different casing.
function mergeCaseInsensitiveEntries(
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

const ENTRY_MAP_META_KEYS = new Set(["inherit", "deleteOrphaned"]);

function stripEntryMapMetaKeys(
  entries: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(entries)) {
    if (ENTRY_MAP_META_KEYS.has(name)) continue;
    result[name] = value;
  }
  return result;
}

/**
 * Merges one name-keyed settings entry map (variables or secrets) over another.
 * `deleteOrphaned` is a policy peer key resolved innermost-wins; `inherit: false`
 * discards inherited entries only and never clears it.
 */
function mergeEntryMapLayer(
  base: Record<string, unknown> | undefined,
  overlay: Record<string, unknown> | undefined
): Record<string, unknown> {
  const baseEntries = base ?? {};
  const overlayEntries = overlay ?? {};

  const effectiveDeleteOrphaned =
    overlayEntries.deleteOrphaned !== undefined
      ? overlayEntries.deleteOrphaned
      : baseEntries.deleteOrphaned;

  const inherited =
    overlayEntries.inherit === false ? {} : stripEntryMapMetaKeys(baseEntries);

  const merged = mergeCaseInsensitiveEntries(
    inherited,
    stripEntryMapMetaKeys(overlayEntries)
  );

  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(merged)) {
    if (value !== false) {
      result[name] = value;
    }
  }

  if (effectiveDeleteOrphaned !== undefined) {
    result.deleteOrphaned = effectiveDeleteOrphaned;
  }

  return result;
}

/** deleteOrphaned alone is not actionable, so an entry-less map collapses to undefined. */
function dropEntryMapIfEmpty(
  merged: Record<string, unknown>
): Record<string, unknown> | undefined {
  const { deleteOrphaned, ...entries } = merged;
  if (Object.keys(entries).length === 0 && !deleteOrphaned) return undefined;
  return merged;
}

const COLLABORATORS_LOCATION = "settings.collaborators";

function dedupeUsers(users: string[]): string[] {
  const seen = new Set<string>();
  return users.filter((user) => {
    const key = user.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeUsers(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return base;
  if (isArrayMergeDirective(overlay)) {
    return deepMerge(
      { users: base },
      { users: overlay },
      createMergeContext("replace", COLLABORATORS_LOCATION)
    ).users;
  }
  return [...(arrayValues(base) ?? []), ...(overlay as string[])];
}

/**
 * Merges collaborator layers: users union (case-insensitive, first spelling wins),
 * `inherit: false` drops base users but never clears an inherited deleteOrphaned.
 */
function mergeCollaboratorsLayer(
  base: RawCollaboratorsConfig | undefined,
  overlay: RawCollaboratorsConfig | undefined
): RawCollaboratorsConfig {
  const inherited = overlay?.inherit === false ? undefined : base?.users;
  const users = (mergeUsers(inherited, overlay?.users) ??
    []) as RawCollaboratorsConfig["users"];
  const deleteOrphaned = overlay?.deleteOrphaned ?? base?.deleteOrphaned;
  return deleteOrphaned === undefined ? { users } : { users, deleteOrphaned };
}

function finalizeCollaborators(
  merged: RawCollaboratorsConfig
): CollaboratorsConfig | undefined {
  const { users, deleteOrphaned } = stripMergeDirectives(
    { ...mergeCollaboratorsLayer(undefined, merged) },
    COLLABORATORS_LOCATION
  ) as CollaboratorsConfig;
  const deduped = dedupeUsers(users ?? []);
  if (deduped.length === 0 && deleteOrphaned === undefined) return undefined;
  return deleteOrphaned === undefined
    ? { users: deduped }
    : { users: deduped, deleteOrphaned };
}

/**
 * Merges one environment layer over another: a set `deploymentBranchPolicy`
 * replaces the inherited one whole, and secrets merge like repo secrets.
 */
function mergeEnvironmentLayer(
  base: RawEnvironmentConfig | false | undefined,
  overlay: RawEnvironmentConfig
): RawEnvironmentConfig {
  const inherited = base === false ? undefined : base;
  const result: RawEnvironmentConfig = {};

  const policy =
    overlay.deploymentBranchPolicy ?? inherited?.deploymentBranchPolicy;
  if (policy !== undefined) {
    result.deploymentBranchPolicy = structuredClone(policy);
  }

  if (inherited?.secrets || overlay.secrets) {
    result.secrets = mergeEntryMapLayer(
      inherited?.secrets,
      overlay.secrets
    ) as RawEnvironmentConfig["secrets"];
  }

  return result;
}

function environmentLocation(name: string): string {
  return `environment '${name}'`;
}

function finalizeEnvironment(
  name: string,
  env: RawEnvironmentConfig
): EnvironmentConfig {
  const result: EnvironmentConfig = {};
  if (env.deploymentBranchPolicy) {
    result.deploymentBranchPolicy = stripBlock(
      structuredClone(env.deploymentBranchPolicy),
      environmentLocation(name)
    );
  }
  const secrets = dropEntryMapIfEmpty(
    mergeEntryMapLayer(undefined, env.secrets)
  );
  if (secrets) {
    result.secrets = secrets as EnvironmentConfig["secrets"];
  }
  return result;
}

// Matches the entries mergeNamedEntries acts on; anything else is ignored there.
function isMergeableEntry(entry: unknown): boolean {
  return entry === false || (typeof entry === "object" && entry !== null);
}

// GitHub environment names are case-insensitive; base entries take the overlay's spelling so they merge.
type RawEnvironments = NonNullable<RawRepoSettings["environments"]>;

/** `deleteOrphaned` resolves innermost-wins like the entry maps; `inherit: false` never clears it. */
function mergeEnvironmentEntries(
  base: RawRootSettings["environments"],
  overlay: RawEnvironments
): NonNullable<RawRootSettings["environments"]> {
  const { deleteOrphaned: baseDeleteOrphaned, ...baseEnvs } = base ?? {};
  const { deleteOrphaned: overlayDeleteOrphaned, ...overlayEnvs } = overlay;

  const overlayNames = new Map<string, string>();
  for (const [name, entry] of Object.entries(overlayEnvs)) {
    if (name !== "inherit" && isMergeableEntry(entry)) {
      overlayNames.set(name.toLowerCase(), name);
    }
  }

  const rekeyed: Record<string, RawEnvironmentConfig | false> = {};
  for (const [name, env] of Object.entries(baseEnvs)) {
    rekeyed[overlayNames.get(name.toLowerCase()) ?? name] = env;
  }

  const result: NonNullable<RawRootSettings["environments"]> =
    mergeNamedEntries<RawEnvironmentConfig>(
      rekeyed,
      overlayEnvs,
      mergeEnvironmentLayer
    );
  const deleteOrphaned = overlayDeleteOrphaned ?? baseDeleteOrphaned;
  if (deleteOrphaned !== undefined) {
    result.deleteOrphaned = deleteOrphaned;
  }
  return result;
}

interface BlockMerger<K extends keyof RawRepoSettings> {
  merge(
    base: RawRootSettings[K],
    overlay: NonNullable<RawRepoSettings[K]>
  ): RawRootSettings[K];
  finalize(merged: NonNullable<RawRootSettings[K]>): RepoSettings[K];
}

function stripBlock<T extends object>(block: T, location: string): T {
  return stripMergeDirectives(block as Record<string, unknown>, location) as T;
}

function mergeObjectLayer(
  base: Record<string, unknown> | false | undefined,
  overlay: Record<string, unknown>,
  location: string
): Record<string, unknown> {
  const layer = applyInherit(base, overlay);
  return deepMerge(
    layer.base,
    layer.overlay,
    createMergeContext("replace", location)
  );
}

function objectBlock<T extends object>(location: string) {
  return {
    merge: (base: T | false | undefined, overlay: T | false): T | false =>
      overlay === false
        ? false
        : (mergeObjectLayer(
            base as Record<string, unknown> | false | undefined,
            overlay as Record<string, unknown>,
            location
          ) as T),
    finalize: (merged: T | false): T | undefined =>
      merged === false ? undefined : stripBlock(merged, location),
  };
}

const entryMapBlock = {
  merge: (
    base: Record<string, unknown> | undefined,
    overlay: Record<string, unknown>
  ) => mergeEntryMapLayer(base, overlay),
  finalize: (merged: Record<string, unknown>) =>
    dropEntryMapIfEmpty(mergeEntryMapLayer(undefined, merged)),
};

function finalizeRulesets(
  merged: Record<string, Ruleset | false>
): Record<string, Ruleset> | undefined {
  const result: Record<string, Ruleset> = {};
  for (const [name, ruleset] of Object.entries(merged)) {
    if (name === "inherit" || !ruleset || typeof ruleset !== "object") continue;
    result[name] = stripMergeDirectives(
      ruleset as Record<string, unknown>,
      rulesetLocation(name)
    ) as Ruleset;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function labelLocation(name: string): string {
  return `label '${name}'`;
}

function finalizeLabels(
  merged: Record<string, Label | false>
): Record<string, Label> | undefined {
  const result: Record<string, Label> = {};
  for (const [name, label] of Object.entries(merged)) {
    if (name === "inherit" || !label || typeof label !== "object") continue;
    const stripped = stripBlock(label, labelLocation(name));
    const color = (stripped.color ?? "").replace(/^#/, "").toLowerCase();
    result[name] = { ...stripped, color };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function finalizeEnvironments(
  merged: NonNullable<RawRootSettings["environments"]>
): EnvironmentsConfig | undefined {
  const { deleteOrphaned, ...entries } = merged;

  const result: EnvironmentsConfig = {};
  for (const [name, entry] of Object.entries(entries)) {
    if (name === "inherit" || entry === false) continue;
    result[name] = finalizeEnvironment(name, entry);
  }
  if (Object.keys(result).length === 0 && deleteOrphaned !== true) {
    return undefined;
  }
  if (deleteOrphaned !== undefined) {
    result.deleteOrphaned = deleteOrphaned;
  }
  return result;
}

// Key order is the order of keys in the normalized settings
const BLOCKS: { [K in keyof RawRepoSettings]-?: BlockMerger<K> } = {
  rulesets: {
    merge: (base, overlay) =>
      mergeNamedEntries(base, overlay, (existing, entry, name) =>
        existing && typeof existing === "object"
          ? mergeRuleset(name, existing, entry)
          : structuredClone(entry)
      ),
    finalize: finalizeRulesets,
  },
  deleteOrphaned: {
    merge: (_base, overlay) => overlay,
    finalize: (merged) => merged,
  },
  repo: objectBlock<GitHubRepoSettings>("settings.repo"),
  labels: {
    merge: (base, overlay) =>
      mergeNamedEntries(
        base,
        overlay,
        (existing, entry, name) =>
          deepMerge(
            existing && typeof existing === "object" ? { ...existing } : {},
            entry as unknown as Record<string, unknown>,
            createMergeContext("replace", labelLocation(name))
          ) as unknown as Label
      ),
    finalize: finalizeLabels,
  },
  // Replaces whole: state, querySuite and languages are coupled
  codeScanning: {
    merge: (_base, overlay) =>
      overlay === false ? false : structuredClone(overlay),
    finalize: (merged) =>
      merged === false
        ? undefined
        : stripBlock(merged, "settings.codeScanning"),
  },
  actions: objectBlock<ActionsSettings>("settings.actions"),
  variables: entryMapBlock as BlockMerger<"variables">,
  secrets: entryMapBlock as BlockMerger<"secrets">,
  collaborators: {
    merge: mergeCollaboratorsLayer,
    finalize: finalizeCollaborators,
  },
  environments: {
    merge: mergeEnvironmentEntries,
    finalize: finalizeEnvironments,
  },
};

const BLOCK_KEYS = Object.keys(BLOCKS) as Array<keyof RawRepoSettings>;

interface UntypedBlock {
  merge(base: unknown, overlay: unknown): unknown;
  finalize(merged: unknown): unknown;
}

function mergeBlock(
  key: keyof RawRepoSettings,
  result: RawRootSettings,
  overlay: RawRepoSettings
): void {
  const value = overlay[key];
  if (value === undefined || value === null) return;
  const slots = result as Record<string, unknown>;
  slots[key] = (BLOCKS[key] as UntypedBlock).merge(slots[key], value);
}

function finalizeBlock(
  key: keyof RawRepoSettings,
  merged: RawRootSettings,
  result: RepoSettings
): void {
  const value = merged[key];
  if (value === undefined || value === null) return;
  const final = (BLOCKS[key] as UntypedBlock).finalize(value);
  if (final !== undefined) {
    (result as Record<string, unknown>)[key] = dropRepeatedItems(final);
  }
}

function mergeRawSettings(
  base: RawRootSettings | undefined,
  overlay: RawRepoSettings | undefined
): RawRootSettings | undefined {
  if (!base && !overlay) return undefined;
  if (!overlay) return structuredClone(base);

  const result: RawRootSettings = base ? structuredClone(base) : {};
  for (const key of BLOCK_KEYS) mergeBlock(key, result, overlay);
  return result;
}

export function mergeSettings(
  root: RawRootSettings | undefined,
  perRepo: RawRepoSettings | undefined
): RepoSettings | undefined {
  const merged = mergeRawSettings(root, perRepo);
  if (!merged) return undefined;

  const result: RepoSettings = {};
  for (const key of BLOCK_KEYS) finalizeBlock(key, merged, result);
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergeVars(
  base: Record<string, string> | undefined,
  overlay: Record<string, string> | undefined
): Record<string, string> | undefined {
  return base || overlay ? { ...base, ...overlay } : undefined;
}

/**
 * Applies a single file-layer onto an accumulated file map: inherit:false clears,
 * file:false removes entries, otherwise deep-merges content and merges vars per key.
 */
function applyFileLayer(
  accumulated: Record<string, RawFileConfig>,
  layerFiles: Record<
    string,
    RawFileConfig | RawRepoFileOverride | false | undefined
  >
): Record<string, RawFileConfig> {
  const inheritFiles = shouldInherit(layerFiles);

  if (!inheritFiles) {
    accumulated = {};
  }

  for (const [fileName, fileConfig] of Object.entries(layerFiles)) {
    if (fileName === "inherit") continue;

    if (fileConfig === false) {
      delete accumulated[fileName];
      continue;
    }

    if (fileConfig === undefined) continue;

    const existing = accumulated[fileName];
    if (existing) {
      const overlay = fileConfig as RawRepoFileOverride;
      let mergedContent: ContentValue | undefined;

      if (overlay.override || !existing.content || !overlay.content) {
        mergedContent = overlay.content ?? existing.content;
      } else {
        mergedContent = mergeContentPair(
          fileName,
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
        vars: mergeVars(existing.vars, overlay.vars),
      } as RawFileConfig;
    } else {
      accumulated[fileName] = structuredClone(fileConfig) as RawFileConfig;
    }
  }

  return accumulated;
}

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

function mergeGroupPROptions(
  rootPR: PRMergeOptions | undefined,
  groupNames: string[],
  groupDefs: Record<string, RawGroupConfig>
): MergedPROptions | undefined {
  let accumulated: MergedPROptions | undefined = rootPR;
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
  merge: (existing: T | false | undefined, entry: T, name: string) => T
): Record<string, T | false> {
  const inherit = shouldInherit(overlay);
  const result: Record<string, T | false> = inherit ? { ...(base ?? {}) } : {};

  for (const [name, entry] of Object.entries(overlay)) {
    if (name === "inherit") continue;
    if (entry === false) {
      result[name] = false;
    } else if (typeof entry === "object" && entry !== null) {
      const existing = result[name];
      result[name] = merge(existing, entry as T, name);
    }
  }

  return result;
}

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
  accumulatedPROptions: MergedPROptions | undefined,
  accumulatedSettings: RawRootSettings | undefined,
  effectiveGroups: ReadonlySet<string>,
  conditionalGroups: RawConditionalGroupConfig[]
): {
  files: Record<string, RawFileConfig>;
  prOptions: MergedPROptions | undefined;
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

    if (cg.prOptions) {
      prOptions = mergePROptions(prOptions, cg.prOptions);
    }

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
  repoOverride: RawRepoFileOverride | false | undefined,
  inheritFiles: boolean,
  globalDeleteOrphaned: boolean | undefined,
  env: Record<string, string | undefined>
): FileContent | null {
  if (repoOverride === false) return null;
  if (!inheritFiles && !repoOverride) return null;

  const fileStrategy = fileConfig.mergeStrategy ?? "replace";

  let mergedContent = resolveFileContent(
    fileName,
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
    vars: mergeVars(fileConfig.vars, repoOverride?.vars),
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
  effectivePROptions: MergedPROptions | undefined;
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

  const prOptions = finalizePROptions(
    mergePROptions(ctx.effectivePROptions, ctx.rawRepo.prOptions)
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

export function normalizeConfig(
  raw: RawConfig,
  env: Record<string, string | undefined>
): Config {
  const expandedRepos: RepoConfig[] = [];

  for (const rawRepo of raw.repos) {
    const gitUrls = Array.isArray(rawRepo.git) ? rawRepo.git : [rawRepo.git];

    const expandedGroups = rawRepo.groups?.length
      ? expandRepoGroups(rawRepo.groups, raw.groups ?? {})
      : [];

    let effectiveRootFiles = expandedGroups.length
      ? mergeGroupFiles(raw.files ?? {}, expandedGroups, raw.groups ?? {})
      : (raw.files ?? {});

    let effectivePROptions = expandedGroups.length
      ? mergeGroupPROptions(raw.prOptions, expandedGroups, raw.groups ?? {})
      : raw.prOptions;

    let effectiveSettings = expandedGroups.length
      ? mergeGroupSettings(raw.settings, expandedGroups, raw.groups ?? {})
      : raw.settings;

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

  // No per-repo overlay: mergeSettings strips inherit/false entries and normalizes label colors, as it does per repo.
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
