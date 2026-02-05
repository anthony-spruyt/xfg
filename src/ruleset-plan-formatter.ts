// src/ruleset-plan-formatter.ts
import chalk from "chalk";

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
