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
  const pathPrefix = path ? `${path}: ` : "";
  return new ValidationError(`${prefix}${pathPrefix}${message}`);
}

function describeValue(value: unknown): string {
  if (value === undefined) return "none";
  if (typeof value === "string") return `'${value}'`;
  return JSON.stringify(value);
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
    throw mergeError(
      ctx,
      path,
      `$matchBy requires $arrayMerge: merge, got ${describeValue(strategy)}`
    );
  }
  return matchBy;
}

function isDirectiveOnly(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => XFG_DIRECTIVES.has(k));
}

/**
 * Validates a value's directive keys and returns its $matchBy.
 * An object of only directive keys must be a complete directive, or it would resolve to nothing.
 */
function readDirective(
  value: unknown,
  ctx: ErrorContext,
  path: string
): string | undefined {
  if (!isPlainObject(value)) return undefined;
  const matchBy = readMatchBy(value, ctx, path);
  if (!isDirectiveOnly(value)) return matchBy;
  if (!isArrayMergeStrategy(value.$arrayMerge)) {
    const strategies = [...arrayMergeStrategies.keys()].join(", ");
    throw mergeError(
      ctx,
      path,
      `$arrayMerge must be one of ${strategies}, got ${describeValue(value.$arrayMerge)}`
    );
  }
  if (!Array.isArray(value.$values)) {
    throw mergeError(
      ctx,
      path,
      `$values must be an array, got ${describeValue(value.$values)}`
    );
  }
  return matchBy;
}

/** Rejects directive-only objects; mixed-key objects keep their directive keys stripped silently. */
function assertNotDirective(
  value: unknown,
  ctx: ErrorContext,
  path: string,
  position: "an array item" | "the content root"
): void {
  if (isPlainObject(value) && isDirectiveOnly(value)) {
    throw mergeError(
      ctx,
      path,
      `a directive must be the value of a key whose base is an array, not ${position}`
    );
  }
}

function assertKeyedItems(
  items: unknown[],
  matchBy: string,
  label: "base" | "overlay" | "$values",
  ctx: ErrorContext,
  path: string
): void {
  const firstIndexByValue = new Map<unknown, number>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isPlainObject(item) || !Object.hasOwn(item, matchBy)) {
      throw mergeError(
        ctx,
        path,
        `${label} item ${i} has no $matchBy key '${matchBy}'`
      );
    }
    const value = item[matchBy];
    // Map compares objects by reference, so only primitives can match
    if (
      value !== null &&
      !["string", "number", "boolean"].includes(typeof value)
    ) {
      throw mergeError(
        ctx,
        path,
        `${label} item ${i} $matchBy ${matchBy} must be a string, number, boolean or null`
      );
    }
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
    isDirectiveOnly(value) &&
    isArrayMergeStrategy(value.$arrayMerge) &&
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
  assertNotDirective(base, ctx, "", "the content root");
  assertNotDirective(overlay, ctx, "", "the content root");
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
    result[key] = mergeValue(
      base[key],
      overlayValue,
      ctx,
      childPath(path, key)
    );
  }

  return result;
}

function mergeValue(
  baseValue: unknown,
  overlayValue: unknown,
  ctx: MergeContext,
  path: string
): unknown {
  const resolvedBase = resolveBase(baseValue, ctx, path);
  const overlayMatchBy = readDirective(overlayValue, ctx, path);

  if (isArrayDirective(overlayValue)) {
    const merged = applyArrayDirective(
      resolvedBase,
      overlayValue,
      overlayMatchBy,
      ctx,
      path
    );
    if (merged !== undefined) return merged;
  }

  if (Array.isArray(resolvedBase) && Array.isArray(overlayValue)) {
    return mergeArrays(
      resolvedBase,
      overlayValue,
      ctx.defaultArrayStrategy,
      ctx,
      path
    );
  }

  if (isPlainObject(resolvedBase) && isPlainObject(overlayValue)) {
    return mergeObjects(resolvedBase, overlayValue, ctx, path);
  }

  return overlayValue;
}

/**
 * A directive left unresolved by an earlier layer with no base array acts as its $values.
 * Any other base is returned as-is once its directive keys are valid.
 */
function resolveBase(base: unknown, ctx: MergeContext, path: string): unknown {
  const matchBy = readDirective(base, ctx, path);
  if (!isUnresolvedDirective(base)) return base;
  if (matchBy !== undefined) {
    assertKeyedItems(base.$values, matchBy, "base", ctx, path);
  }
  return base.$values;
}

function isArrayDirective(value: unknown): value is Record<string, unknown> {
  return (
    isPlainObject(value) && ("$arrayMerge" in value || "$matchBy" in value)
  );
}

function isArrayMergeStrategy(value: unknown): value is ArrayMergeStrategy {
  return (
    typeof value === "string" &&
    arrayMergeStrategies.has(value as ArrayMergeStrategy)
  );
}

/**
 * Applies an overlay directive to the base array.
 * Returns undefined when it doesn't apply, so the caller falls back to a plain merge.
 */
function applyArrayDirective(
  base: unknown,
  directive: Record<string, unknown>,
  matchBy: string | undefined,
  ctx: MergeContext,
  path: string
): unknown[] | undefined {
  const strategy = directive.$arrayMerge;
  const values = directive.$values;

  if (matchBy !== undefined && Array.isArray(values)) {
    assertKeyedItems(values, matchBy, "overlay", ctx, path);
  }

  if (
    !isArrayMergeStrategy(strategy) ||
    !Array.isArray(values) ||
    !Array.isArray(base)
  ) {
    return undefined;
  }

  if (matchBy === undefined) {
    return mergeArrays(base, values, strategy, ctx, path);
  }
  assertKeyedItems(base, matchBy, "base", ctx, path);
  return mergeByKey(base, values, matchBy, ctx, path);
}

/**
 * Strip xfg merge directive keys ($arrayMerge, $values, $matchBy) from an object.
 * Works recursively on nested objects and arrays.
 * Standard $-prefixed keys ($schema, $id, $ref, etc.) are preserved.
 *
 * A valid directive-only object that is the value of a key had no base array
 * to merge with, and is replaced with its $values array. A directive-only object
 * that is invalid, an array item, or the root is a ValidationError.
 *
 * @param location - Prefixes errors, e.g. the file name being stripped
 */
export function stripMergeDirectives(
  obj: Record<string, unknown>,
  location?: string
): Record<string, unknown> {
  const errCtx = { location };
  assertNotDirective(obj, errCtx, "", "the content root");
  return stripObject(obj, errCtx, "");
}

function stripItems(
  items: unknown[],
  errCtx: ErrorContext,
  path: string
): unknown[] {
  return items.map((item, i) => {
    if (!isPlainObject(item)) return item;
    const itemPath = `${path}[${i}]`;
    assertNotDirective(item, errCtx, itemPath, "an array item");
    return stripObject(item, errCtx, itemPath);
  });
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
    // Validate before branching: an invalid directive is not resolved and would be stripped silently
    const matchBy = readDirective(value, errCtx, keyPath);
    if (isUnresolvedDirective(value)) {
      if (matchBy !== undefined) {
        assertKeyedItems(value.$values, matchBy, "$values", errCtx, keyPath);
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
  if (typeof overlay === "string") {
    return overlay;
  }

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
  return overlay;
}
