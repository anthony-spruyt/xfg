import { isPlainObject } from "../shared/type-guards.js";

export const ARRAY_MERGE_STRATEGIES = [
  "replace",
  "append",
  "prepend",
  "merge",
] as const;

export type ArrayMergeStrategy = (typeof ARRAY_MERGE_STRATEGIES)[number];

// Only these are stripped; other $-prefixed keys ($schema, $id, $ref) are content
export const DIRECTIVE_KEYS: ReadonlySet<string> = new Set([
  "$arrayMerge",
  "$values",
  "$matchBy",
]);

interface ArrayMergeDirective {
  $arrayMerge: ArrayMergeStrategy;
  $values: unknown[];
  $matchBy?: string;
}

export function isArrayMergeStrategy(
  value: unknown
): value is ArrayMergeStrategy {
  return (
    typeof value === "string" &&
    (ARRAY_MERGE_STRATEGIES as readonly string[]).includes(value)
  );
}

/** Accepts exactly what merge.ts resolves, so validation and merge agree. */
export function isArrayMergeDirective(
  value: unknown
): value is ArrayMergeDirective {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || !keys.every((key) => DIRECTIVE_KEYS.has(key))) {
    return false;
  }
  if (!isArrayMergeStrategy(value.$arrayMerge)) return false;
  if (!Array.isArray(value.$values)) return false;
  if (!("$matchBy" in value)) return true;

  const matchBy = value.$matchBy;
  return (
    value.$arrayMerge === "merge" &&
    typeof matchBy === "string" &&
    matchBy !== "" &&
    value.$values.every(
      (item) => isPlainObject(item) && Object.hasOwn(item, matchBy)
    )
  );
}

/** An array as it is, a valid directive's `$values`, or null for anything else. */
export function arrayValues(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (isArrayMergeDirective(value)) return value.$values;
  return null;
}
