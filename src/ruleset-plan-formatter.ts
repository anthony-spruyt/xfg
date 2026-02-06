// src/ruleset-plan-formatter.ts
import chalk from "chalk";
import type { RulesetChange, RulesetAction } from "./ruleset-diff.js";
import { RULESET_COMPARABLE_FIELDS, type Ruleset } from "./config.js";

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

export interface RulesetPlanEntry {
  name: string;
  action: RulesetAction;
  propertyCount?: number;
  propertyChanges?: {
    added: number;
    changed: number;
    removed: number;
  };
}

export interface RulesetPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  entries: RulesetPlanEntry[];
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
// Helpers
// =============================================================================

function isObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

function deepEqual(a: unknown, b: unknown): boolean {
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

// =============================================================================
// Tree Formatting
// =============================================================================

interface TreeNode {
  name: string;
  action?: DiffAction;
  oldValue?: unknown;
  newValue?: unknown;
  children: Map<string, TreeNode>;
}

/**
 * Build a tree structure from flat property diffs.
 */
function buildTree(diffs: PropertyDiff[]): TreeNode {
  const root: TreeNode = { name: "", children: new Map() };

  for (const diff of diffs) {
    let current = root;

    for (let i = 0; i < diff.path.length; i++) {
      const segment = diff.path[i];
      const isLast = i === diff.path.length - 1;

      if (!current.children.has(segment)) {
        current.children.set(segment, {
          name: segment,
          children: new Map(),
        });
      }

      const child = current.children.get(segment)!;

      if (isLast) {
        child.action = diff.action;
        child.oldValue = diff.oldValue;
        child.newValue = diff.newValue;
      } else {
        // Intermediate node - mark as change if any child changes
        if (!child.action) {
          child.action = "change";
        }
      }

      current = child;
    }
  }

  return root;
}

/**
 * Format a value for display.
 */
function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (Array.isArray(val)) {
    if (val.length <= 3) {
      return `[${val.map(formatValue).join(", ")}]`;
    }
    return `[${val.slice(0, 3).map(formatValue).join(", ")}, ... (${val.length - 3} more)]`;
  }
  if (typeof val === "object") {
    return "{...}";
  }
  return String(val);
}

/**
 * Get the symbol and color for an action.
 */
function getActionStyle(action: DiffAction): {
  symbol: string;
  color: (s: string) => string;
} {
  switch (action) {
    case "add":
      return { symbol: "+", color: chalk.green };
    case "remove":
      return { symbol: "-", color: chalk.red };
    case "change":
      return { symbol: "~", color: chalk.yellow };
  }
}

/**
 * Recursively render tree nodes to formatted lines.
 */
function renderTree(node: TreeNode, indent: number = 0): string[] {
  const lines: string[] = [];
  const indentStr = "    ".repeat(indent);

  for (const [, child] of node.children) {
    const style = child.action
      ? getActionStyle(child.action)
      : { symbol: " ", color: chalk.gray };
    const hasChildren = child.children.size > 0;

    if (hasChildren) {
      // Intermediate node
      lines.push(style.color(`${indentStr}${style.symbol} ${child.name}:`));
      lines.push(...renderTree(child, indent + 1));
    } else {
      // Leaf node with value
      let valuePart = "";
      if (child.action === "change") {
        valuePart = `: ${formatValue(child.oldValue)} → ${formatValue(child.newValue)}`;
      } else if (child.action === "add") {
        valuePart = `: ${formatValue(child.newValue)}`;
      } else if (child.action === "remove") {
        valuePart = ` (was: ${formatValue(child.oldValue)})`;
      }
      lines.push(
        style.color(`${indentStr}${style.symbol} ${child.name}${valuePart}`)
      );
    }
  }

  return lines;
}

/**
 * Format property diffs as an indented tree structure.
 */
export function formatPropertyTree(diffs: PropertyDiff[]): string[] {
  if (diffs.length === 0) {
    return [];
  }

  const tree = buildTree(diffs);
  return renderTree(tree);
}

// =============================================================================
// Ruleset Plan Formatter
// =============================================================================

/**
 * Normalize a GitHubRuleset or Ruleset for comparison.
 * Converts to snake_case and removes metadata fields.
 */
function normalizeForDiff(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Convert camelCase to snake_case for consistency
    const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
    if (!RULESET_COMPARABLE_FIELDS.has(snakeKey) || value === undefined)
      continue;
    result[snakeKey] = normalizeNestedValue(value);
  }

  return result;
}

function normalizeNestedValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(normalizeNestedValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
      result[snakeKey] = normalizeNestedValue(val);
    }
    return result;
  }
  return value;
}

/**
 * Format a full ruleset config as tree lines (for create action).
 */
function formatFullConfig(ruleset: Ruleset, indent: number = 2): string[] {
  const lines: string[] = [];
  const style = getActionStyle("add");

  function renderValue(
    key: string,
    value: unknown,
    currentIndent: number
  ): void {
    const pad = "    ".repeat(currentIndent);
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(style.color(`${pad}+ ${key}: []`));
      } else if (value.every((v) => typeof v !== "object")) {
        lines.push(style.color(`${pad}+ ${key}: ${formatValue(value)}`));
      } else {
        lines.push(style.color(`${pad}+ ${key}:`));
        for (const item of value) {
          if (typeof item === "object" && item !== null) {
            lines.push(style.color(`${pad}    - ${JSON.stringify(item)}`));
          } else {
            lines.push(style.color(`${pad}    - ${formatValue(item)}`));
          }
        }
      }
    } else if (typeof value === "object") {
      lines.push(style.color(`${pad}+ ${key}:`));
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        renderValue(k, v, currentIndent + 1);
      }
    } else {
      lines.push(style.color(`${pad}+ ${key}: ${formatValue(value)}`));
    }
  }

  for (const [key, value] of Object.entries(ruleset)) {
    renderValue(key, value, indent);
  }

  return lines;
}

/**
 * Format ruleset changes as a Terraform-style plan.
 */
export function formatRulesetPlan(changes: RulesetChange[]): RulesetPlanResult {
  const lines: string[] = [];
  let creates = 0;
  let updates = 0;
  let deletes = 0;
  let unchanged = 0;
  const entries: RulesetPlanEntry[] = [];

  // Group by action type
  const createChanges = changes.filter((c) => c.action === "create");
  const updateChanges = changes.filter((c) => c.action === "update");
  const deleteChanges = changes.filter((c) => c.action === "delete");
  const unchangedChanges = changes.filter((c) => c.action === "unchanged");

  creates = createChanges.length;
  updates = updateChanges.length;
  deletes = deleteChanges.length;
  unchanged = unchangedChanges.length;

  // Format creates
  if (createChanges.length > 0) {
    lines.push(chalk.bold("  Create:"));
    for (const change of createChanges) {
      lines.push(chalk.green(`    + ruleset "${change.name}"`));
      if (change.desired) {
        lines.push(...formatFullConfig(change.desired, 2));
      }
      const propertyCount = change.desired
        ? Object.keys(change.desired).length
        : 0;
      entries.push({ name: change.name, action: "create", propertyCount });
      lines.push(""); // Blank line between rulesets
    }
  }

  // Format updates
  if (updateChanges.length > 0) {
    lines.push(chalk.bold("  Update:"));
    for (const change of updateChanges) {
      lines.push(chalk.yellow(`    ~ ruleset "${change.name}"`));
      if (change.current && change.desired) {
        const currentNorm = normalizeForDiff(
          change.current as unknown as Record<string, unknown>
        );
        const desiredNorm = normalizeForDiff(
          change.desired as unknown as Record<string, unknown>
        );
        const diffs = computePropertyDiffs(currentNorm, desiredNorm);
        const treeLines = formatPropertyTree(diffs);
        for (const line of treeLines) {
          lines.push(`        ${line}`);
        }

        const added = diffs.filter((d) => d.action === "add").length;
        const changed = diffs.filter((d) => d.action === "change").length;
        const removed = diffs.filter((d) => d.action === "remove").length;
        entries.push({
          name: change.name,
          action: "update",
          propertyChanges: { added, changed, removed },
        });
      } else {
        entries.push({ name: change.name, action: "update" });
      }
      lines.push(""); // Blank line between rulesets
    }
  }

  // Format deletes
  if (deleteChanges.length > 0) {
    lines.push(chalk.bold("  Delete:"));
    for (const change of deleteChanges) {
      lines.push(chalk.red(`    - ruleset "${change.name}"`));
      entries.push({ name: change.name, action: "delete" });
    }
    lines.push(""); // Blank line after deletes
  }

  for (const change of unchangedChanges) {
    entries.push({ name: change.name, action: "unchanged" });
  }

  return { lines, creates, updates, deletes, unchanged, entries };
}
