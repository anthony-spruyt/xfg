/**
 * Environment variable interpolation utilities.
 * Supports ${VAR}, ${VAR:-default}, and ${VAR:?message} syntax.
 * Use $${VAR} to escape and output literal ${VAR}.
 */

export interface EnvInterpolationOptions {
  /**
   * If true (default), throws an error when a variable is missing
   * and has no default value. If false, leaves the placeholder as-is.
   */
  strict: boolean;
}

const DEFAULT_OPTIONS: EnvInterpolationOptions = {
  strict: true,
};

/**
 * Regex to match environment variable placeholders.
 * Captures:
 * - Group 1: Variable name
 * - Group 2: Modifier (- for default, ? for required with message)
 * - Group 3: Default value or error message
 *
 * Examples:
 * - ${VAR} -> varName=VAR, modifier=undefined, value=undefined
 * - ${VAR:-default} -> varName=VAR, modifier=-, value=default
 * - ${VAR:?message} -> varName=VAR, modifier=?, value=message
 */
const ENV_VAR_REGEX = /\$\{([^}:]+)(?::([?-])([^}]*))?\}/g;

/**
 * Regex to match escaped environment variable placeholders.
 * $${...} outputs literal ${...} without interpolation.
 * Example: $${VAR} -> ${VAR}, $${VAR:-default} -> ${VAR:-default}
 *
 * Note: Does NOT match $${xfg:...} patterns - those are handled by xfg templating.
 */
const ESCAPED_VAR_REGEX = /\$\$\{((?!xfg:)[^}]+)\}/g;

/**
 * Placeholder prefix for temporarily storing escaped sequences.
 * Uses null bytes which won't appear in normal content.
 */
const ESCAPE_PLACEHOLDER = "\x00ESCAPED_VAR\x00";

/**
 * Check if a value is a plain object (not null, not array).
 */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Process a single string value, replacing environment variable placeholders.
 * Supports escaping with $${VAR} syntax to output literal ${VAR}.
 */
function processString(
  value: string,
  options: EnvInterpolationOptions
): string {
  // Phase 1: Replace escaped $${...} with placeholders
  const escapedContent: string[] = [];
  let processed = value.replace(
    ESCAPED_VAR_REGEX,
    (_match, content: string) => {
      const index = escapedContent.length;
      escapedContent.push(content);
      return `${ESCAPE_PLACEHOLDER}${index}\x00`;
    }
  );

  // Phase 2: Interpolate remaining ${...}
  processed = processed.replace(
    ENV_VAR_REGEX,
    (match, varName: string, modifier?: string, defaultOrMsg?: string) => {
      const envValue = process.env[varName];

      // Variable exists - use its value
      if (envValue !== undefined) {
        return envValue;
      }

      // Has default value (:-default)
      if (modifier === "-") {
        return defaultOrMsg ?? "";
      }

      // Required with message (:?message)
      if (modifier === "?") {
        const message = defaultOrMsg || `is required`;
        throw new Error(`${varName}: ${message}`);
      }

      // No modifier - check strictness
      if (options.strict) {
        throw new Error(`Missing required environment variable: ${varName}`);
      }

      // Non-strict mode - leave placeholder as-is
      return match;
    }
  );

  // Phase 3: Restore escaped sequences as literal ${...}
  processed = processed.replace(
    new RegExp(`${ESCAPE_PLACEHOLDER}(\\d+)\x00`, "g"),
    (_match, indexStr: string) => {
      const index = parseInt(indexStr, 10);
      return `\${${escapedContent[index]}}`;
    }
  );

  return processed;
}

/**
 * Recursively process a value, interpolating environment variables in strings.
 */
function processValue(
  value: unknown,
  options: EnvInterpolationOptions
): unknown {
  if (typeof value === "string") {
    return processString(value, options);
  }

  if (Array.isArray(value)) {
    return value.map((item) => processValue(item, options));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = processValue(val, options);
    }
    return result;
  }

  // For numbers, booleans, null - return as-is
  return value;
}

/**
 * Interpolate environment variables in a JSON object.
 *
 * Supports these syntaxes:
 * - ${VAR} - Replace with env value, error if missing (in strict mode)
 * - ${VAR:-default} - Replace with env value, or use default if missing
 * - ${VAR:?message} - Replace with env value, or throw error with message if missing
 * - $${VAR} - Escape: outputs literal ${VAR} without interpolation
 *
 * @param json - The JSON object to process
 * @param options - Interpolation options (default: strict mode)
 * @returns A new object with interpolated values
 */
export function interpolateEnvVars(
  json: Record<string, unknown>,
  options: EnvInterpolationOptions = DEFAULT_OPTIONS
): Record<string, unknown> {
  return processValue(json, options) as Record<string, unknown>;
}

// =============================================================================
// Text Content Interpolation
// =============================================================================

/**
 * Interpolate environment variables in a string.
 */
export function interpolateEnvVarsInString(
  value: string,
  options: EnvInterpolationOptions = DEFAULT_OPTIONS
): string {
  return processString(value, options);
}

/**
 * Interpolate environment variables in an array of strings.
 */
export function interpolateEnvVarsInLines(
  lines: string[],
  options: EnvInterpolationOptions = DEFAULT_OPTIONS
): string[] {
  return lines.map((line) => processString(line, options));
}

/**
 * Interpolate environment variables in content of any supported type.
 * Handles objects, strings, and string arrays.
 */
export function interpolateContent(
  content: Record<string, unknown> | string | string[],
  options: EnvInterpolationOptions = DEFAULT_OPTIONS
): Record<string, unknown> | string | string[] {
  if (typeof content === "string") {
    return interpolateEnvVarsInString(content, options);
  }
  if (Array.isArray(content)) {
    return interpolateEnvVarsInLines(content, options);
  }
  return interpolateEnvVars(content, options);
}
