/**
 * Sanitizes credentials from error messages and logs.
 * Replaces sensitive tokens/passwords with '***' to prevent leakage.
 *
 * @param message The message that may contain credentials
 * @returns The sanitized message with credentials replaced by '***'
 */
export function sanitizeCredentials(
  message: string | undefined | null
): string {
  if (!message) {
    return "";
  }

  let result = message;

  // Handle URL credentials (most common case)
  // Replace password portion in https://user:password@host patterns
  result = result.replace(/(https:\/\/[^:]+:)([^@]+)(@)/g, "$1***$3");

  // Handle Authorization headers
  result = result.replace(/(Authorization:\s*Bearer\s+)(\S+)/gi, "$1***");
  result = result.replace(/(Authorization:\s*Basic\s+)(\S+)/gi, "$1***");

  return result;
}
