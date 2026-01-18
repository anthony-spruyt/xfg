import {
  deepMerge,
  stripMergeDirectives,
  createMergeContext,
} from "./merge.js";
import { interpolateEnvVars } from "./env.js";
import type { RawConfig, Config, RepoConfig, FileContent } from "./config.js";

/**
 * Normalizes header to array format.
 */
function normalizeHeader(
  header: string | string[] | undefined,
): string[] | undefined {
  if (header === undefined) return undefined;
  if (typeof header === "string") return [header];
  return header;
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
        let mergedContent: Record<string, unknown> | null;

        if (repoOverride?.override) {
          // Override mode: use only repo file content (may be undefined for empty file)
          if (repoOverride.content === undefined) {
            mergedContent = null;
          } else {
            mergedContent = stripMergeDirectives(
              structuredClone(repoOverride.content),
            );
          }
        } else if (fileConfig.content === undefined) {
          // Root file has no content = empty file (unless repo provides content)
          if (repoOverride?.content) {
            mergedContent = stripMergeDirectives(
              structuredClone(repoOverride.content),
            );
          } else {
            mergedContent = null;
          }
        } else if (!repoOverride?.content) {
          // No repo override: use file base content as-is
          mergedContent = structuredClone(fileConfig.content);
        } else {
          // Merge mode: deep merge file base + repo overlay
          const ctx = createMergeContext(fileStrategy);
          mergedContent = deepMerge(
            structuredClone(fileConfig.content),
            repoOverride.content,
            ctx,
          );
          mergedContent = stripMergeDirectives(mergedContent);
        }

        // Step 4: Interpolate env vars (only if content exists)
        if (mergedContent !== null) {
          mergedContent = interpolateEnvVars(mergedContent, { strict: true });
        }

        // Resolve fields: per-repo overrides root level
        const createOnly = repoOverride?.createOnly ?? fileConfig.createOnly;
        const header = normalizeHeader(
          repoOverride?.header ?? fileConfig.header,
        );
        const schemaUrl = repoOverride?.schemaUrl ?? fileConfig.schemaUrl;

        files.push({
          fileName,
          content: mergedContent,
          createOnly,
          header,
          schemaUrl,
        });
      }

      expandedRepos.push({
        git: gitUrl,
        files,
      });
    }
  }

  return {
    repos: expandedRepos,
  };
}
