import { ProcessorResult } from "./repository-processor.js";
import { RepoConfig } from "./config.js";
import { MergeOutcome, FileChanges } from "./github-summary.js";
import { DiffStats } from "./diff-utils.js";

/**
 * Determine merge outcome from repo config and processor result
 */
export function getMergeOutcome(
  repoConfig: RepoConfig,
  result: ProcessorResult
): MergeOutcome | undefined {
  if (!result.success || result.skipped) return undefined;

  const mergeMode = repoConfig.prOptions?.merge ?? "auto";

  if (mergeMode === "direct") return "direct";
  if (result.mergeResult?.merged) return "force";
  if (result.mergeResult?.autoMergeEnabled) return "auto";
  if (result.prUrl) return "manual";

  return undefined;
}

/**
 * Convert DiffStats to FileChanges for summary output
 */
export function toFileChanges(diffStats?: DiffStats): FileChanges | undefined {
  if (!diffStats) return undefined;
  return {
    added: diffStats.newCount,
    modified: diffStats.modifiedCount,
    deleted: diffStats.deletedCount,
    unchanged: diffStats.unchangedCount,
  };
}
