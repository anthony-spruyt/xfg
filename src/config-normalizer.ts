import {
  deepMerge,
  stripMergeDirectives,
  createMergeContext,
  isTextContent,
  mergeTextContent,
} from "./merge.js";
import { interpolateContent } from "./env.js";
import type {
  RawConfig,
  Config,
  RepoConfig,
  FileContent,
  ContentValue,
  PRMergeOptions,
  RepoSettings,
  RawRepoSettings,
  Ruleset,
} from "./config.js";

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

  if (merge !== undefined) result.merge = merge;
  if (mergeStrategy !== undefined) result.mergeStrategy = mergeStrategy;
  if (deleteBranch !== undefined) result.deleteBranch = deleteBranch;
  if (bypassReason !== undefined) result.bypassReason = bypassReason;

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
export function mergeSettings(
  root: RawRepoSettings | undefined,
  perRepo: RawRepoSettings | undefined
): RepoSettings | undefined {
  if (!root && !perRepo) return undefined;

  const result: RepoSettings = {};

  // Merge rulesets by name - each ruleset is deep merged
  const rootRulesets = root?.rulesets ?? {};
  const repoRulesets = perRepo?.rulesets ?? {};
  const allRulesetNames = new Set([
    ...Object.keys(rootRulesets),
    ...Object.keys(repoRulesets),
  ]);

  if (allRulesetNames.size > 0) {
    result.rulesets = {};
    for (const name of allRulesetNames) {
      result.rulesets[name] = mergeRuleset(
        rootRulesets[name],
        repoRulesets[name]
      );
    }
  }

  // deleteOrphaned: per-repo overrides root
  const deleteOrphaned = perRepo?.deleteOrphaned ?? root?.deleteOrphaned;
  if (deleteOrphaned !== undefined) {
    result.deleteOrphaned = deleteOrphaned;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Normalizes raw config into expanded, merged config.
 * Pipeline: expand git arrays -> merge content -> interpolate env vars
 */
export function normalizeConfig(raw: RawConfig): Config {
  const expandedRepos: RepoConfig[] = [];
  const fileNames = Object.keys(raw.files);

  for (const rawRepo of raw.repos) {
    // Step 1: Expand git arrays
    const gitUrls = Array.isArray(rawRepo.git) ? rawRepo.git : [rawRepo.git];

    for (const gitUrl of gitUrls) {
      const files: FileContent[] = [];

      // Step 2: Process each file definition
      for (const fileName of fileNames) {
        const repoOverride = rawRepo.files?.[fileName];

        // Skip excluded files (set to false)
        if (repoOverride === false) {
          continue;
        }

        const fileConfig = raw.files[fileName];
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
      });
    }
  }

  return {
    id: raw.id,
    repos: expandedRepos,
    prTemplate: raw.prTemplate,
    githubHosts: raw.githubHosts,
    deleteOrphaned: raw.deleteOrphaned,
    settings: raw.settings,
  };
}
