import type { Resource, ResourceAction } from "../output/plan-formatter.js";
import type { ProcessorResult } from "../sync/index.js";
import type { RepoConfig } from "../config/index.js";

/**
 * Convert sync ProcessorResult diffStats to Resource objects.
 * Since we don't have per-file details, we represent each file from config
 * with the aggregate action based on diffStats.
 */
export function syncResultToResources(
  repoName: string,
  repoConfig: Pick<RepoConfig, "files">,
  result: ProcessorResult
): Resource[] {
  const resources: Resource[] = [];

  if (result.skipped) {
    // Mark all files as unchanged when skipped
    for (const file of repoConfig.files) {
      resources.push({
        type: "file",
        repo: repoName,
        name: file.fileName,
        action: "unchanged",
      });
    }
    return resources;
  }

  if (!result.diffStats) {
    return resources;
  }

  // With aggregate stats, we can show repo-level summary
  // For now, create one resource per file in config with best-effort action
  // Note: This is approximate since we don't have per-file tracking
  const { newCount, modifiedCount, deletedCount } = result.diffStats;

  for (const file of repoConfig.files) {
    // Determine action based on aggregate stats - this is a simplification
    let action: ResourceAction = "unchanged";
    if (newCount > 0) {
      action = "create";
    } else if (modifiedCount > 0) {
      action = "update";
    } else if (deletedCount > 0) {
      action = "delete";
    }

    resources.push({
      type: "file",
      repo: repoName,
      name: file.fileName,
      action,
    });
  }

  return resources;
}
