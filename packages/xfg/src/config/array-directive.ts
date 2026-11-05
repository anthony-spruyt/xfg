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

type DirectiveShape = Record<string, unknown> & {
  $arrayMerge: ArrayMergeStrategy;
  $values: unknown[];
};

function hasDirectiveShape(value: unknown): value is DirectiveShape {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => DIRECTIVE_KEYS.has(key)) &&
    isArrayMergeStrategy(value.$arrayMerge) &&
    Array.isArray(value.$values)
  );
}

/** The `$matchBy` of a merge directive when it is a usable name, else undefined. */
function matchByName(value: DirectiveShape): string | undefined {
  const matchBy = value.$matchBy;
  return value.$arrayMerge === "merge" &&
    typeof matchBy === "string" &&
    matchBy !== ""
    ? matchBy
    : undefined;
}

/** Accepts exactly what merge.ts resolves, so validation and merge agree. */
export function isArrayMergeDirective(
  value: unknown
): value is ArrayMergeDirective {
  if (!hasDirectiveShape(value)) return false;
  if (!("$matchBy" in value)) return true;

  const matchBy = matchByName(value);
  return (
    matchBy !== undefined &&
    keyedItemsProblem(value.$values, matchBy) === undefined
  );
}

/**
 * Adds to `message` why a directive that is otherwise well formed was refused,
 * so a `$matchBy` that cannot match its `$values` is not reported as "not a directive".
 */
export function explainNotArray(message: string, value: unknown): string {
  if (!hasDirectiveShape(value)) return message;
  const matchBy = matchByName(value);
  const problem =
    matchBy === undefined
      ? undefined
      : keyedItemsProblem(value.$values, matchBy);
  return problem === undefined ? message : `${message}: $values ${problem}`;
}

/** An array as it is, a valid directive's `$values`, or null for anything else. */
export function arrayValues(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (isArrayMergeDirective(value)) return value.$values;
  return null;
}
