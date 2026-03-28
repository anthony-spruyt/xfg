import type { DebugLog } from "./logger.js";
import { toErrorMessage } from "./type-guards.js";

/**
 * Run a cleanup action, swallowing errors with a debug log.
 * Replaces the repetitive try-catch-debug-log cleanup pattern.
 * If the function returns a Promise, the returned Promise resolves
 * after the cleanup completes (or fails silently).
 */
export async function safeCleanup(
  fn: () => void | Promise<void>,
  label: string,
  log: DebugLog
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    log.debug(`Cleanup: ${label}: ${toErrorMessage(error)}`);
  }
}
