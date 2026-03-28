/**
 * Deep merge utilities for JSON configuration objects.
 * Supports per-field array merge strategies via $arrayMerge + $values directives.
 */

import { isPlainObject } from "../shared/type-guards.js";

/**
 * Keys reserved for xfg merge directives.
 * Only these are stripped during merge — standard $-prefixed keys
 * like $schema, $id, $ref, $generated are preserved.
 */
const XFG_DIRECTIVES = new Set(["$arrayMerge", "$values"]);

export type ArrayMergeStrategy = "replace" | "append" | "prepend";

type ArrayMergeHandler = (base: unknown[], overlay: unknown[]) => unknown[];

const arrayMergeStrategies: Map<ArrayMergeStrategy, ArrayMergeHandler> =
  new Map([
    ["replace", (_base, overlay) => overlay],
    ["append", (base, overlay) => [...base, ...overlay]],
    ["prepend", (base, overlay) => [...overlay, ...base]],
  ]);

/**
 * Checks if a value is an unresolved $arrayMerge directive object
 * (only contains $arrayMerge + $values keys, with a valid strategy and array values).
 */
function isUnresolvedDirective(
  value: unknown
): value is Record<string, unknown> & { $values: unknown[] } {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.every((k) => XFG_DIRECTIVES.has(k)) &&
    typeof value.$arrayMerge === "string" &&
    arrayMergeStrategies.has(value.$arrayMerge as ArrayMergeStrategy) &&
    Array.isArray(value.$values)
  );
}

export interface MergeContext {
  defaultArrayStrategy: ArrayMergeStrategy;
}

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
    if (XFG_DIRECTIVES.has(key)) continue;

    const baseValue = base[key];

    // If base is an unresolved directive (from a previous layer with no base array),
    // resolve it to its $values array before proceeding with merge logic.
    const resolvedBase = isUnresolvedDirective(baseValue)
      ? baseValue.$values
      : baseValue;

    // Per-field $arrayMerge + $values directive
    if (isPlainObject(overlayValue) && "$arrayMerge" in overlayValue) {
      const strategy = overlayValue.$arrayMerge;
      const values = overlayValue.$values;

      if (
        (strategy === "replace" ||
          strategy === "append" ||
          strategy === "prepend") &&
        Array.isArray(values) &&
        Array.isArray(resolvedBase)
      ) {
        result[key] = mergeArrays(resolvedBase, values, strategy);
        continue;
      }
    }

    // Both are arrays — use default strategy
    if (Array.isArray(resolvedBase) && Array.isArray(overlayValue)) {
      result[key] = mergeArrays(
        resolvedBase,
        overlayValue,
        ctx.defaultArrayStrategy
      );
      continue;
    }

    // Both are plain objects — recurse
    if (isPlainObject(resolvedBase) && isPlainObject(overlayValue)) {
      result[key] = deepMerge(resolvedBase, overlayValue, ctx);
      continue;
    }

    // Otherwise, overlay wins (including null values)
    result[key] = overlayValue;
  }

  return result;
}

/**
 * Strip xfg merge directive keys ($arrayMerge, $values) from an object.
 * Works recursively on nested objects and arrays.
 * Standard $-prefixed keys ($schema, $id, $ref, etc.) are preserved.
 *
 * When an unresolved directive object is found (only contains $arrayMerge + $values),
 * it is replaced with the $values array. This handles the case where a directive
 * had no base array to merge with.
 */
export function stripMergeDirectives(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip xfg directive keys only
    if (XFG_DIRECTIVES.has(key)) continue;

    if (isPlainObject(value)) {
      if (isUnresolvedDirective(value)) {
        // Resolve to the $values array, stripping directives from items
        result[key] = value.$values.map((item) =>
          isPlainObject(item) ? stripMergeDirectives(item) : item
        );
      } else {
        result[key] = stripMergeDirectives(value);
      }
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
