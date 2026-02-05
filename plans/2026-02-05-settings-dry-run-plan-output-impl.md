# Settings Dry-Run Plan Output Implementation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Terraform-style plan output to the settings command dry-run mode, showing property-level diffs for updates, full configs for creates, and names for deletes.

**Architecture:** Create a new `ruleset-plan-formatter.ts` module that recursively compares `current` vs `desired` rulesets and generates a tree-structured diff. Integrate it into `ruleset-processor.ts` for dry-run mode. Add a new `rulesetPlan()` method to `Logger`.

**Tech Stack:** TypeScript, chalk for colors, node:test for testing

---

## Task 1: Create Property Diff Types and Core Algorithm

**Files:**

- Create: `src/ruleset-plan-formatter.ts`
- Test: `test/unit/ruleset-plan-formatter.test.ts`

**Step 1: Write the failing test for PropertyDiff type and computePropertyDiffs function**

```typescript
// test/unit/ruleset-plan-formatter.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  computePropertyDiffs,
  PropertyDiff,
} from "../../src/ruleset-plan-formatter.js";

describe("computePropertyDiffs", () => {
  describe("scalar changes", () => {
    test("detects changed scalar value", () => {
      const current = { enforcement: "disabled" };
      const desired = { enforcement: "active" };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0], {
        path: ["enforcement"],
        action: "change",
        oldValue: "disabled",
        newValue: "active",
      });
    });

    test("detects added scalar property", () => {
      const current = {};
      const desired = { enforcement: "active" };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0], {
        path: ["enforcement"],
        action: "add",
        newValue: "active",
      });
    });

    test("detects removed scalar property", () => {
      const current = { enforcement: "active" };
      const desired = {};

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0], {
        path: ["enforcement"],
        action: "remove",
        oldValue: "active",
      });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "computePropertyDiffs"`
Expected: FAIL with "computePropertyDiffs is not a function" or module not found

**Step 3: Write minimal implementation**

```typescript
// src/ruleset-plan-formatter.ts

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
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "computePropertyDiffs"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ruleset-plan-formatter.ts test/unit/ruleset-plan-formatter.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): add property diff algorithm for plan output

Introduces computePropertyDiffs() that recursively compares two objects
and returns a list of property-level changes (add/change/remove) with
full paths. Foundation for Terraform-style dry-run output.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Nested Object and Array Diff Support

**Files:**

- Modify: `src/ruleset-plan-formatter.ts`
- Modify: `test/unit/ruleset-plan-formatter.test.ts`

**Step 1: Write failing tests for nested objects and arrays**

```typescript
// Add to test/unit/ruleset-plan-formatter.test.ts

describe("nested objects", () => {
  test("detects changes in nested properties", () => {
    const current = {
      rules: {
        pull_request: {
          required_approving_review_count: 1,
        },
      },
    };
    const desired = {
      rules: {
        pull_request: {
          required_approving_review_count: 2,
        },
      },
    };

    const diffs = computePropertyDiffs(current, desired);

    assert.equal(diffs.length, 1);
    assert.deepEqual(diffs[0].path, [
      "rules",
      "pull_request",
      "required_approving_review_count",
    ]);
    assert.equal(diffs[0].action, "change");
    assert.equal(diffs[0].oldValue, 1);
    assert.equal(diffs[0].newValue, 2);
  });

  test("detects added nested property", () => {
    const current = {
      rules: {
        pull_request: {
          required_approving_review_count: 1,
        },
      },
    };
    const desired = {
      rules: {
        pull_request: {
          required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: true,
        },
      },
    };

    const diffs = computePropertyDiffs(current, desired);

    assert.equal(diffs.length, 1);
    assert.deepEqual(diffs[0].path, [
      "rules",
      "pull_request",
      "dismiss_stale_reviews_on_push",
    ]);
    assert.equal(diffs[0].action, "add");
  });
});

