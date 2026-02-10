/**
 * Deep merge utilities for JSON configuration objects.
 * Supports configurable array merge strategies via $arrayMerge directive.
 */

export type ArrayMergeStrategy = "replace" | "append" | "prepend";

/**
 * Handler function type for array merge strategies.
 */
export type ArrayMergeHandler = (
  base: unknown[],
  overlay: unknown[]
) => unknown[];

/**
 * Strategy map for array merge operations.
 * Extensible: add new strategies by adding to this map.
 */
export const arrayMergeStrategies: Map<ArrayMergeStrategy, ArrayMergeHandler> =
  new Map([
    ["replace", (_base, overlay) => overlay],
    ["append", (base, overlay) => [...base, ...overlay]],
    ["prepend", (base, overlay) => [...overlay, ...base]],
  ]);

export interface MergeContext {
  arrayStrategies: Map<string, ArrayMergeStrategy>;
  defaultArrayStrategy: ArrayMergeStrategy;
}

/**
 * Check if a value is a plain object (not null, not array).
 */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
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
 * Extract array values from an overlay object that uses the directive syntax:
 * { $arrayMerge: 'append', values: [1, 2, 3] }
 *
 * Or just return the array if it's already an array.
 */
function extractArrayFromOverlay(overlay: unknown): unknown[] | null {
  if (Array.isArray(overlay)) {
    return overlay;
  }

  if (isPlainObject(overlay) && "values" in overlay) {
    const values = overlay.values;
    if (Array.isArray(values)) {
      return values;
    }
  }

  return null;
}

/**
 * Get merge strategy from an overlay object's $arrayMerge directive.
 */
function getStrategyFromOverlay(overlay: unknown): ArrayMergeStrategy | null {
  if (isPlainObject(overlay) && "$arrayMerge" in overlay) {
    const strategy = overlay.$arrayMerge;
    if (
      strategy === "replace" ||
      strategy === "append" ||
      strategy === "prepend"
    ) {
      return strategy;
    }
  }
  return null;
}

/**
 * Deep merge two objects with configurable array handling.
 *
 * @param base - The base object
 * @param overlay - The overlay object (values override base)
 * @param ctx - Merge context with array strategies
 * @param path - Current path for strategy lookup (internal)
 */
export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
  ctx: MergeContext,
  path: string = ""
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  // Check for $arrayMerge directive at this level (applies to child arrays)
  const levelStrategy = getStrategyFromOverlay(overlay);

  for (const [key, overlayValue] of Object.entries(overlay)) {
    // Skip directive keys in output
    if (key.startsWith("$")) continue;

    const currentPath = path ? `${path}.${key}` : key;
    const baseValue = base[key];

    // If overlay is an object with $arrayMerge directive for an array field
    if (isPlainObject(overlayValue) && "$arrayMerge" in overlayValue) {
      const strategy = getStrategyFromOverlay(overlayValue);
      const overlayArray = extractArrayFromOverlay(overlayValue);

      if (strategy && overlayArray && Array.isArray(baseValue)) {
        result[key] = mergeArrays(baseValue, overlayArray, strategy);
        continue;
      }
    }

    // Both are arrays - apply strategy
    if (Array.isArray(baseValue) && Array.isArray(overlayValue)) {
      // Check for level-specific strategy, then path-specific, then default
      const strategy =
        levelStrategy ??
        ctx.arrayStrategies.get(currentPath) ??
        ctx.defaultArrayStrategy;
      result[key] = mergeArrays(baseValue, overlayValue, strategy);
      continue;
    }

    // Both are plain objects - recurse
    if (isPlainObject(baseValue) && isPlainObject(overlayValue)) {
      // Extract $arrayMerge for child paths if present
      if ("$arrayMerge" in overlayValue) {
        const childStrategy = getStrategyFromOverlay(overlayValue);
        if (childStrategy) {
          // Apply to all immediate child arrays
          for (const childKey of Object.keys(overlayValue)) {
            if (!childKey.startsWith("$")) {
              const childPath = currentPath
                ? `${currentPath}.${childKey}`
                : childKey;
              ctx.arrayStrategies.set(childPath, childStrategy);
            }
          }
        }
      }
      result[key] = deepMerge(baseValue, overlayValue, ctx, currentPath);
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
    arrayStrategies: new Map(),
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
