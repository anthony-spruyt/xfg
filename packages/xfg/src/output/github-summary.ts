import { appendFileSync } from "node:fs";
import { toErrorMessage } from "../shared/type-guards.js";
import type { DebugLog } from "../shared/logger.js";

export const STEP_SUMMARY_MAX_BYTES = 1024 * 1024;

/**
 * Append markdown content to GITHUB_STEP_SUMMARY.
 * No-op if summaryPath is not provided.
 */
export function writeGitHubStepSummary(
  markdown: string,
  summaryPath: string | undefined,
  log?: DebugLog
): void {
  if (!summaryPath) return;
  let content = "\n" + markdown + "\n";
  const bytes = Buffer.byteLength(content);
  if (bytes > STEP_SUMMARY_MAX_BYTES) {
    log?.debug(`GitHub step summary is ${bytes} bytes; writing a note instead`);
    content = `\n> [!WARNING]\n> xfg summary too large to show (${bytes} bytes, GitHub limit is 1 MiB). See the job log.\n`;
  }
  try {
    appendFileSync(summaryPath, content);
  } catch (error) {
    log?.debug(`Failed to write GitHub step summary: ${toErrorMessage(error)}`);
  }
}
