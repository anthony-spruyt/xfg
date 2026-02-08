// src/ruleset-plan-formatter.ts
import chalk from "chalk";
import {
  projectToDesiredShape,
  normalizeRuleset,
  type RulesetChange,
  type RulesetAction,
} from "./ruleset-diff.js";
import type { Ruleset } from "./config.js";

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

function isArrayOfObjects(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every((item) => isObject(item));
}

/**
 * Diff two arrays of objects by matching items on `type` field (or by index).
 */
function diffObjectArrays(
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
 * Format a value for inline display (scalars and simple arrays only).
 */
function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (Array.isArray(val)) {
    if (val.every((v) => typeof v !== "object" || v === null)) {
      return `[${val.map(formatValue).join(", ")}]`;
    }
    // Arrays of objects are rendered by renderNestedValue
    return `[${val.length} items]`;
  }
  if (typeof val === "object") {
    // Objects are rendered by renderNestedValue
    return `{${Object.keys(val).length} properties}`;
  }
  return String(val);
}

/**
 * Render a nested value (object or array) as indented tree lines.
 */
function renderNestedValue(
  val: unknown,
  action: DiffAction,
  indent: number
): string[] {
  const lines: string[] = [];
  const style = getActionStyle(action);
  const indentStr = "    ".repeat(indent);

  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      const item = val[i];
      if (isObject(item)) {
        const obj = item as Record<string, unknown>;
        const typeLabel = "type" in obj ? ` (${obj.type})` : "";
        lines.push(
          style.color(`${indentStr}${style.symbol} [${i}]${typeLabel}:`)
        );
        lines.push(...renderNestedObject(obj, action, indent + 1));
      } else {
        lines.push(
          style.color(
            `${indentStr}${style.symbol} [${i}]: ${formatValue(item)}`
          )
        );
      }
    }
  } else if (isObject(val)) {
    lines.push(
      ...renderNestedObject(val as Record<string, unknown>, action, indent)
    );
  }

  return lines;
}

function renderNestedObject(
  obj: Record<string, unknown>,
  action: DiffAction,
  indent: number
): string[] {
  const lines: string[] = [];
  const style = getActionStyle(action);
  const indentStr = "    ".repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value) && value.some((v) => isObject(v))) {
      lines.push(style.color(`${indentStr}${style.symbol} ${key}:`));
      lines.push(...renderNestedValue(value, action, indent + 1));
    } else if (isObject(value)) {
      lines.push(style.color(`${indentStr}${style.symbol} ${key}:`));
      lines.push(
        ...renderNestedObject(
          value as Record<string, unknown>,
          action,
          indent + 1
        )
      );
    } else {
      lines.push(
        style.color(`${indentStr}${style.symbol} ${key}: ${formatValue(value)}`)
      );
    }
  }

  return lines;
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
      const hasComplexNew =
        isObject(child.newValue) ||
        (Array.isArray(child.newValue) &&
          child.newValue.some((v) => isObject(v)));
      const hasComplexOld =
        isObject(child.oldValue) ||
        (Array.isArray(child.oldValue) &&
          (child.oldValue as unknown[]).some((v) => isObject(v)));

      if (child.action === "add" && hasComplexNew) {
        lines.push(style.color(`${indentStr}${style.symbol} ${child.name}:`));
        lines.push(
          ...renderNestedValue(child.newValue, child.action, indent + 1)
        );
      } else if (child.action === "remove" && hasComplexOld) {
        lines.push(
          style.color(`${indentStr}${style.symbol} ${child.name} (removed):`)
        );
        lines.push(
          ...renderNestedValue(child.oldValue, child.action, indent + 1)
        );
      } else if (
        child.action === "change" &&
        (hasComplexNew || hasComplexOld)
      ) {
        lines.push(style.color(`${indentStr}${style.symbol} ${child.name}:`));
        if (hasComplexOld) {
          lines.push(
            ...renderNestedValue(child.oldValue, "remove", indent + 1)
          );
        }
        if (hasComplexNew) {
          lines.push(...renderNestedValue(child.newValue, "add", indent + 1));
        }
      } else {
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
            lines.push(style.color(`${pad}    + ${JSON.stringify(item)}`));
          } else {
            lines.push(style.color(`${pad}    + ${formatValue(item)}`));
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
        const currentNorm = normalizeRuleset(change.current);
        const desiredNorm = normalizeRuleset(change.desired);
        const projectedCurrent = projectToDesiredShape(
          currentNorm,
          desiredNorm
        ) as Record<string, unknown>;
        const diffs = computePropertyDiffs(projectedCurrent, desiredNorm);
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
