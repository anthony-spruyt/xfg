import type { Ruleset } from "./config.js";
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
 * Fields to ignore when comparing rulesets (API-only metadata).
 * The "name" field is compared via map key, not content.
 */
const IGNORE_FIELDS = new Set(["id", "name", "source_type", "source"]);

/**
 * Normalizes a GitHub ruleset for comparison.
 */
function normalizeGitHubRuleset(
  ruleset: GitHubRuleset
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(ruleset)) {
    if (IGNORE_FIELDS.has(key) || value === undefined) {
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

      if (deepEqual(normalizedCurrent, normalizedDesired)) {
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
