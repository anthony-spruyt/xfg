import { appendFileSync, statSync } from "node:fs";
import { toErrorMessage } from "../shared/type-guards.js";
import type { DebugLog } from "../shared/logger.js";

export const STEP_SUMMARY_MAX_BYTES = 1024 * 1024;

/**
 * Append markdown to GITHUB_STEP_SUMMARY. Never throws: the summary is best effort.
 * render gets the bytes left, since the 1 MiB limit covers what earlier steps wrote too.
 */
export function writeGitHubStepSummary(
  render: (maxBytes: number) => string,
  summaryPath: string | undefined,
  log?: DebugLog
): void {
  if (!summaryPath) return;
  try {
    const used = statSync(summaryPath, { throwIfNoEntry: false })?.size ?? 0;
    const maxBytes = STEP_SUMMARY_MAX_BYTES - used - 2;
    const markdown = render(maxBytes);
    if (!markdown || Buffer.byteLength(markdown) > maxBytes) return;
    appendFileSync(summaryPath, "\n" + markdown + "\n");
  } catch (error) {
    log?.debug(`Failed to write GitHub step summary: ${toErrorMessage(error)}`);
  }
}
