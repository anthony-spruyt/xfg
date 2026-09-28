export function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
}

// Escapes only line breaks: JSON-style escaping would double user-written backslashes (^feat\( -> ^feat\\().
export function quoted(text: string): string {
  return `"${text.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

/**
 * Format a scalar value for display: null, undefined, string, boolean.
 * Returns undefined for non-scalar types (arrays, objects) so callers
 * can apply domain-specific formatting.
 */
export function formatScalarValue(val: unknown): string | undefined {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return quoted(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  return undefined;
}
