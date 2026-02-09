/**
 * Escapes a string for safe use as a shell argument.
 * Uses single quotes and escapes any single quotes within the string.
 *
 * @param arg - The string to escape
 * @returns The escaped string wrapped in single quotes
 */
export function escapeShellArg(arg: string): string {
  // Defense-in-depth: reject null bytes even if upstream validation should catch them
  if (arg.includes("\0")) {
    throw new Error("Shell argument contains null byte");
  }
  // Use single quotes and escape any single quotes within
  // 'string' -> quote ends, escaped quote, quote starts again
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