describe("arrays", () => {
  test("detects changed array", () => {
    const current = {
      conditions: {
        ref_name: {
          include: ["~DEFAULT_BRANCH"],
        },
      },
    };
    const desired = {
      conditions: {
        ref_name: {
          include: ["~DEFAULT_BRANCH", "release/*"],
        },
      },
    };

    const diffs = computePropertyDiffs(current, desired);

    assert.equal(diffs.length, 1);
    assert.deepEqual(diffs[0].path, ["conditions", "ref_name", "include"]);
    assert.equal(diffs[0].action, "change");
  });

  test("treats identical arrays as unchanged", () => {
    const current = {
      conditions: { ref_name: { include: ["main", "develop"] } },
    };
    const desired = {
      conditions: { ref_name: { include: ["main", "develop"] } },
    };

    const diffs = computePropertyDiffs(current, desired);

    assert.equal(diffs.length, 0);
  });
});
```

**Step 2: Run test to verify it fails (or passes if already handled)**

Run: `npm test -- --test-name-pattern "nested objects|arrays"`
Expected: Should already pass with current implementation

**Step 3: Run tests to verify**

Run: `npm test -- --test-name-pattern "computePropertyDiffs"`
Expected: PASS

**Step 4: Commit**

```bash
git add test/unit/ruleset-plan-formatter.test.ts
git commit -m "$(cat <<'EOF'
test(settings): add nested object and array diff tests

Verifies computePropertyDiffs correctly handles deeply nested
properties and array comparisons for ruleset changes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Tree Formatter for Property Diffs

**Files:**

- Modify: `src/ruleset-plan-formatter.ts`
- Modify: `test/unit/ruleset-plan-formatter.test.ts`

**Step 1: Write failing test for formatPropertyTree**

```typescript
// Add to test/unit/ruleset-plan-formatter.test.ts
import {
  computePropertyDiffs,
  formatPropertyTree,
  PropertyDiff,
} from "../../src/ruleset-plan-formatter.js";

describe("formatPropertyTree", () => {
  test("formats single scalar change", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["enforcement"],
        action: "change",
        oldValue: "disabled",
        newValue: "active",
      },
    ];

    const lines = formatPropertyTree(diffs);

    assert.equal(lines.length, 1);
    // Line should contain: ~ enforcement: disabled → active
    assert.ok(lines[0].includes("enforcement"));
    assert.ok(lines[0].includes("disabled"));
    assert.ok(lines[0].includes("active"));
  });

  test("formats nested changes with indentation", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["rules", "pull_request", "required_approving_review_count"],
        action: "change",
        oldValue: 1,
        newValue: 2,
      },
    ];

    const lines = formatPropertyTree(diffs);

    // Should produce tree structure:
    // ~ rules:
    //     ~ pull_request:
    //         ~ required_approving_review_count: 1 → 2
    assert.ok(lines.some((l) => l.includes("rules")));
    assert.ok(lines.some((l) => l.includes("pull_request")));
    assert.ok(lines.some((l) => l.includes("required_approving_review_count")));
  });

  test("formats added property with +", () => {
    const diffs: PropertyDiff[] = [
      { path: ["enforcement"], action: "add", newValue: "active" },
    ];

    const lines = formatPropertyTree(diffs);

    // Should show: + enforcement: active
    assert.ok(lines[0].includes("+") || lines[0].includes("add"));
    assert.ok(lines[0].includes("enforcement"));
    assert.ok(lines[0].includes("active"));
  });

  test("formats removed property with -", () => {
    const diffs: PropertyDiff[] = [
      { path: ["enforcement"], action: "remove", oldValue: "active" },
    ];

    const lines = formatPropertyTree(diffs);

    // Should show: - enforcement (was: active)
    assert.ok(lines[0].includes("-") || lines[0].includes("remove"));
    assert.ok(lines[0].includes("enforcement"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "formatPropertyTree"`
Expected: FAIL with "formatPropertyTree is not a function"

**Step 3: Write implementation**

```typescript
// Add to src/ruleset-plan-formatter.ts
import chalk from "chalk";

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
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "formatPropertyTree"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ruleset-plan-formatter.ts test/unit/ruleset-plan-formatter.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): add tree formatter for property diffs

Adds formatPropertyTree() that converts flat PropertyDiff[] into
indented tree-structured output with colored symbols (+/~/-)
for add/change/remove actions.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add Full Ruleset Plan Formatter

**Files:**

- Modify: `src/ruleset-plan-formatter.ts`
- Modify: `test/unit/ruleset-plan-formatter.test.ts`

**Step 1: Write failing test for formatRulesetPlan**

```typescript
// Add to test/unit/ruleset-plan-formatter.test.ts
import type { RulesetChange } from "../../src/ruleset-diff.js";
import {
  computePropertyDiffs,
  formatPropertyTree,
  formatRulesetPlan,
  RulesetPlanResult,
} from "../../src/ruleset-plan-formatter.js";

