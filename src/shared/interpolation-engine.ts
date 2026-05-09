/**
 * Generic 3-phase interpolation engine.
 * Phase 1: Escape — replace $${ patterns with placeholders
 * Phase 2: Interpolate — resolve ${ patterns via callback
 * Phase 3: Restore — replace placeholders with literal ${ sequences
 *
 * Both env.ts and xfg-template.ts use this engine with different
 * regex patterns and resolver callbacks.
 */

import { isPlainObject } from "../shared/type-guards.js";

export interface InterpolationConfig {
  /** Regex to match escaped placeholders (e.g. $${VAR}) — captured group becomes the restore content */
  escapeRegex: RegExp;
  /** Unique placeholder string for escape phase (should not appear in normal content) */
  escapePlaceholder: string;
  /**
   * Apply interpolation replacements to the processed string.
   * Implementations use their own regex internally to avoid
   * passing dynamic regex through the config (CodeQL polynomial-redos).
   */
  applyInterpolation: (value: string) => string;
  /** Reconstruct the escaped literal from the captured content */
  restoreEscaped: (content: string) => string;
}

/**
 * Process a single string through the 3-phase interpolation pipeline.
 */
export function interpolateString(
  value: string,
  config: InterpolationConfig
): string {
  // Phase 1: Replace escaped sequences with placeholders
  const escapedContent: string[] = [];
  let processed = value.replace(
    config.escapeRegex,
    (_match, content: string) => {
      const index = escapedContent.length;
      escapedContent.push(content);
      return `${config.escapePlaceholder}${index}\x00`;
    }
  );

  // Phase 2: Interpolate remaining matches
  processed = config.applyInterpolation(processed);

  // Phase 3: Restore escaped sequences as literal text
  processed = processed.replace(
    new RegExp(`${config.escapePlaceholder}(\\d+)\x00`, "g"),
    (_match, indexStr: string) => {
      const index = parseInt(indexStr, 10);
      return config.restoreEscaped(escapedContent[index]);
    }
  );

  return processed;
}

/**
 * Recursively process a value, interpolating strings within objects and arrays.
 */
export function interpolateValue(
  value: string,
  config: InterpolationConfig
): string;
export function interpolateValue(
  value: unknown[],
  config: InterpolationConfig
): unknown[];
export function interpolateValue(
  value: Record<string, unknown>,
  config: InterpolationConfig
): Record<string, unknown>;
export function interpolateValue(
  value: unknown,
  config: InterpolationConfig
): unknown;
export function interpolateValue(
  value: unknown,
  config: InterpolationConfig
): unknown {
  if (typeof value === "string") {
    return interpolateString(value, config);
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, config));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = interpolateValue(val, config);
    }
    return result;
  }

  // For numbers, booleans, null - return as-is
  return value;
}
