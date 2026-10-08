/**
 * Deep merge utilities for JSON configuration objects.
 * Supports per-field array merge strategies via $arrayMerge + $values (+ $matchBy) directives.
 */

import { isPlainObject } from "../shared/type-guards.js";
import { ValidationError } from "../shared/errors.js";

/**
 * Candidate keys for matching array items by identity rather than index.
 * Order matters — first key found across all items wins.
 */
export const MATCH_KEY_CANDIDATES = ["type", "actor_id"] as const;

/**
 * Finds a key that uniquely identifies items in both arrays.
 * Returns the first candidate key present in every item of both arrays, or undefined.
 */
export function findMatchKey(
  base: unknown[],
  overlay: unknown[]
): string | undefined {
  if (base.length === 0 && overlay.length === 0) return undefined;

  const hasKey = (item: unknown, key: string): boolean =>
    isPlainObject(item) && key in (item as Record<string, unknown>);

  for (const candidate of MATCH_KEY_CANDIDATES) {
    if (
      base.every((item) => hasKey(item, candidate)) &&
      overlay.every((item) => hasKey(item, candidate))
    ) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Keys reserved for xfg merge directives.
 * Only these are stripped during merge — standard $-prefixed keys
 * like $schema, $id, $ref, $generated are preserved.
 */
const XFG_DIRECTIVES = new Set(["$arrayMerge", "$values", "$matchBy"]);

export type ArrayMergeStrategy = "replace" | "append" | "prepend" | "merge";

type ArrayMergeHandler = (
  base: unknown[],
  overlay: unknown[],
  ctx: MergeContext,
  path: string
) => unknown[];

function childPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

type ErrorContext = Pick<MergeContext, "location">;

function mergeError(
  ctx: ErrorContext,
  path: string,
  message: string
): ValidationError {
  const prefix = ctx.location ? `${ctx.location}: ` : "";
  return new ValidationError(`${prefix}${path}: ${message}`);
}

/**
 * Returns the directive's $matchBy key, or undefined when it has none.
 * Throws unless $matchBy is a non-empty string paired with $arrayMerge: merge.
 */
function readMatchBy(
  directive: Record<string, unknown>,
  ctx: ErrorContext,
  path: string
): string | undefined {
  if (!("$matchBy" in directive)) return undefined;
  const matchBy = directive.$matchBy;
  if (typeof matchBy !== "string" || matchBy === "") {
    throw mergeError(ctx, path, "$matchBy must be a non-empty string");
  }
  const strategy = directive.$arrayMerge;
  if (strategy !== "merge") {
    const got = strategy === undefined ? "none" : `'${String(strategy)}'`;
    throw mergeError(
      ctx,
      path,
      `$matchBy requires $arrayMerge: merge, got ${got}`
    );
  }
  return matchBy;
}

function assertKeyedItems(
  items: unknown[],
  matchBy: string,
  label: "base" | "overlay",
  ctx: ErrorContext,
  path: string
): void {
  const firstIndexByValue = new Map<unknown, number>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isPlainObject(item) || !(matchBy in item)) {
      throw mergeError(
        ctx,
        path,
        `${label} item ${i} has no $matchBy key '${matchBy}'`
      );
    }
    const value = item[matchBy];
    const first = firstIndexByValue.get(value);
    if (first !== undefined) {
      throw mergeError(
        ctx,
        path,
        `${label} items ${first} and ${i} share $matchBy ${matchBy} '${String(value)}'`
      );
    }
    firstIndexByValue.set(value, i);
  }
}

function mergeByKey(
  base: unknown[],
  overlay: unknown[],
  matchKey: string,
  ctx: MergeContext,
  path: string
): unknown[] {
  const baseByKey = new Map<
    unknown,
    { item: Record<string, unknown>; index: number }
  >();
  // Callers guarantee every item in both arrays is a plain object with matchKey
  for (let i = 0; i < base.length; i++) {
    const item = base[i] as Record<string, unknown>;
    const keyValue = item[matchKey];
    if (keyValue !== undefined && !baseByKey.has(keyValue)) {
      baseByKey.set(keyValue, { item, index: i });
    }
  }

  const appended: unknown[] = [];

  for (const overlayItem of overlay) {
    const item = overlayItem as Record<string, unknown>;
    const keyValue = item[matchKey];
    const baseEntry = baseByKey.get(keyValue);
    if (baseEntry) {
      baseByKey.set(keyValue, {
        item: mergeObjects(
          baseEntry.item,
          item,
          ctx,
          `${path}[${baseEntry.index}]`
        ),
        index: baseEntry.index,
      });
    } else {
      appended.push(overlayItem);
    }
  }

  const result: unknown[] = [];
  for (let i = 0; i < base.length; i++) {
    const item = base[i] as Record<string, unknown>;
    const keyValue = item[matchKey];
    const entry = baseByKey.get(keyValue);
    if (entry && entry.index === i) {
      result.push(entry.item);
    } else {
      result.push(item);
    }
  }

  result.push(...appended);
  return result;
}

const arrayMergeStrategies: Map<ArrayMergeStrategy, ArrayMergeHandler> =
  new Map([
    ["replace", (_base, overlay) => overlay],
    ["append", (base, overlay) => [...base, ...overlay]],
    ["prepend", (base, overlay) => [...overlay, ...base]],
    [
      "merge",
      (base, overlay, ctx, path) => {
        const matchKey = findMatchKey(base, overlay);
        if (!matchKey) {
          return [...base, ...overlay];
        }
        return mergeByKey(base, overlay, matchKey, ctx, path);
      },
    ],
  ]);

