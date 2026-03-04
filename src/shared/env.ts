/**
 * Environment variable interpolation utilities.
 * Supports ${VAR}, ${VAR:-default}, and ${VAR:?message} syntax.
 * Use $${VAR} to escape and output literal ${VAR}.
 */

import {
  interpolateString,
  interpolateValue,
  type InterpolationConfig,
} from "./interpolation-engine.js";

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
const ENV_VAR_REGEX = /\$\{([A-Za-z_][A-Za-z0-9_.]*?)(?::([?-])([^}]*))?\}/g;

/**
 * Regex to match escaped environment variable placeholders.
 * $${...} outputs literal ${...} without interpolation.
 * Example: $${VAR} -> ${VAR}, $${VAR:-default} -> ${VAR:-default}
 *
 * Note: Does NOT match $${xfg:...} patterns - those are handled by xfg templating.
 */
const ESCAPED_VAR_REGEX = /\$\$\{((?!xfg:)[^}]+)\}/g;

function buildEnvConfig(options: EnvInterpolationOptions): InterpolationConfig {
  return {
    escapeRegex: ESCAPED_VAR_REGEX,
    matchRegex: ENV_VAR_REGEX,
    escapePlaceholder: "\x00ESCAPED_VAR\x00",
    resolve(match, varName, modifier, defaultOrMsg) {
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
    },
    restoreEscaped: (content) => `\${${content}}`,
  };
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
  return interpolateValue(json, buildEnvConfig(options)) as Record<
    string,
    unknown
  >;
}

/**
 * Interpolate environment variables in content of any supported type.
 * Handles objects, strings, and string arrays.
 */
export function interpolateContent(
  content: Record<string, unknown> | string | string[],
  options: EnvInterpolationOptions = DEFAULT_OPTIONS
): Record<string, unknown> | string | string[] {
  const config = buildEnvConfig(options);
  if (typeof content === "string") {
    return interpolateString(content, config);
  }
  if (Array.isArray(content)) {
    return content.map((line) => interpolateString(line, config));
  }
  return interpolateEnvVars(content, options);
}
