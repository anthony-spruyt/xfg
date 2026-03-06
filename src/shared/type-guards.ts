export function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run a cleanup action, swallowing errors with a debug log.
 * Replaces the repetitive try-catch-debug-log cleanup pattern.
 * If the function returns a Promise, the returned Promise resolves
 * after the cleanup completes (or fails silently).
 */
export async function safeCleanup(
  fn: () => void | Promise<void>,
  label: string,
  log: { debug(msg: string): void }
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    log.debug(`Cleanup: ${label}: ${toErrorMessage(error)}`);
  }
}
