import type { Resource, ResourceAction } from "../output/plan-formatter.js";
import type { RulesetProcessorResult } from "./rulesets/processor.js";
import type { ProcessorResult } from "../sync/index.js";
import type { RepoConfig } from "../config/index.js";

/**
 * Convert RulesetProcessorResult planOutput entries to Resource objects.
 * Includes the detailed plan lines in the first resource's details for display.
 */
export function rulesetResultToResources(
  repoName: string,
  result: RulesetProcessorResult
): Resource[] {
  const resources: Resource[] = [];
  const planLines = result.planOutput?.lines ?? [];

  if (result.planOutput?.entries) {
    for (let i = 0; i < result.planOutput.entries.length; i++) {
      const entry = result.planOutput.entries[i];
      let action: ResourceAction;
      switch (entry.action) {
        case "create":
          action = "create";
          break;
        case "update":
          action = "update";
          break;
        case "delete":
          action = "delete";
          break;
        default:
          action = "unchanged";
      }

      // Attach all plan lines to first resource for GitHub summary display
      const details =
        i === 0 && planLines.length > 0 ? { diff: planLines } : undefined;

      resources.push({
        type: "ruleset",
        repo: repoName,
        name: entry.name,
        action,
        details,
      });
    }
  }

  return resources;
}

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

/**
 * Convert repo settings processor planOutput entries to Resource objects.
 * Includes the detailed plan lines in the first resource's details for display.
 */
export function repoSettingsResultToResources(
  repoName: string,
  result: {
    planOutput?: {
      entries?: Array<{ property: string; action: string }>;
      lines?: string[];
    };
  }
): Resource[] {
  const resources: Resource[] = [];
  const planLines = result.planOutput?.lines ?? [];

  if (result.planOutput?.entries) {
    for (let i = 0; i < result.planOutput.entries.length; i++) {
      const entry = result.planOutput.entries[i];

      // Attach all plan lines to first resource for GitHub summary display
      const details =
        i === 0 && planLines.length > 0 ? { diff: planLines } : undefined;

      resources.push({
        type: "setting",
        repo: repoName,
        name: entry.property,
        action: entry.action === "add" ? "create" : "update",
        details,
      });
    }
  }

  return resources;
}
