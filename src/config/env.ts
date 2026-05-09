/**
 * Environment variable interpolation utilities.
 * Supports ${VAR}, ${VAR:-default}, and ${VAR:?message} syntax.
 * Use $${VAR} to escape and output literal ${VAR}.
 */

import {
  interpolateString,
  interpolateValue,
  type InterpolationConfig,
} from "../shared/interpolation-engine.js";
import { ValidationError } from "../shared/errors.js";

export interface EnvInterpolationOptions {
  /**
   * If true (default), throws an error when a variable is missing
   * and has no default value. If false, leaves the placeholder as-is.
   */
  strict: boolean;
  /**
   * Environment variables to resolve from.
   */
  env: Record<string, string | undefined>;
}

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
const ENV_VAR_REGEX = /\$\{([A-Za-z_][A-Za-z0-9_.]*)(?::([?-])([^}]*))?\}/g;

/**
 * Regex to match escaped environment variable placeholders.
 * $${...} outputs literal ${...} without interpolation.
 * Example: $${VAR} -> ${VAR}, $${VAR:-default} -> ${VAR:-default}
 *
 * Note: Does NOT match $${xfg:...} patterns - those are handled by xfg templating.
 */
const ESCAPED_VAR_REGEX = /\$\$\{((?!xfg:)[^}]+)\}/g;

function buildEnvConfig(options: EnvInterpolationOptions): InterpolationConfig {
  const envSource = options.env;
  function resolveEnvVar(
    match: string,
    varName: string,
    modifier: string | undefined,
    defaultOrMsg: string | undefined
  ): string {
    // Resolution follows bash parameter expansion semantics:
    // ${VAR} → value or error, ${VAR:-fallback} → value or fallback,
    // ${VAR:?msg} → value or throw with msg.
    const envValue = envSource[varName];

    if (envValue !== undefined) {
      return envValue;
    }

    if (modifier === "-") {
      return defaultOrMsg ?? "";
    }

    if (modifier === "?") {
      const message = defaultOrMsg || `is required`;
      throw new ValidationError(`${varName}: ${message}`);
    }

    if (options.strict) {
      throw new ValidationError(
        `Missing required environment variable: ${varName}`
      );
    }

    return match;
  }

  return {
    escapeRegex: ESCAPED_VAR_REGEX,
    escapePlaceholder: "\x00ESCAPED_VAR\x00",
    applyInterpolation: (value) => value.replace(ENV_VAR_REGEX, resolveEnvVar),
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
 */
export function interpolateEnvVars(
  json: Record<string, unknown>,
  options: EnvInterpolationOptions
): Record<string, unknown> {
  return interpolateValue(json, buildEnvConfig(options));
}

/**
 * Interpolate environment variables in content of any supported type.
 * Handles objects, strings, and string arrays.
 */
export function interpolateContent(
  content: Record<string, unknown> | string | string[],
  options: EnvInterpolationOptions
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
