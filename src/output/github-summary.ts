import { appendFileSync } from "node:fs";
import { toErrorMessage } from "../shared/type-guards.js";
import type { DebugLog } from "../shared/logger.js";

/**
 * Append markdown content to GITHUB_STEP_SUMMARY.
 * No-op if summaryPath is not provided.
 */
export function writeGitHubStepSummary(
  markdown: string,
  summaryPath: string | undefined,
  log?: DebugLog
): void {
  const path = summaryPath;
  if (!path) return;
  try {
    appendFileSync(path, "\n" + markdown + "\n");
  } catch (error) {
    log?.debug(`Failed to write GitHub step summary: ${toErrorMessage(error)}`);
  }
}
