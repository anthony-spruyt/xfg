import { appendFileSync, statSync } from "node:fs";
import { toErrorMessage } from "../shared/type-guards.js";
import type { DebugLog } from "../shared/logger.js";

export const STEP_SUMMARY_MAX_BYTES = 1024 * 1024;

const TOO_LARGE_NOTE =
  "\n> [!WARNING]\n> xfg summary too large to show (GitHub limit is 1 MiB). See the job log.\n";

// The limit covers the whole file, and earlier steps may have written to it already.
export function summaryBytesLeft(summaryPath: string): number {
  const used = statSync(summaryPath, { throwIfNoEntry: false })?.size ?? 0;
  return STEP_SUMMARY_MAX_BYTES - used - 2;
}

export function writeGitHubStepSummary(
  markdown: string,
  summaryPath: string | undefined,
  log?: DebugLog
): void {
  if (!summaryPath) return;
  try {
    const left = summaryBytesLeft(summaryPath);
    let content = "\n" + markdown + "\n";
    if (Buffer.byteLength(markdown) > left) {
      if (Buffer.byteLength(TOO_LARGE_NOTE) > left + 2) return;
      content = TOO_LARGE_NOTE;
    }
    appendFileSync(summaryPath, content);
  } catch (error) {
    log?.debug(`Failed to write GitHub step summary: ${toErrorMessage(error)}`);
  }
}
