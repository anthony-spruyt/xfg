import { appendFileSync, closeSync, fstatSync, openSync } from "node:fs";
import { toErrorMessage } from "../shared/type-guards.js";
import type { DebugLog } from "../shared/logger.js";

export const STEP_SUMMARY_MAX_BYTES = 1024 * 1024;

/**
 * Append markdown to GITHUB_STEP_SUMMARY. Never throws: the summary is best effort.
 * render gets the bytes left: the 1 MiB limit covers everything already in this step's file.
 */
export function writeGitHubStepSummary(
  render: (maxBytes: number) => string,
  summaryPath: string | undefined,
  log?: DebugLog
): void {
  if (!summaryPath) return;
  let fd: number | undefined;
  try {
    fd = openSync(summaryPath, "a");
    const maxBytes = STEP_SUMMARY_MAX_BYTES - fstatSync(fd).size - 2;
    const markdown = render(maxBytes);
    if (markdown && Buffer.byteLength(markdown) <= maxBytes) {
      appendFileSync(fd, "\n" + markdown + "\n");
    }
    closeSync(fd);
    fd = undefined;
  } catch (error) {
    log?.debug(`Failed to write GitHub step summary: ${toErrorMessage(error)}`);
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Already reporting the first error.
      }
    }
  }
}
