import { extname, isAbsolute } from "node:path";
import { isTextContent } from "../merge.js";
import { ValidationError } from "../errors.js";

export { isTextContent };

const VALID_STRATEGIES = ["replace", "append", "prepend"];

/**
 * Check if content is object type (for JSON/YAML output).
 */
export function isObjectContent(content: unknown): boolean {
  return (
    typeof content === "object" && content !== null && !Array.isArray(content)
  );
}

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
