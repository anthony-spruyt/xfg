import { ProcessorResult } from "./repository-processor.js";
import { RepoConfig } from "./config.js";
import { MergeOutcome, FileChanges, RepoResult } from "./github-summary.js";
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

/**
 * Build a RepoResult from a ProcessorResult for the summary
 */
export function buildRepoResult(
  repoName: string,
  repoConfig: RepoConfig,
  result: ProcessorResult
): RepoResult {
  if (result.skipped) {
    return {
      repoName,
      status: "skipped",
      message: result.message,
      fileChanges: toFileChanges(result.diffStats),
    };
  }

  if (result.success) {
    let message = result.prUrl ? `PR: ${result.prUrl}` : result.message;
    if (result.mergeResult) {
      if (result.mergeResult.merged) {
        message += " (merged)";
      } else if (result.mergeResult.autoMergeEnabled) {
        message += " (auto-merge enabled)";
      }
    }
    return {
      repoName,
      status: "succeeded",
      message,
      prUrl: result.prUrl,
      mergeOutcome: getMergeOutcome(repoConfig, result),
      fileChanges: toFileChanges(result.diffStats),
    };
  }

  return {
    repoName,
    status: "failed",
    message: result.message,
  };
}

/**
 * Build a RepoResult for an error case
 */
export function buildErrorResult(repoName: string, error: unknown): RepoResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    repoName,
    status: "failed",
    message,
  };
}
