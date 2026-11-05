import { isPlainObject } from "../shared/type-guards.js";

function isPrimitiveItem(item: unknown): boolean {
  return (
    typeof item === "string" ||
    typeof item === "number" ||
    typeof item === "boolean"
  );
}

/**
 * Drops repeated items from every array in the tree, first one wins. Only arrays
 * of strings, numbers and booleans are touched; an array holding anything else
 * keeps its items, because objects that look alike can still differ.
 */
export function dropRepeatedItems<T>(value: T): T {
  if (Array.isArray(value)) {
    const items: unknown[] = value.every(isPrimitiveItem)
      ? [...new Set(value)]
      : value.map(dropRepeatedItems);
    return items as T;
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, dropRepeatedItems(item)])
    ) as T;
  }
  return value;
}
