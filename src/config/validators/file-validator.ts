import { extname, isAbsolute } from "node:path";
import { isTextContent, type ArrayMergeStrategy } from "../merge.js";
import { ValidationError } from "../../shared/errors.js";
import { isPlainObject } from "../../shared/type-guards.js";

export { isTextContent };
export { isPlainObject as isObjectContent };

export function validValues<T extends string>(
  values: readonly T[]
): readonly string[] {
  return values;
}

const VALID_STRATEGIES = validValues<ArrayMergeStrategy>([
  "replace",
  "append",
  "prepend",
  "merge",
]);

/**
 * Check if file extension is for structured output (JSON/YAML).
 */
export function isStructuredFileExtension(fileName: string): boolean {
  const ext = extname(fileName).toLowerCase();
  return (
    ext === ".json" || ext === ".json5" || ext === ".yaml" || ext === ".yml"
  );
}

/**
 * Validates a file name for security issues
 */
export function validateFileName(fileName: string): void {
  if (!fileName || typeof fileName !== "string") {
    throw new ValidationError("File name must be a non-empty string");
  }

  // Validate fileName doesn't allow path traversal
  if (fileName.includes("..") || isAbsolute(fileName)) {
    throw new ValidationError(
      `Invalid fileName '${fileName}': must be a relative path without '..' components`
    );
  }

  // Validate fileName doesn't contain control characters that could bypass shell escaping
  if (/[\n\r\0]/.test(fileName)) {
    throw new ValidationError(
      `Invalid fileName '${fileName}': cannot contain newlines or null bytes`
    );
  }
}

export { VALID_STRATEGIES };
