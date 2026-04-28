import { RULESET_COMPARABLE_FIELDS, type Ruleset } from "../../config/index.js";
import { isPlainObject } from "../../shared/type-guards.js";
import { camelToSnake } from "../../shared/string-utils.js";
import { countActions, type SettingsAction } from "../base-processor.js";
import type { GitHubRuleset } from "./types.js";

export type RulesetAction = SettingsAction;

export interface RulesetChange {
  action: RulesetAction;
  name: string;
  rulesetId?: number;
  current?: GitHubRuleset;
  desired?: Ruleset;
}

/**
 * Normalizes a value recursively, converting keys to a consistent format (snake_case).
 * This allows comparing GitHub API responses (snake_case) with config (camelCase).
 */
function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const snakeKey = camelToSnake(key);
      normalized[snakeKey] = normalizeValue(val);
    }
    return normalized;
  }

  return value;
}

/**
 * Normalizes any ruleset object (GitHub API or config) for comparison.
 * Converts all keys to snake_case, filters to comparable fields only,
 * and recursively normalizes values.
 */
export function normalizeRuleset(
  obj: GitHubRuleset | Ruleset
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    const snakeKey = camelToSnake(key);
    if (!RULESET_COMPARABLE_FIELDS.has(snakeKey)) {
      continue;
    }
    // Preserve null explicitly — it means "API couldn't read this field"
    normalized[snakeKey] = value === null ? null : normalizeValue(value);
  }

  return normalized;
}

/**
 * Normalizes a config ruleset for comparison, applying default values.
 */
function normalizeConfigRuleset(ruleset: Ruleset): Record<string, unknown> {
  const withDefaults: Ruleset = {
    target: ruleset.target ?? "branch",
    enforcement: ruleset.enforcement ?? "active",
    ...ruleset,
  };

  return normalizeRuleset(withDefaults);
}

/**
 * Performs deep equality comparison of two normalized values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;

    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) {
      return false;
    }

    return keysA.every((key) => deepEqual(objA[key], objB[key]));
  }

  return false;
}

/**
 * Projects `current` onto the shape of `desired`.
 * Only keeps keys/structure present in `desired`, filtering out API noise.
 * For arrays of objects, matches items by `type` field if present, else by index.
 */
export function projectToDesiredShape(
  current: unknown,
  desired: unknown
): unknown {
  // Both must be same general type to project
  if (desired === null || desired === undefined) return desired;
  if (current === null || current === undefined) return current;

  // Arrays
  if (Array.isArray(desired) && Array.isArray(current)) {
    return projectArrays(current, desired);
  }

  // Objects
  if (isPlainObject(desired) && isPlainObject(current)) {
    return projectObjects(
      current as Record<string, unknown>,
      desired as Record<string, unknown>
    );
  }

  // Scalars — return current as-is
  return current;
}

function projectObjects(
  current: Record<string, unknown>,
  desired: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(desired)) {
    if (key in current) {
      if (current[key] === null) {
        // null means "API token can't read this field" — assume it matches desired
        result[key] = desired[key];
      } else {
        result[key] = projectToDesiredShape(current[key], desired[key]);
      }
    } else if (
      Array.isArray(desired[key]) &&
      (desired[key] as unknown[]).length === 0
    ) {
      // API returns null for empty arrays (normalized to absent key).
      // Config uses explicit empty array []. Both mean "none" — match them.
      result[key] = [];
    }
    // If key not in current, skip — diff will handle it as an addition
  }
  return result;
}

/**
 * Candidate keys for matching array items by identity rather than index.
 * Order matters — first key found across all items wins.
 */
const MATCH_KEY_CANDIDATES = ["type", "actor_id"] as const;

/**
 * Finds a key that uniquely identifies items in both arrays.
 * Returns the first candidate key present in every item of both arrays, or undefined.
 */
function findMatchKey(
  current: unknown[],
  desired: unknown[]
): string | undefined {
  const allItems = [...current, ...desired];
  if (allItems.length === 0) return undefined;

  for (const candidate of MATCH_KEY_CANDIDATES) {
    const everyItemHasKey = allItems.every(
      (item) =>
        isPlainObject(item) && candidate in (item as Record<string, unknown>)
    );
    if (everyItemHasKey) return candidate;
  }

  return undefined;
}

function projectArrays(current: unknown[], desired: unknown[]): unknown[] {
  // Primitive arrays — return current as-is
  if (desired.length === 0 || !isPlainObject(desired[0])) {
    return current;
  }

  // Arrays of objects — match by identifying key if available
  const matchKey = findMatchKey(current, desired);

  if (matchKey) {
    return matchByKey(current, desired, matchKey);
  }

  // Fallback: match by index
  return matchByIndex(current, desired);
}