/**
 * Checks if a value is an unresolved $arrayMerge directive object
 * (only directive keys, with a valid strategy and array values).
 */
function isUnresolvedDirective(
  value: unknown
): value is Record<string, unknown> & { $values: unknown[] } {
  if (!isPlainObject(value)) return false;
  return (
    Object.keys(value).every((k) => XFG_DIRECTIVES.has(k)) &&
    typeof value.$arrayMerge === "string" &&
    arrayMergeStrategies.has(value.$arrayMerge as ArrayMergeStrategy) &&
    Array.isArray(value.$values)
  );
}

export interface MergeContext {
  defaultArrayStrategy: ArrayMergeStrategy;
  /** Prefixes merge errors, e.g. the file name being merged. */
  location?: string;
}

function mergeArrays(
  base: unknown[],
  overlay: unknown[],
  strategy: ArrayMergeStrategy,
  ctx: MergeContext,
  path: string
): unknown[] {
  const handler = arrayMergeStrategies.get(strategy);
  if (handler) {
    return handler(base, overlay, ctx, path);
  }
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
  return mergeObjects(base, overlay, ctx, "");
}

function mergeObjects(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
  ctx: MergeContext,
  path: string
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, overlayValue] of Object.entries(overlay)) {
    if (XFG_DIRECTIVES.has(key)) continue;

    const keyPath = childPath(path, key);
    const baseValue = base[key];

    // If base is an unresolved directive (from a previous layer with no base array),
    // resolve it to its $values array before proceeding with merge logic.
    const resolvedBase = isUnresolvedDirective(baseValue)
      ? baseValue.$values
      : baseValue;

    if (
      isPlainObject(overlayValue) &&
      ("$arrayMerge" in overlayValue || "$matchBy" in overlayValue)
    ) {
      const strategy = overlayValue.$arrayMerge;
      const values = overlayValue.$values;
      const matchBy = readMatchBy(overlayValue, ctx, keyPath);

      if (matchBy !== undefined && Array.isArray(values)) {
        assertKeyedItems(values, matchBy, "overlay", ctx, keyPath);
      }

      if (
        (strategy === "replace" ||
          strategy === "append" ||
          strategy === "prepend" ||
          strategy === "merge") &&
        Array.isArray(values) &&
        Array.isArray(resolvedBase)
      ) {
        if (matchBy === undefined) {
          result[key] = mergeArrays(
            resolvedBase,
            values,
            strategy,
            ctx,
            keyPath
          );
        } else {
          assertKeyedItems(resolvedBase, matchBy, "base", ctx, keyPath);
          result[key] = mergeByKey(resolvedBase, values, matchBy, ctx, keyPath);
        }
        continue;
      }
    }

    if (Array.isArray(resolvedBase) && Array.isArray(overlayValue)) {
      result[key] = mergeArrays(
        resolvedBase,
        overlayValue,
        ctx.defaultArrayStrategy,
        ctx,
        keyPath
      );
      continue;
    }

    if (isPlainObject(resolvedBase) && isPlainObject(overlayValue)) {
      result[key] = mergeObjects(resolvedBase, overlayValue, ctx, keyPath);
      continue;
    }

    // Otherwise, overlay wins (including null values)
    result[key] = overlayValue;
  }

  return result;
}

/**
 * Strip xfg merge directive keys ($arrayMerge, $values, $matchBy) from an object.
 * Works recursively on nested objects and arrays.
 * Standard $-prefixed keys ($schema, $id, $ref, etc.) are preserved.
 *
 * When an unresolved directive object is found (only directive keys),
 * it is replaced with the $values array. This handles the case where a directive
 * had no base array to merge with.
 *
 * @param location - Prefixes errors, e.g. the file name being stripped
 */
export function stripMergeDirectives(
  obj: Record<string, unknown>,
  location?: string
): Record<string, unknown> {
  return stripObject(obj, { location }, "");
}

function stripItems(
  items: unknown[],
  errCtx: ErrorContext,
  path: string
): unknown[] {
  return items.map((item, i) =>
    isPlainObject(item) ? stripObject(item, errCtx, `${path}[${i}]`) : item
  );
}

function stripObject(
  obj: Record<string, unknown>,
  errCtx: ErrorContext,
  path: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (XFG_DIRECTIVES.has(key)) continue;

    const keyPath = childPath(path, key);
    if (isUnresolvedDirective(value)) {
      const matchBy = readMatchBy(value, errCtx, keyPath);
      if (matchBy !== undefined) {
        assertKeyedItems(value.$values, matchBy, "overlay", errCtx, keyPath);
      }
      result[key] = stripItems(value.$values, errCtx, keyPath);
    } else if (isPlainObject(value)) {
      result[key] = stripObject(value, errCtx, keyPath);
    } else if (Array.isArray(value)) {
      result[key] = stripItems(value, errCtx, keyPath);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function createMergeContext(
  defaultStrategy: ArrayMergeStrategy = "replace",
  location?: string
): MergeContext {
  return location === undefined
    ? { defaultArrayStrategy: defaultStrategy }
    : { defaultArrayStrategy: defaultStrategy, location };
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
      case "merge":
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
