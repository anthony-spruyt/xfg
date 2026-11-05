import { isPlainObject } from "../shared/type-guards.js";

function isPrimitiveItem(item: unknown): boolean {
  return (
    typeof item === "string" ||
    typeof item === "number" ||
    typeof item === "boolean"
  );
}

/** First repeat wins; arrays holding objects are left alone, since lookalike objects can differ. */
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
