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

/** Why `items` cannot be matched on `matchBy`, or undefined when they can. */
export function keyedItemsProblem(
  items: unknown[],
  matchBy: string
): string | undefined {
  const firstIndexByValue = new Map<unknown, number>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isPlainObject(item) || !Object.hasOwn(item, matchBy)) {
      return `item ${i} has no $matchBy key '${matchBy}'`;
    }
    const value = item[matchBy];
    // Map compares objects by reference, so only primitives can match
    if (
      value !== null &&
      !["string", "number", "boolean"].includes(typeof value)
    ) {
      return `item ${i} $matchBy ${matchBy} must be a string, number, boolean or null`;
    }
    const first = firstIndexByValue.get(value);
    if (first !== undefined) {
      return `items ${first} and ${i} share $matchBy ${matchBy} '${String(value)}'`;
    }
    firstIndexByValue.set(value, i);
  }
  return undefined;
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
    keyedItemsProblem(value.$values, matchBy) === undefined
  );
}

/** An array as it is, a valid directive's `$values`, or null for anything else. */
export function arrayValues(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (isArrayMergeDirective(value)) return value.$values;
  return null;
}
