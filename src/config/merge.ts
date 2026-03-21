/**
 * Deep merge utilities for JSON configuration objects.
 * Supports per-field array merge strategies via $arrayMerge + $values directives.
 */

import { isPlainObject } from "../shared/type-guards.js";

export type ArrayMergeStrategy = "replace" | "append" | "prepend";

/**
 * Handler function type for array merge strategies.
 */
type ArrayMergeHandler = (base: unknown[], overlay: unknown[]) => unknown[];

/**
 * Strategy map for array merge operations.
 * Extensible: add new strategies by adding to this map.
 */
const arrayMergeStrategies: Map<ArrayMergeStrategy, ArrayMergeHandler> =
  new Map([
    ["replace", (_base, overlay) => overlay],
    ["append", (base, overlay) => [...base, ...overlay]],
    ["prepend", (base, overlay) => [...overlay, ...base]],
  ]);

export interface MergeContext {
  defaultArrayStrategy: ArrayMergeStrategy;
}

/**
 * Merge two arrays based on the specified strategy.
 */
function mergeArrays(
  base: unknown[],
  overlay: unknown[],
  strategy: ArrayMergeStrategy
): unknown[] {
  const handler = arrayMergeStrategies.get(strategy);
  if (handler) {
    return handler(base, overlay);
  }
  // Fallback to replace for unknown strategies
  return overlay;
}

/**
 * Deep merge two objects with configurable array handling.
 *
 * @param base - The base object
 * @param overlay - The overlay object (values override base)
 * @param ctx - Merge context with array strategies
 */
export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
  ctx: MergeContext
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, overlayValue] of Object.entries(overlay)) {
    // Skip directive keys in output
    if (key.startsWith("$")) continue;

    const baseValue = base[key];

    // Per-field $arrayMerge + $values directive
    if (isPlainObject(overlayValue) && "$arrayMerge" in overlayValue) {
      const strategy = overlayValue.$arrayMerge;
      const values = overlayValue.$values;

      if (
        (strategy === "replace" ||
          strategy === "append" ||
          strategy === "prepend") &&
        Array.isArray(values) &&
        Array.isArray(baseValue)
      ) {
        result[key] = mergeArrays(baseValue, values, strategy);
        continue;
      }
    }

    // Both are arrays — use default strategy
    if (Array.isArray(baseValue) && Array.isArray(overlayValue)) {
      result[key] = mergeArrays(
        baseValue,
        overlayValue,
        ctx.defaultArrayStrategy
      );
      continue;
    }

    // Both are plain objects — recurse
    if (isPlainObject(baseValue) && isPlainObject(overlayValue)) {
      result[key] = deepMerge(baseValue, overlayValue, ctx);
      continue;
    }

    // Otherwise, overlay wins (including null values)
    result[key] = overlayValue;
  }

  return result;
}

/**
 * Strip merge directive keys ($arrayMerge, $override, etc.) from an object.
 * Works recursively on nested objects and arrays.
 */
export function stripMergeDirectives(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip all $-prefixed keys (reserved for directives)
    if (key.startsWith("$")) continue;

    if (isPlainObject(value)) {
      result[key] = stripMergeDirectives(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        isPlainObject(item) ? stripMergeDirectives(item) : item
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Create a default merge context.
 */
export function createMergeContext(
  defaultStrategy: ArrayMergeStrategy = "replace"
): MergeContext {
  return {
    defaultArrayStrategy: defaultStrategy,
  };
}

// =============================================================================
// Text Content Utilities
// =============================================================================

/**
 * Check if content is text type (string or string[]).
 */
export function isTextContent(content: unknown): content is string | string[] {
  return (
    typeof content === "string" ||
    (Array.isArray(content) &&
      content.every((item) => typeof item === "string"))
  );
}

/**
 * Merge two text content values.
 * For strings: overlay replaces base entirely.
 * For string arrays: applies merge strategy.
 * For mixed types: overlay replaces base.
 */
export function mergeTextContent(
  base: string | string[],
  overlay: string | string[],
  strategy: ArrayMergeStrategy = "replace"
): string | string[] {
  // If overlay is a string, it always replaces
  if (typeof overlay === "string") {
    return overlay;
  }

  // If overlay is an array
  if (Array.isArray(overlay)) {
    // If base is also an array, apply merge strategy
    if (Array.isArray(base)) {
      switch (strategy) {
        case "append":
          return [...base, ...overlay];
        case "prepend":
          return [...overlay, ...base];
        case "replace":
        default:
          return overlay;
      }
    }
    // Base is string, overlay is array - overlay replaces
    return overlay;
  }

  // Fallback (shouldn't reach here with proper types)
  return overlay;
}
