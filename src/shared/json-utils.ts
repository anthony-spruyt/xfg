import { toErrorMessage } from "./type-guards.js";
import { SyncError } from "./errors.js";

/**
 * Parse a JSON API response with a contextual error message.
 * Wraps JSON.parse so callers get "Failed to parse <context>: ..." instead of
 * a bare "Unexpected token" SyntaxError.
 */
export function parseApiJson<T>(response: string, context: string): T {
  try {
    return JSON.parse(response) as T;
  } catch (error) {
    const preview = response.slice(0, 200);
    throw new SyncError(
      `Failed to parse ${context}: ${toErrorMessage(error)} — ${preview}`
    );
  }
}
