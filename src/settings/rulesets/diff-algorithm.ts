// src/settings/rulesets/diff-algorithm.ts

// =============================================================================
// Types
// =============================================================================

export type DiffAction = "add" | "change" | "remove";

export interface PropertyDiff {
  path: string[];
  action: DiffAction;
  oldValue?: unknown;
  newValue?: unknown;
}

// =============================================================================
// Helpers
// =============================================================================

export function isObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined)
    return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }

  return false;
}

export function isArrayOfObjects(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every((item) => isObject(item));
}

// =============================================================================
// Property Diff Algorithm
// =============================================================================

/**
 * Recursively compute property-level diffs between two objects.
 */
export function computePropertyDiffs(
  current: Record<string, unknown>,
  desired: Record<string, unknown>,
  parentPath: string[] = []
): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];
  const allKeys = new Set([...Object.keys(current), ...Object.keys(desired)]);

  for (const key of allKeys) {
    const path = [...parentPath, key];
    const currentVal = current[key];
    const desiredVal = desired[key];

    if (!(key in current)) {
      // Added property
      diffs.push({ path, action: "add", newValue: desiredVal });
    } else if (!(key in desired)) {
      // Removed property
      diffs.push({ path, action: "remove", oldValue: currentVal });
    } else if (!deepEqual(currentVal, desiredVal)) {
      // Changed property
      if (isObject(currentVal) && isObject(desiredVal)) {
        // Recurse into nested objects
        diffs.push(
          ...computePropertyDiffs(
            currentVal as Record<string, unknown>,
            desiredVal as Record<string, unknown>,
            path
          )
        );
      } else if (
        Array.isArray(currentVal) &&
        Array.isArray(desiredVal) &&
        isArrayOfObjects(currentVal) &&
        isArrayOfObjects(desiredVal)
      ) {
        // Recurse into arrays of objects
        diffs.push(...diffObjectArrays(currentVal, desiredVal, path));
      } else {
        diffs.push({
          path,
          action: "change",
          oldValue: currentVal,
          newValue: desiredVal,
        });
      }
    }
    // Unchanged properties are not included
  }

  return diffs;
}

// =============================================================================
// Array Diffing
// =============================================================================

/**
 * Diff two arrays of objects by matching items on `type` field (or by index).
 */
export function diffObjectArrays(
  currentArr: unknown[],
  desiredArr: unknown[],
  parentPath: string[]
): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];

  const hasType = desiredArr.every(
    (item) => isObject(item) && "type" in (item as Record<string, unknown>)
  );

  if (hasType) {
    // Match by type field
    const currentByType = new Map<
      string,
      { item: Record<string, unknown>; index: number }
    >();
    for (let i = 0; i < currentArr.length; i++) {
      const item = currentArr[i] as Record<string, unknown>;
      const type = item.type as string;
      if (type) currentByType.set(type, { item, index: i });
    }

    const matchedTypes = new Set<string>();

    for (let i = 0; i < desiredArr.length; i++) {
      const desiredItem = desiredArr[i] as Record<string, unknown>;
      const type = desiredItem.type as string;
      const label = `[${i}] (${type})`;
      const currentEntry = currentByType.get(type);

      if (currentEntry) {
        matchedTypes.add(type);
        // Recurse into matched pair
        const itemDiffs = computePropertyDiffs(currentEntry.item, desiredItem, [
          ...parentPath,
          label,
        ]);
        diffs.push(...itemDiffs);
      } else {
        // New item in desired
        diffs.push({
          path: [...parentPath, label],
          action: "add",
          newValue: desiredItem,
        });
      }
    }

    // Items in current but not in desired
    for (const [type, entry] of currentByType) {
      if (!matchedTypes.has(type)) {
        diffs.push({
          path: [...parentPath, `[${entry.index}] (${type})`],
          action: "remove",
          oldValue: entry.item,
        });
      }
    }
  } else {
    // Fallback: match by index
    const maxLen = Math.max(currentArr.length, desiredArr.length);
    for (let i = 0; i < maxLen; i++) {
      const label = `[${i}]`;
      if (i >= currentArr.length) {
        diffs.push({
          path: [...parentPath, label],
          action: "add",
          newValue: desiredArr[i],
        });
      } else if (i >= desiredArr.length) {
        diffs.push({
          path: [...parentPath, label],
          action: "remove",
          oldValue: currentArr[i],
        });
      } else if (isObject(currentArr[i]) && isObject(desiredArr[i])) {
        const itemDiffs = computePropertyDiffs(
          currentArr[i] as Record<string, unknown>,
          desiredArr[i] as Record<string, unknown>,
          [...parentPath, label]
        );
        diffs.push(...itemDiffs);
      } else if (!deepEqual(currentArr[i], desiredArr[i])) {
        diffs.push({
          path: [...parentPath, label],
          action: "change",
          oldValue: currentArr[i],
          newValue: desiredArr[i],
        });
      }
    }
  }

  return diffs;
}
