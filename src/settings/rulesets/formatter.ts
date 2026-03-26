import chalk from "chalk";
import {
  projectToDesiredShape,
  normalizeRuleset,
  type RulesetChange,
  type RulesetAction,
} from "./diff.js";
import type { Ruleset } from "../../config/index.js";
import { formatScalarValue } from "../../shared/string-utils.js";
import {
  computePropertyDiffs,
  type DiffAction,
  type PropertyDiff,
} from "./diff-algorithm.js";
import { isPlainObject } from "../../shared/type-guards.js";

export interface RulesetPlanEntry {
  name: string;
  action: RulesetAction;
  propertyCount?: number;
  propertyChanges?: {
    added: number;
    changed: number;
    removed: number;
  };
  propertyDiffs?: PropertyDiff[];
  config?: Ruleset;
}

export interface RulesetPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  entries: RulesetPlanEntry[];
}

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
  const scalar = formatScalarValue(val);
  if (scalar !== undefined) return scalar;
  if (Array.isArray(val)) {
    if (val.every((v) => typeof v !== "object" || v === null)) {
      return `[${val.map(formatValue).join(", ")}]`;
    }
    // Arrays of objects are rendered by renderNestedValue
    return `[${val.length} items]`;
  }
  if (typeof val === "object") {
    // Objects are rendered by renderNestedValue
    return `{${Object.keys(val as object).length} properties}`;
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
      if (isPlainObject(item)) {
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
  } else if (isPlainObject(val)) {
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

    if (Array.isArray(value) && value.some((v) => isPlainObject(v))) {
      lines.push(style.color(`${indentStr}${style.symbol} ${key}:`));
      lines.push(...renderNestedValue(value, action, indent + 1));
    } else if (isPlainObject(value)) {
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
 * Render a leaf tree node (no children) with its value.
 */
function hasComplexValue(value: unknown): boolean {
  return (
    isPlainObject(value) ||
    (Array.isArray(value) && value.some((v) => isPlainObject(v)))
  );
}

function renderComplexLeaf(
  child: TreeNode,
  style: { symbol: string; color: (s: string) => string },
  indentStr: string,
  indent: number
): string[] {
  const lines: string[] = [];
  if (child.action === "add") {
    lines.push(style.color(`${indentStr}${style.symbol} ${child.name}:`));
    lines.push(...renderNestedValue(child.newValue, child.action, indent + 1));
  } else if (child.action === "remove") {
    lines.push(
      style.color(`${indentStr}${style.symbol} ${child.name} (removed):`)
    );
    lines.push(...renderNestedValue(child.oldValue, child.action, indent + 1));
  } else {
    lines.push(style.color(`${indentStr}${style.symbol} ${child.name}:`));
    if (hasComplexValue(child.oldValue)) {
      lines.push(...renderNestedValue(child.oldValue, "remove", indent + 1));
    }
    if (hasComplexValue(child.newValue)) {
      lines.push(...renderNestedValue(child.newValue, "add", indent + 1));
    }
  }
  return lines;
}

function renderSimpleLeaf(
  child: TreeNode,
  style: { symbol: string; color: (s: string) => string },
  indentStr: string
): string {
  let valuePart = "";
  if (child.action === "change") {
    valuePart = `: ${formatValue(child.oldValue)} → ${formatValue(child.newValue)}`;
  } else if (child.action === "add") {
    valuePart = `: ${formatValue(child.newValue)}`;
  } else if (child.action === "remove") {
    valuePart = ` (was: ${formatValue(child.oldValue)})`;
  }
  return style.color(`${indentStr}${style.symbol} ${child.name}${valuePart}`);
}

function renderLeafNode(
  child: TreeNode,
  style: { symbol: string; color: (s: string) => string },
  indentStr: string,
  indent: number
): string[] {
  const isComplex =
    (child.action !== "remove" && hasComplexValue(child.newValue)) ||
    (child.action !== "add" && hasComplexValue(child.oldValue));

  if (isComplex) {
    return renderComplexLeaf(child, style, indentStr, indent);
  }
  return [renderSimpleLeaf(child, style, indentStr)];
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
      lines.push(...renderLeafNode(child, style, indentStr, indent));
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

/**
 * Format a full ruleset config as tree lines (for create action).
 * Delegates to renderNestedObject which handles recursive rendering.
 */
function formatFullConfig(ruleset: Ruleset, indent: number = 2): string[] {
  // Object.entries works on any object; the cast avoids a double assertion
  const entries = Object.entries(ruleset) as [string, unknown][];
  return renderNestedObject(Object.fromEntries(entries), "add", indent);
}

/**
 * Format ruleset changes as a Terraform-style plan.
 */
export function formatRulesetPlan(changes: RulesetChange[]): RulesetPlanResult {
  const lines: string[] = [];
  const entries: RulesetPlanEntry[] = [];

  // Group by action in a single pass
  const grouped: Record<RulesetAction, RulesetChange[]> = {
    create: [],
    update: [],
    delete: [],
    unchanged: [],
  };
  for (const c of changes) {
    grouped[c.action].push(c);
  }

  if (grouped.create.length > 0) {
    lines.push(chalk.bold("  Create:"));
  }
  for (const change of grouped.create) {
    lines.push(chalk.green(`    + ruleset "${change.name}"`));
    if (change.desired) {
      lines.push(...formatFullConfig(change.desired, 2));
    }
    const propertyCount = change.desired
      ? Object.keys(change.desired).length
      : 0;
    entries.push({
      name: change.name,
      action: "create",
      propertyCount,
      config: change.desired,
    });
    lines.push("");
  }

  if (grouped.update.length > 0) {
    lines.push(chalk.bold("  Update:"));
  }
  for (const change of grouped.update) {
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
        propertyDiffs: diffs,
      });
    } else {
      entries.push({ name: change.name, action: "update" });
    }
    lines.push("");
  }

  if (grouped.delete.length > 0) {
    lines.push(chalk.bold("  Delete:"));
    for (const change of grouped.delete) {
      lines.push(chalk.red(`    - ruleset "${change.name}"`));
      entries.push({ name: change.name, action: "delete" });
    }
    lines.push("");
  }

  for (const change of grouped.unchanged) {
    entries.push({ name: change.name, action: "unchanged" });
  }

  return {
    lines,
    creates: grouped.create.length,
    updates: grouped.update.length,
    deletes: grouped.delete.length,
    unchanged: grouped.unchanged.length,
    entries,
  };
}
