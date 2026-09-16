/**
 * Convert a camelCase string to snake_case.
 */
export function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}

/**
 * Format a scalar value for display: null, undefined, string, boolean.
 * Returns undefined for non-scalar types (arrays, objects) so callers
 * can apply domain-specific formatting.
 */
export function formatScalarValue(val: unknown): string | undefined {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return val ? "true" : "false";
  return undefined;
}
