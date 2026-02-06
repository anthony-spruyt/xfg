import { RULESET_COMPARABLE_FIELDS, type Ruleset } from "./config.js";
import type { GitHubRuleset } from "./strategies/github-ruleset-strategy.js";

// =============================================================================
// Types
// =============================================================================

export type RulesetAction = "create" | "update" | "delete" | "unchanged";

export interface RulesetChange {
  action: RulesetAction;
  name: string;
  rulesetId?: number;
  current?: GitHubRuleset;
  desired?: Ruleset;
}

// =============================================================================
// Normalization (for comparison)
// =============================================================================

/**
 * Converts camelCase to snake_case for comparison.
 */
function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase();
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
 * Normalizes a GitHub ruleset for comparison.
 */
function normalizeGitHubRuleset(
  ruleset: GitHubRuleset
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(ruleset)) {
    if (!RULESET_COMPARABLE_FIELDS.has(key) || value === undefined) {
      continue;
    }
    normalized[key] = normalizeValue(value);
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

  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(withDefaults)) {
    if (value === undefined) {
      continue;
    }
    const snakeKey = camelToSnake(key);
    normalized[snakeKey] = normalizeValue(value);
  }

  return normalized;
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

// =============================================================================
// Desired-Side Projection
// =============================================================================

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

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

function projectObjects(
  current: Record<string, unknown>,
  desired: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(desired)) {
    if (key in current) {
      result[key] = projectToDesiredShape(current[key], desired[key]);
    }
    // If key not in current, skip — diff will handle it as an addition
  }
  return result;
}

function projectArrays(current: unknown[], desired: unknown[]): unknown[] {
  // Primitive arrays — return current as-is
  if (desired.length === 0 || !isPlainObject(desired[0])) {
    return current;
  }

  // Arrays of objects — match by `type` field if available
  const hasType = desired.every(
    (item) => isPlainObject(item) && "type" in (item as Record<string, unknown>)
  );

  if (hasType) {
    return matchByType(current, desired);
  }

  // Fallback: match by index
  return matchByIndex(current, desired);
}

function matchByType(current: unknown[], desired: unknown[]): unknown[] {
  const currentByType = new Map<string, unknown>();
  for (const item of current) {
    if (isPlainObject(item)) {
      const type = (item as Record<string, unknown>).type as string;
      if (type) currentByType.set(type, item);
    }
  }

  const result: unknown[] = [];
  for (const desiredItem of desired) {
    const type = (desiredItem as Record<string, unknown>).type as string;
    const currentItem = currentByType.get(type);
    if (currentItem) {
      result.push(projectToDesiredShape(currentItem, desiredItem));
    }
    // If no match in current, skip — diff handles additions
  }
  return result;
}

function matchByIndex(current: unknown[], desired: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < Math.min(current.length, desired.length); i++) {
    result.push(projectToDesiredShape(current[i], desired[i]));
  }
  return result;
}

// =============================================================================
// Diff Algorithm
// =============================================================================

/**
 * Compares current rulesets (from GitHub) with desired rulesets (from config).
 *
 * @param current - Current rulesets from GitHub API
 * @param desired - Desired rulesets from config (name → ruleset)
 * @param managedNames - Names of rulesets managed by xfg (from manifest)
 * @returns Array of changes to apply
 */
export function diffRulesets(
  current: GitHubRuleset[],
  desired: Map<string, Ruleset>,
  managedNames: string[]
): RulesetChange[] {
  const changes: RulesetChange[] = [];
  const currentByName = new Map(current.map((r) => [r.name, r]));
  const managedSet = new Set(managedNames);

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
      const normalizedCurrent = normalizeGitHubRuleset(currentRuleset);
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

  // Check for orphaned rulesets (in manifest but not in desired config)
  for (const name of managedSet) {
    if (!desired.has(name)) {
      const currentRuleset = currentByName.get(name);
      if (currentRuleset) {
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

// =============================================================================
// Formatting
// =============================================================================

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
  const counts = {
    create: changes.filter((c) => c.action === "create").length,
    update: changes.filter((c) => c.action === "update").length,
    delete: changes.filter((c) => c.action === "delete").length,
    unchanged: changes.filter((c) => c.action === "unchanged").length,
  };

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
