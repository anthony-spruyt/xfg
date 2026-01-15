import {
  deepMerge,
  stripMergeDirectives,
  createMergeContext,
} from "./merge.js";
import { interpolateEnvVars } from "./env.js";
import type { RawConfig, Config, RepoConfig } from "./config.js";

/**
 * Normalizes raw config into expanded, merged config.
 * Pipeline: expand git arrays -> merge content -> interpolate env vars
 */
export function normalizeConfig(raw: RawConfig): Config {
  const baseContent = raw.content ?? {};
  const defaultStrategy = raw.mergeStrategy ?? "replace";
  const expandedRepos: RepoConfig[] = [];

  for (const rawRepo of raw.repos) {
    // Step 1: Expand git arrays
    const gitUrls = Array.isArray(rawRepo.git) ? rawRepo.git : [rawRepo.git];

    for (const gitUrl of gitUrls) {
      // Step 2: Compute merged content
      let mergedContent: Record<string, unknown>;

      if (rawRepo.override) {
        // Override mode: use only repo content
        mergedContent = stripMergeDirectives(
          structuredClone(rawRepo.content as Record<string, unknown>),
        );
      } else if (!rawRepo.content) {
        // No repo content: use root content as-is
        mergedContent = structuredClone(baseContent);
      } else {
        // Merge mode: deep merge base + overlay
        const ctx = createMergeContext(defaultStrategy);
        mergedContent = deepMerge(
          structuredClone(baseContent),
          rawRepo.content,
          ctx,
        );
        mergedContent = stripMergeDirectives(mergedContent);
      }

      // Step 3: Interpolate env vars
      mergedContent = interpolateEnvVars(mergedContent, { strict: true });

      expandedRepos.push({
        git: gitUrl,
        content: mergedContent,
      });
    }
  }

  return {
    fileName: raw.fileName,
    repos: expandedRepos,
  };
}