describe("formatRulesetPlan", () => {
  test("formats create action with full config", () => {
    const changes: RulesetChange[] = [
      {
        action: "create",
        name: "branch-protection",
        desired: {
          target: "branch",
          enforcement: "active",
          conditions: {
            refName: { include: ["~DEFAULT_BRANCH"] },
          },
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.creates, 1);
    assert.equal(result.updates, 0);
    assert.equal(result.deletes, 0);
    // Should contain ruleset name and full config
    const output = result.lines.join("\n");
    assert.ok(output.includes("branch-protection"));
    assert.ok(output.includes("enforcement"));
    assert.ok(output.includes("active"));
  });

  test("formats update action with property diff", () => {
    const changes: RulesetChange[] = [
      {
        action: "update",
        name: "branch-protection",
        rulesetId: 1,
        current: {
          id: 1,
          name: "branch-protection",
          target: "branch",
          enforcement: "disabled",
        },
        desired: {
          target: "branch",
          enforcement: "active",
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.updates, 1);
    const output = result.lines.join("\n");
    assert.ok(output.includes("branch-protection"));
    // Should show the diff: disabled → active
    assert.ok(output.includes("disabled") || output.includes("active"));
  });

  test("formats delete action with just name", () => {
    const changes: RulesetChange[] = [
      {
        action: "delete",
        name: "old-ruleset",
        rulesetId: 1,
        current: {
          id: 1,
          name: "old-ruleset",
          target: "branch",
          enforcement: "active",
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.deletes, 1);
    const output = result.lines.join("\n");
    assert.ok(output.includes("old-ruleset"));
    // Should NOT show full config for deletes
    assert.ok(
      !output.includes("enforcement") || output.split("enforcement").length <= 2
    );
  });

  test("excludes unchanged from output but includes in count", () => {
    const changes: RulesetChange[] = [
      {
        action: "unchanged",
        name: "stable-ruleset",
        rulesetId: 1,
        current: {
          id: 1,
          name: "stable-ruleset",
          target: "branch",
          enforcement: "active",
        },
        desired: { target: "branch", enforcement: "active" },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.unchanged, 1);
    // Unchanged should not appear in output
    const output = result.lines.join("\n");
    assert.ok(!output.includes("stable-ruleset"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "formatRulesetPlan"`
Expected: FAIL with "formatRulesetPlan is not a function"

**Step 3: Write implementation**

```typescript
// Add to src/ruleset-plan-formatter.ts
import type { RulesetChange } from "./ruleset-diff.js";
import type { Ruleset } from "./config.js";

// =============================================================================
// Result Types
// =============================================================================

export interface RulesetPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
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
  const ignoreFields = new Set(["id", "name", "source_type", "source"]);

  for (const [key, value] of Object.entries(obj)) {
    if (ignoreFields.has(key) || value === undefined) continue;
    // Convert camelCase to snake_case for consistency
    const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
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
  const indentStr = "    ".repeat(indent);
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
          change.current as Record<string, unknown>
        );
        const desiredNorm = normalizeForDiff(
          change.desired as unknown as Record<string, unknown>
        );
        const diffs = computePropertyDiffs(currentNorm, desiredNorm);
        const treeLines = formatPropertyTree(diffs);
        for (const line of treeLines) {
          lines.push(`        ${line}`);
        }
      }
      lines.push(""); // Blank line between rulesets
    }
  }

  // Format deletes
  if (deleteChanges.length > 0) {
    lines.push(chalk.bold("  Delete:"));
    for (const change of deleteChanges) {
      lines.push(chalk.red(`    - ruleset "${change.name}"`));
    }
    lines.push(""); // Blank line after deletes
  }

  return { lines, creates, updates, deletes, unchanged };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "formatRulesetPlan"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ruleset-plan-formatter.ts test/unit/ruleset-plan-formatter.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): add formatRulesetPlan for Terraform-style output

Implements the main formatter that converts RulesetChange[] into
structured plan output:
- Creates: show full config with + prefix
- Updates: show property-level diffs with ~ prefix
- Deletes: show only ruleset name with - prefix
- Unchanged: count only, not displayed

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add Logger Method for Ruleset Plan

**Files:**

- Modify: `src/logger.ts`
- Modify: `test/unit/logger.test.ts`

**Step 1: Write failing test for rulesetPlan method**

```typescript
// Add to test/unit/logger.test.ts
import { test, describe, mock } from "node:test";
import { strict as assert } from "node:assert";

describe("Logger.rulesetPlan", () => {
  test("outputs plan lines with summary", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      const { Logger } = await import("../../src/logger.js");
      const logger = new Logger();

      logger.rulesetPlan("org/repo", ["  Create:", '    + ruleset "test"'], {
        creates: 1,
        updates: 0,
        deletes: 0,
        unchanged: 2,
      });

      // Should output repo header
      assert.ok(logs.some((l) => l.includes("org/repo")));
      // Should output plan lines
      assert.ok(logs.some((l) => l.includes("Create")));
      // Should output summary
      assert.ok(logs.some((l) => l.includes("1 to create")));
      assert.ok(logs.some((l) => l.includes("2 unchanged")));
    } finally {
      console.log = originalLog;
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "Logger.rulesetPlan"`
Expected: FAIL with "logger.rulesetPlan is not a function"

**Step 3: Write implementation**

```typescript
// Add to src/logger.ts interface ILogger
rulesetPlan(
  repoName: string,
  planLines: string[],
  counts: { creates: number; updates: number; deletes: number; unchanged: number }
): void;

// Add to Logger class
/**
 * Display ruleset plan output for dry-run mode.
 */
rulesetPlan(
  repoName: string,
  planLines: string[],
  counts: { creates: number; updates: number; deletes: number; unchanged: number }
): void {
  console.log("");
  console.log(chalk.bold(`Repository: ${repoName}`));

  for (const line of planLines) {
    console.log(line);
  }

  // Summary line
  const parts: string[] = [];
  if (counts.creates > 0) parts.push(chalk.green(`${counts.creates} to create`));
  if (counts.updates > 0) parts.push(chalk.yellow(`${counts.updates} to update`));
  if (counts.deletes > 0) parts.push(chalk.red(`${counts.deletes} to delete`));

  const unchangedPart = counts.unchanged > 0 ? chalk.gray(` (${counts.unchanged} unchanged)`) : "";
  const summaryLine = parts.length > 0 ? parts.join(", ") + unchangedPart : "No changes";

  console.log(chalk.gray(`Plan: ${summaryLine}`));
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "Logger.rulesetPlan"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/logger.ts test/unit/logger.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): add rulesetPlan method to Logger

Adds Logger.rulesetPlan() for displaying formatted ruleset plan
output with repo header, plan lines, and summary counts.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Integrate Plan Formatter into RulesetProcessor

**Files:**

- Modify: `src/ruleset-processor.ts`
- Modify: `test/unit/ruleset-processor.test.ts`

**Step 1: Write failing test for dry-run plan output**

```typescript
// Add to test/unit/ruleset-processor.test.ts
describe("dry-run plan output", () => {
  test("returns formatted plan in dry-run mode", async () => {
    const mockStrategy = {
      list: async () => [
        { id: 1, name: "existing", target: "branch", enforcement: "disabled" },
      ],
      create: async () => {},
      update: async () => {},
      delete: async () => {},
    };

    const processor = new RulesetProcessor(mockStrategy as any);

    const repoConfig = {
      git: ["org/repo"],
      settings: {
        rulesets: {
          existing: { target: "branch", enforcement: "active" },
          newone: { target: "branch", enforcement: "active" },
        },
      },
    };

    const result = await processor.process(
      repoConfig as any,
      { platform: "github", owner: "org", repo: "repo" } as any,
      { configId: "test", dryRun: true, managedRulesets: [] }
    );

    assert.equal(result.dryRun, true);
    assert.ok(result.planOutput); // Should have plan output
    assert.ok(result.planOutput!.lines.length > 0);
    assert.equal(result.planOutput!.creates, 1);
    assert.equal(result.planOutput!.updates, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "dry-run plan output"`
Expected: FAIL with "planOutput" not in result or assertion failure

**Step 3: Modify RulesetProcessor to include plan output**

```typescript
// Modify src/ruleset-processor.ts

import {
  formatRulesetPlan,
  RulesetPlanResult,
} from "./ruleset-plan-formatter.js";

// Add to RulesetProcessorResult interface
export interface RulesetProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  skipped?: boolean;
  dryRun?: boolean;
  changes?: {
    create: number;
    update: number;
    delete: number;
    unchanged: number;
  };
  manifestUpdate?: {
    rulesets: string[];
  };
  planOutput?: RulesetPlanResult; // NEW: formatted plan for dry-run
}

// Modify dry-run block (around line 131)
if (dryRun) {
  const summary = this.formatChangeSummary(changeCounts);
  const planOutput = formatRulesetPlan(changes); // NEW
  return {
    success: true,
    repoName,
    message: `[DRY RUN] ${summary}`,
    dryRun: true,
    changes: changeCounts,
    planOutput, // NEW
    manifestUpdate: this.computeManifestUpdate(desiredRulesets, deleteOrphaned),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "dry-run plan output"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ruleset-processor.ts test/unit/ruleset-processor.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): integrate plan formatter into RulesetProcessor

RulesetProcessor now returns planOutput in dry-run mode containing
the formatted Terraform-style plan lines and change counts.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update CLI to Display Plan Output

**Files:**

- Modify: `src/index.ts`

**Step 1: Locate settings command dry-run output**

Find where settings command results are logged (around line 400-450).

**Step 2: Modify to use rulesetPlan logger**

```typescript
// In src/index.ts, in the settings command handler
// After processing each repo, if dry-run and planOutput exists:

if (options.dryRun && result.planOutput && result.planOutput.lines.length > 0) {
  log.rulesetPlan(result.repoName, result.planOutput.lines, {
    creates: result.planOutput.creates,
    updates: result.planOutput.updates,
    deletes: result.planOutput.deletes,
    unchanged: result.planOutput.unchanged,
  });
}
```

**Step 3: Test manually**

Run: `npm run dev -- settings --config examples/example-config.yaml --dry-run`
Expected: Should show Terraform-style plan output

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "$(cat <<'EOF'
feat(settings): display plan output in CLI dry-run mode

Updates the settings command to display the new Terraform-style
plan output when running with --dry-run flag.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add Multi-Repository Summary

**Files:**

- Modify: `src/index.ts`

**Step 1: Track totals across repositories**

```typescript
// In settings command, before the repo loop
let totalCreates = 0;
let totalUpdates = 0;
let totalDeletes = 0;
let reposWithChanges = 0;

// After each repo result, if planOutput exists:
if (result.planOutput) {
  totalCreates += result.planOutput.creates;
  totalUpdates += result.planOutput.updates;
  totalDeletes += result.planOutput.deletes;
  if (
    result.planOutput.creates +
      result.planOutput.updates +
      result.planOutput.deletes >
    0
  ) {
    reposWithChanges++;
  }
}
```

**Step 2: Add final summary for multi-repo**

```typescript
// After the repo loop completes, if dry-run mode:
if (options.dryRun && reposWithChanges > 0) {
  console.log("");
  console.log(chalk.gray("─".repeat(40)));
  const totalParts: string[] = [];
  if (totalCreates > 0)
    totalParts.push(chalk.green(`${totalCreates} to create`));
  if (totalUpdates > 0)
    totalParts.push(chalk.yellow(`${totalUpdates} to update`));
  if (totalDeletes > 0) totalParts.push(chalk.red(`${totalDeletes} to delete`));
  console.log(
    chalk.bold(
      `Total: ${totalParts.join(", ")} across ${reposWithChanges} ${reposWithChanges === 1 ? "repository" : "repositories"}`
    )
  );
}
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "$(cat <<'EOF'
feat(settings): add multi-repository summary for dry-run

Shows aggregate change counts across all repositories at the
end of dry-run output.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Run Full Test Suite and Lint

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run linter**

Run: `./lint.sh`
Expected: No errors

**Step 3: Fix any issues found**

If issues found, fix and commit each fix separately.

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: address lint and test issues

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This implementation plan creates:

1. **New file:** `src/ruleset-plan-formatter.ts` - Core diffing and formatting logic
2. **New file:** `test/unit/ruleset-plan-formatter.test.ts` - Unit tests
3. **Modified:** `src/logger.ts` - New `rulesetPlan()` method
4. **Modified:** `src/ruleset-processor.ts` - Returns `planOutput` in dry-run
5. **Modified:** `src/index.ts` - Displays plan output and multi-repo summary

The implementation follows TDD with frequent commits, keeping each task focused and testable.
