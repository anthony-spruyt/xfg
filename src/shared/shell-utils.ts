export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escapes a string for safe use as a shell argument.
 * Uses single quotes and escapes any single quotes within the string.
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