function matchByKey(
  current: unknown[],
  desired: unknown[],
  key: string
): unknown[] {
  const currentByKey = new Map<unknown, unknown>();
  for (const item of current) {
    if (isPlainObject(item)) {
      const keyValue = (item as Record<string, unknown>)[key];
      if (keyValue !== undefined) currentByKey.set(keyValue, item);
    }
  }

  const desiredKeys = new Set<unknown>();
  const result: unknown[] = [];
  for (const desiredItem of desired) {
    const keyValue = (desiredItem as Record<string, unknown>)[key];
    desiredKeys.add(keyValue);
    const currentItem = currentByKey.get(keyValue);
    if (currentItem) {
      result.push(projectToDesiredShape(currentItem, desiredItem));
    }
    // If no match in current, skip — diff handles additions
  }

  // Append current items not in desired — these are removals that
  // deepEqual must detect (length mismatch). Fixes #549.
  for (const item of current) {
    if (isPlainObject(item)) {
      const keyValue = (item as Record<string, unknown>)[key];
      if (keyValue !== undefined && !desiredKeys.has(keyValue)) {
        result.push(item);
      }
    }
  }

  return result;
}

function matchByIndex(current: unknown[], desired: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < Math.min(current.length, desired.length); i++) {
    result.push(projectToDesiredShape(current[i], desired[i]));
  }
  // Append extra current items so deepEqual detects length mismatch (removals).
  // Mirrors matchByKey behavior added for #549.
  for (let i = desired.length; i < current.length; i++) {
    result.push(current[i]);
  }
  return result;
}

/**
 * Compares current rulesets (from GitHub) with desired rulesets (from config).
 *
 * @param current - Current rulesets from GitHub API
 * @param desired - Desired rulesets from config (name → ruleset)
 * @param deleteOrphaned - When true, delete ALL current rulesets not in desired (desired-state model)
 * @returns Array of changes to apply
 */
export function diffRulesets(
  current: GitHubRuleset[],
  desired: Map<string, Ruleset>,
  deleteOrphaned: boolean
): RulesetChange[] {
  const changes: RulesetChange[] = [];
  const currentByName = new Map(current.map((r) => [r.name, r]));

  // Check each desired ruleset
  for (const [name, desiredRuleset] of desired) {
    const currentRuleset = currentByName.get(name);

    if (!currentRuleset) {
      // New ruleset to create
      changes.push({
        action: "create",
        name,
        desired: desiredRuleset,
      });
    } else {
      // Existing ruleset - check if changed
      const normalizedCurrent = normalizeRuleset(currentRuleset);
      const normalizedDesired = normalizeConfigRuleset(desiredRuleset);
      const projectedCurrent = projectToDesiredShape(
        normalizedCurrent,
        normalizedDesired
      ) as Record<string, unknown>;

      if (deepEqual(projectedCurrent, normalizedDesired)) {
        changes.push({
          action: "unchanged",
          name,
          rulesetId: currentRuleset.id,
          current: currentRuleset,
          desired: desiredRuleset,
        });
      } else {
        changes.push({
          action: "update",
          name,
          rulesetId: currentRuleset.id,
          current: currentRuleset,
          desired: desiredRuleset,
        });
      }
    }
  }

  // Desired-state: delete ALL current rulesets not in desired when deleteOrphaned is true
  if (deleteOrphaned) {
    for (const [name, currentRuleset] of currentByName) {
      if (!desired.has(name)) {
        changes.push({
          action: "delete",
          name,
          rulesetId: currentRuleset.id,
          current: currentRuleset,
        });
      }
    }
  }

  // Sort: delete first, then update, then create, then unchanged
  const actionOrder: Record<RulesetAction, number> = {
    delete: 0,
    update: 1,
    create: 2,
    unchanged: 3,
  };

  return changes.sort((a, b) => actionOrder[a.action] - actionOrder[b.action]);
}

/**
 * Formats a ruleset change for display.
 */
function formatChange(change: RulesetChange): string {
  const actionLabels: Record<RulesetAction, string> = {
    create: "  CREATE",
    update: "  UPDATE",
    delete: "  DELETE",
    unchanged: "  UNCHANGED",
  };

  const actionColors: Record<RulesetAction, string> = {
    create: "+",
    update: "~",
    delete: "-",
    unchanged: " ",
  };

  const prefix = actionColors[change.action];
  const label = actionLabels[change.action];

  return `${prefix} ${label}: ${change.name}`;
}

/**
 * Formats diff output for display (dry-run mode).
 *
 * @param changes - Array of ruleset changes
 * @returns Human-readable diff output
 */
export function formatDiff(changes: RulesetChange[]): string {
  if (changes.length === 0) {
    return "No ruleset changes detected.";
  }

  const lines: string[] = [];
  lines.push("Ruleset Changes:");
  lines.push("");

  for (const change of changes) {
    lines.push(formatChange(change));
  }

  // Summary
  const counts = countActions(changes);

  lines.push("");
  lines.push("Summary:");
  const parts: string[] = [];
  if (counts.create > 0) parts.push(`${counts.create} to create`);
  if (counts.update > 0) parts.push(`${counts.update} to update`);
  if (counts.delete > 0) parts.push(`${counts.delete} to delete`);
  if (counts.unchanged > 0) parts.push(`${counts.unchanged} unchanged`);
  lines.push("  " + parts.join(", "));

  return lines.join("\n");
}
