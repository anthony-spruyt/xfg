# Terraform-Style Output Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace operation-counting output with Terraform-style flat resource list for both sync and settings commands.

**Architecture:** Create a unified `plan-formatter.ts` that formats resources (`file`, `ruleset`, `setting`) with `+`/`~`/`-` symbols. Refactor both commands to collect resources first, display plan, then apply. Replace GitHub summary with Terraform Cloud-style markdown.

**Tech Stack:** TypeScript, Node.js test runner, chalk for colors

---

## Task 1: Create Resource Types and Plan Model

**Files:**

- Create: `src/plan-formatter.ts`
- Test: `test/unit/plan-formatter.test.ts`

**Step 1: Write the failing test for resource types**

```typescript
// test/unit/plan-formatter.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  Resource,
  ResourceAction,
  formatResourceId,
} from "../../src/plan-formatter.js";

describe("plan-formatter", () => {
  describe("formatResourceId", () => {
    test("formats file resource", () => {
      const resource: Resource = {
        type: "file",
        repo: "org/repo",
        name: ".github/workflows/ci.yml",
        action: "create",
      };

      const result = formatResourceId(resource);

      assert.equal(result, 'file "org/repo/.github/workflows/ci.yml"');
    });

    test("formats ruleset resource", () => {
      const resource: Resource = {
        type: "ruleset",
        repo: "org/repo",
        name: "pr-rules",
        action: "update",
      };

      const result = formatResourceId(resource);

      assert.equal(result, 'ruleset "org/repo/pr-rules"');
    });

    test("formats setting resource", () => {
      const resource: Resource = {
        type: "setting",
        repo: "org/repo",
        name: "description",
        action: "change",
      };

      const result = formatResourceId(resource);

      assert.equal(result, 'setting "org/repo/description"');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "formatResourceId"`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/plan-formatter.ts
export type ResourceType = "file" | "ruleset" | "setting";
export type ResourceAction = "create" | "update" | "delete" | "unchanged";

export interface Resource {
  type: ResourceType;
  repo: string;
  name: string;
  action: ResourceAction;
  details?: ResourceDetails;
}

export interface ResourceDetails {
  diff?: string[];
  properties?: PropertyChange[];
}

export interface PropertyChange {
  path: string;
  action: "add" | "change" | "remove";
  oldValue?: unknown;
  newValue?: unknown;
}

export function formatResourceId(resource: Resource): string {
  return `${resource.type} "${resource.repo}/${resource.name}"`;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "formatResourceId"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plan-formatter.ts test/unit/plan-formatter.test.ts
git commit -m "feat: add resource types and formatResourceId"
```

---

## Task 2: Format Resource Lines with Symbols

**Files:**

- Modify: `src/plan-formatter.ts`
- Test: `test/unit/plan-formatter.test.ts`

**Step 1: Write the failing test for formatResourceLine**

```typescript
// Add to test/unit/plan-formatter.test.ts
import { formatResourceLine } from "../../src/plan-formatter.js";

describe("formatResourceLine", () => {
  test("formats create action with + symbol", () => {
    const resource: Resource = {
      type: "file",
      repo: "org/repo",
      name: "ci.yml",
      action: "create",
    };

    const result = formatResourceLine(resource);

    // Result contains ANSI codes, check for content
    assert.ok(result.includes("+"));
    assert.ok(result.includes('file "org/repo/ci.yml"'));
  });

  test("formats update action with ~ symbol", () => {
    const resource: Resource = {
      type: "ruleset",
      repo: "org/repo",
      name: "pr-rules",
      action: "update",
    };

    const result = formatResourceLine(resource);

    assert.ok(result.includes("~"));
    assert.ok(result.includes('ruleset "org/repo/pr-rules"'));
  });

  test("formats delete action with - symbol", () => {
    const resource: Resource = {
      type: "setting",
      repo: "org/repo",
      name: "hasWiki",
      action: "delete",
    };

    const result = formatResourceLine(resource);

    assert.ok(result.includes("-"));
    assert.ok(result.includes('setting "org/repo/hasWiki"'));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "formatResourceLine"`
Expected: FAIL with "formatResourceLine is not a function"

**Step 3: Write minimal implementation**

```typescript
// Add to src/plan-formatter.ts
import chalk from "chalk";

export function formatResourceLine(resource: Resource): string {
  const id = formatResourceId(resource);

  switch (resource.action) {
    case "create":
      return chalk.green(`+ ${id}`);
    case "update":
      return chalk.yellow(`~ ${id}`);
    case "delete":
      return chalk.red(`- ${id}`);
    case "unchanged":
      return chalk.gray(`  ${id}`);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "formatResourceLine"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plan-formatter.ts test/unit/plan-formatter.test.ts
git commit -m "feat: add formatResourceLine with +/~/- symbols"
```

---

## Task 3: Format Plan Summary Line

**Files:**

- Modify: `src/plan-formatter.ts`
- Test: `test/unit/plan-formatter.test.ts`

**Step 1: Write the failing test for formatPlanSummary**

```typescript
// Add to test/unit/plan-formatter.test.ts
import { formatPlanSummary, PlanCounts } from "../../src/plan-formatter.js";

describe("formatPlanSummary", () => {
  test("formats counts with all action types", () => {
    const counts: PlanCounts = {
      create: 2,
      update: 3,
      delete: 1,
    };

    const result = formatPlanSummary(counts);

    assert.ok(result.includes("Plan:"));
    assert.ok(result.includes("2 to create"));
    assert.ok(result.includes("3 to change"));
    assert.ok(result.includes("1 to destroy"));
  });

  test("omits zero counts", () => {
    const counts: PlanCounts = {
      create: 1,
      update: 0,
      delete: 0,
    };

    const result = formatPlanSummary(counts);

    assert.ok(result.includes("1 to create"));
    assert.ok(!result.includes("to change"));
    assert.ok(!result.includes("to destroy"));
  });

  test("returns no changes message when all zero", () => {
    const counts: PlanCounts = {
      create: 0,
      update: 0,
      delete: 0,
    };

    const result = formatPlanSummary(counts);

    assert.ok(
      result.includes("No changes") ||
        result.includes("0 to create, 0 to change, 0 to destroy")
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "formatPlanSummary"`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// Add to src/plan-formatter.ts
export interface PlanCounts {
  create: number;
  update: number;
  delete: number;
}

export function formatPlanSummary(counts: PlanCounts): string {
  const parts: string[] = [];

  if (counts.create > 0) {
    parts.push(chalk.green(`${counts.create} to create`));
  }
  if (counts.update > 0) {
    parts.push(chalk.yellow(`${counts.update} to change`));
  }
  if (counts.delete > 0) {
    parts.push(chalk.red(`${counts.delete} to destroy`));
  }

  if (parts.length === 0) {
    return "No changes. Your repositories match the configuration.";
  }

  return `Plan: ${parts.join(", ")}`;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "formatPlanSummary"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plan-formatter.ts test/unit/plan-formatter.test.ts
git commit -m "feat: add formatPlanSummary for Terraform-style summary"
```

---

## Task 4: Format Full Plan Output

**Files:**

- Modify: `src/plan-formatter.ts`
- Test: `test/unit/plan-formatter.test.ts`

**Step 1: Write the failing test for formatPlan**

```typescript
// Add to test/unit/plan-formatter.test.ts
import { formatPlan, Plan } from "../../src/plan-formatter.js";

describe("formatPlan", () => {
  test("formats multiple resources with summary", () => {
    const plan: Plan = {
      resources: [
        { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
        {
          type: "ruleset",
          repo: "org/repo",
          name: "pr-rules",
          action: "update",
        },
      ],
    };

    const lines = formatPlan(plan);

    // Should have resource lines
    assert.ok(lines.some((l) => l.includes('file "org/repo/ci.yml"')));
    assert.ok(lines.some((l) => l.includes('ruleset "org/repo/pr-rules"')));
    // Should have summary line
    assert.ok(lines.some((l) => l.includes("Plan:")));
  });

  test("shows no changes message for empty plan", () => {
    const plan: Plan = { resources: [] };

    const lines = formatPlan(plan);

    assert.ok(lines.some((l) => l.includes("No changes")));
  });

  test("excludes unchanged resources from output", () => {
    const plan: Plan = {
      resources: [
        { type: "file", repo: "org/repo", name: "ci.yml", action: "unchanged" },
      ],
    };

    const lines = formatPlan(plan);

    assert.ok(lines.some((l) => l.includes("No changes")));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "formatPlan"`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// Add to src/plan-formatter.ts
export interface Plan {
  resources: Resource[];
  errors?: RepoError[];
}

export interface RepoError {
  repo: string;
  message: string;
}

export function formatPlan(plan: Plan): string[] {
  const lines: string[] = [];

  // Filter to only changed resources
  const changedResources = plan.resources.filter(
    (r) => r.action !== "unchanged"
  );

  // Format each resource
  for (const resource of changedResources) {
    lines.push(formatResourceLine(resource));

    // Add details if present (indented)
    if (resource.details?.diff) {
      for (const diffLine of resource.details.diff) {
        lines.push(`    ${diffLine}`);
      }
    }
  }

  // Add errors
  if (plan.errors && plan.errors.length > 0) {
    for (const error of plan.errors) {
      lines.push(chalk.red(`✗ ${error.repo}`));
      lines.push(chalk.red(`    Error: ${error.message}`));
    }
  }

  // Add blank line before summary
  if (lines.length > 0) {
    lines.push("");
  }

  // Count actions
  const counts: PlanCounts = {
    create: plan.resources.filter((r) => r.action === "create").length,
    update: plan.resources.filter((r) => r.action === "update").length,
    delete: plan.resources.filter((r) => r.action === "delete").length,
  };

  lines.push(formatPlanSummary(counts));

  // Add error count if any
  if (plan.errors && plan.errors.length > 0) {
    lines.push(
      chalk.red(
        `${plan.errors.length} ${plan.errors.length === 1 ? "repository" : "repositories"} failed.`
      )
    );
  }

  return lines;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "formatPlan"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plan-formatter.ts test/unit/plan-formatter.test.ts
git commit -m "feat: add formatPlan for complete Terraform-style output"
```

---

## Task 5: Add Skipped Resource Support

**Files:**

- Modify: `src/plan-formatter.ts`
- Test: `test/unit/plan-formatter.test.ts`

**Step 1: Write the failing test for skipped resources**

```typescript
// Add to test/unit/plan-formatter.test.ts
describe("skipped resources", () => {
  test("formats skipped resource with reason", () => {
    const resource: Resource = {
      type: "ruleset",
      repo: "gitlab.com/org/repo",
      name: "pr-rules",
      action: "skipped" as ResourceAction,
      skipReason: "Rulesets only supported for GitHub repositories",
    };

    const result = formatResourceLine(resource);

    assert.ok(result.includes("⊘"));
    assert.ok(result.includes('ruleset "gitlab.com/org/repo/pr-rules"'));
  });

  test("includes skipped count in summary", () => {
    const plan: Plan = {
      resources: [
        {
          type: "ruleset",
          repo: "gitlab.com/org/repo",
          name: "pr-rules",
          action: "skipped" as ResourceAction,
          skipReason: "Not supported",
        },
      ],
    };

    const lines = formatPlan(plan);

    assert.ok(lines.some((l) => l.includes("1 skipped")));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "skipped resources"`
Expected: FAIL

**Step 3: Write minimal implementation**

Update the types and functions in `src/plan-formatter.ts`:

```typescript
// Update ResourceAction type
export type ResourceAction =
  | "create"
  | "update"
  | "delete"
  | "unchanged"
  | "skipped";

// Update Resource interface
export interface Resource {
  type: ResourceType;
  repo: string;
  name: string;
  action: ResourceAction;
  details?: ResourceDetails;
  skipReason?: string;
}

// Update PlanCounts
export interface PlanCounts {
  create: number;
  update: number;
  delete: number;
  skipped?: number;
}

// Update formatResourceLine
export function formatResourceLine(resource: Resource): string {
  const id = formatResourceId(resource);

  switch (resource.action) {
    case "create":
      return chalk.green(`+ ${id}`);
    case "update":
      return chalk.yellow(`~ ${id}`);
    case "delete":
      return chalk.red(`- ${id}`);
    case "skipped":
      return chalk.gray(`⊘ ${id}`);
    case "unchanged":
      return chalk.gray(`  ${id}`);
  }
}

// Update formatPlanSummary
export function formatPlanSummary(counts: PlanCounts): string {
  const parts: string[] = [];

  if (counts.create > 0) {
    parts.push(chalk.green(`${counts.create} to create`));
  }
  if (counts.update > 0) {
    parts.push(chalk.yellow(`${counts.update} to change`));
  }
  if (counts.delete > 0) {
    parts.push(chalk.red(`${counts.delete} to destroy`));
  }

  if (parts.length === 0 && (!counts.skipped || counts.skipped === 0)) {
    return "No changes. Your repositories match the configuration.";
  }

  let summary = parts.length > 0 ? `Plan: ${parts.join(", ")}` : "Plan:";

  if (counts.skipped && counts.skipped > 0) {
    summary += chalk.gray(` (${counts.skipped} skipped)`);
  }

  return summary;
}

// Update formatPlan counts calculation
// Add: skipped: plan.resources.filter(r => r.action === 'skipped').length
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "skipped resources"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plan-formatter.ts test/unit/plan-formatter.test.ts
git commit -m "feat: add skipped resource support with ⊘ symbol"
```

---

## Task 6: Print Plan to Console

**Files:**

- Modify: `src/plan-formatter.ts`
- Test: `test/unit/plan-formatter.test.ts`

**Step 1: Write the failing test for printPlan**

```typescript
// Add to test/unit/plan-formatter.test.ts
describe("printPlan", () => {
  let consoleLogs: string[];
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    consoleLogs = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  test("prints each line to console", () => {
    const plan: Plan = {
      resources: [
        { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
      ],
    };

    printPlan(plan);

    assert.ok(consoleLogs.some((l) => l.includes("file")));
    assert.ok(consoleLogs.some((l) => l.includes("Plan:")));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "printPlan"`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// Add to src/plan-formatter.ts
export function printPlan(plan: Plan): void {
  const lines = formatPlan(plan);
  for (const line of lines) {
    console.log(line);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "printPlan"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plan-formatter.ts test/unit/plan-formatter.test.ts
git commit -m "feat: add printPlan function"
```

---

## Task 7: Create GitHub Summary Formatter

**Files:**

- Create: `src/plan-summary.ts`
- Test: `test/unit/plan-summary.test.ts`

**Step 1: Write the failing test for formatPlanMarkdown**

```typescript
// test/unit/plan-summary.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatPlanMarkdown, Plan } from "../../src/plan-summary.js";

describe("formatPlanMarkdown", () => {
  test("includes title and plan summary as heading", () => {
    const plan: Plan = {
      resources: [
        { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
      ],
    };

    const markdown = formatPlanMarkdown(plan, {
      title: "Config Sync Summary",
      dryRun: false,
    });

    assert.ok(markdown.includes("## Config Sync Summary"));
    assert.ok(markdown.includes("### Plan: 1 to create"));
  });

  test("includes dry run warning", () => {
    const plan: Plan = {
      resources: [
        { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
      ],
    };

    const markdown = formatPlanMarkdown(plan, {
      title: "Config Sync Summary",
      dryRun: true,
    });

    assert.ok(markdown.includes("(Dry Run)"));
    assert.ok(markdown.includes("[!WARNING]"));
    assert.ok(markdown.includes("no changes were applied"));
  });

  test("includes resource table", () => {
    const plan: Plan = {
      resources: [
        { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
        {
          type: "ruleset",
          repo: "org/repo",
          name: "pr-rules",
          action: "update",
        },
      ],
    };

    const markdown = formatPlanMarkdown(plan, {
      title: "Summary",
      dryRun: false,
    });

    assert.ok(markdown.includes("| Resource |"));
    assert.ok(markdown.includes("| Action |"));
    assert.ok(markdown.includes('file "org/repo/ci.yml"'));
    assert.ok(markdown.includes("create"));
  });

  test("shows no changes message", () => {
    const plan: Plan = { resources: [] };

    const markdown = formatPlanMarkdown(plan, {
      title: "Summary",
      dryRun: false,
    });

    assert.ok(markdown.includes("No changes"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "formatPlanMarkdown"`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/plan-summary.ts
import type { Plan, Resource, PlanCounts } from "./plan-formatter.js";

export type { Plan, Resource, PlanCounts };

export interface PlanMarkdownOptions {
  title: string;
  dryRun: boolean;
}

function getActionSymbol(action: string): string {
  switch (action) {
    case "create":
      return "+";
    case "update":
      return "~";
    case "delete":
      return "-";
    case "skipped":
      return "⊘";
    default:
      return "";
  }
}

function formatResourceIdPlain(resource: Resource): string {
  return `${resource.type} "${resource.repo}/${resource.name}"`;
}

function countActions(resources: Resource[]): PlanCounts {
  return {
    create: resources.filter((r) => r.action === "create").length,
    update: resources.filter((r) => r.action === "update").length,
    delete: resources.filter((r) => r.action === "delete").length,
    skipped: resources.filter((r) => r.action === "skipped").length,
  };
}

function formatPlanSummaryPlain(counts: PlanCounts): string {
  const parts: string[] = [];

  if (counts.create > 0) parts.push(`${counts.create} to create`);
  if (counts.update > 0) parts.push(`${counts.update} to change`);
  if (counts.delete > 0) parts.push(`${counts.delete} to destroy`);

  if (parts.length === 0) {
    return "No changes";
  }

  return parts.join(", ");
}

export function formatPlanMarkdown(
  plan: Plan,
  options: PlanMarkdownOptions
): string {
  const lines: string[] = [];
  const counts = countActions(plan.resources);
  const changedResources = plan.resources.filter(
    (r) => r.action !== "unchanged"
  );

  // Title
  const titleSuffix = options.dryRun ? " (Dry Run)" : "";
  lines.push(`## ${options.title}${titleSuffix}`);
  lines.push("");

  // Dry-run warning
  if (options.dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Plan summary as heading
  const summaryText = formatPlanSummaryPlain(counts);
  lines.push(`### Plan: ${summaryText}`);
  lines.push("");

  // Resource table (if any changes)
  if (changedResources.length > 0) {
    lines.push("<details open>");
    lines.push("<summary><strong>Resources</strong></summary>");
    lines.push("");
    lines.push("| Resource | Action |");
    lines.push("|----------|--------|");

    for (const resource of changedResources) {
      const symbol = getActionSymbol(resource.action);
      const id = formatResourceIdPlain(resource);
      lines.push(`| \`${symbol} ${id}\` | ${resource.action} |`);
    }

    lines.push("");
    lines.push("</details>");
  }

  // Error section
  if (plan.errors && plan.errors.length > 0) {
    lines.push("");
    lines.push("<details open>");
    lines.push("<summary><strong>Errors</strong></summary>");
    lines.push("");
    lines.push("| Repository | Error |");
    lines.push("|------------|-------|");

    for (const error of plan.errors) {
      lines.push(`| ${error.repo} | ${error.message} |`);
    }

    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "formatPlanMarkdown"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plan-summary.ts test/unit/plan-summary.test.ts
git commit -m "feat: add Terraform Cloud-style GitHub summary formatter"
```

---

## Task 8: Add Collapsible Diff Details

**Files:**

- Modify: `src/plan-summary.ts`
- Test: `test/unit/plan-summary.test.ts`

**Step 1: Write the failing test for diff details**

````typescript
// Add to test/unit/plan-summary.test.ts
describe("diff details", () => {
  test("includes collapsible diff for modified resources", () => {
    const plan: Plan = {
      resources: [
        {
          type: "file",
          repo: "org/repo",
          name: "ci.yml",
          action: "update",
          details: {
            diff: ["- version: 1", "+ version: 2"],
          },
        },
      ],
    };

    const markdown = formatPlanMarkdown(plan, {
      title: "Summary",
      dryRun: false,
    });

    assert.ok(markdown.includes("<details>"));
    assert.ok(markdown.includes("Diff:"));
    assert.ok(markdown.includes("```diff"));
    assert.ok(markdown.includes("- version: 1"));
    assert.ok(markdown.includes("+ version: 2"));
  });

  test("omits diff section for resources without details", () => {
    const plan: Plan = {
      resources: [
        { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
      ],
    };

    const markdown = formatPlanMarkdown(plan, {
      title: "Summary",
      dryRun: false,
    });

    assert.ok(!markdown.includes("```diff"));
  });
});
````

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "diff details"`
Expected: FAIL

**Step 3: Extend formatPlanMarkdown implementation**

Add after the resource table in `formatPlanMarkdown`:

````typescript
// Add diff details for resources that have them
const resourcesWithDiffs = changedResources.filter(
  (r) => r.details?.diff && r.details.diff.length > 0
);

for (const resource of resourcesWithDiffs) {
  lines.push("");
  lines.push("<details>");
  lines.push(
    `<summary><strong>Diff: ${formatResourceIdPlain(resource)}</strong></summary>`
  );
  lines.push("");
  lines.push("```diff");
  for (const diffLine of resource.details!.diff!) {
    lines.push(diffLine);
  }
  lines.push("```");
  lines.push("");
  lines.push("</details>");
}
````

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "diff details"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plan-summary.ts test/unit/plan-summary.test.ts
git commit -m "feat: add collapsible diff details to GitHub summary"
```

---

## Task 9: Add writePlanSummary Function

**Files:**

- Modify: `src/plan-summary.ts`
- Test: `test/unit/plan-summary.test.ts`

**Step 1: Write the failing test for writePlanSummary**

```typescript
// Add to test/unit/plan-summary.test.ts
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writePlanSummary } from "../../src/plan-summary.js";

describe("writePlanSummary", () => {
  let tempFile: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempFile = join(tmpdir(), `plan-summary-test-${Date.now()}.md`);
    originalEnv = process.env.GITHUB_STEP_SUMMARY;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GITHUB_STEP_SUMMARY;
    } else {
      process.env.GITHUB_STEP_SUMMARY = originalEnv;
    }
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  });

  test("writes markdown to GITHUB_STEP_SUMMARY path", () => {
    process.env.GITHUB_STEP_SUMMARY = tempFile;
    const plan: Plan = {
      resources: [
        { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
      ],
    };

    writePlanSummary(plan, { title: "Test Summary", dryRun: false });

    assert.ok(existsSync(tempFile));
    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.includes("## Test Summary"));
  });

  test("no-ops when env var not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    const plan: Plan = { resources: [] };

    // Should not throw
    writePlanSummary(plan, { title: "Test", dryRun: false });

    assert.ok(!existsSync(tempFile));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "writePlanSummary"`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// Add to src/plan-summary.ts
import { appendFileSync } from "node:fs";

export function writePlanSummary(
  plan: Plan,
  options: PlanMarkdownOptions
): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatPlanMarkdown(plan, options);
  appendFileSync(summaryPath, "\n" + markdown + "\n");
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "writePlanSummary"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plan-summary.ts test/unit/plan-summary.test.ts
git commit -m "feat: add writePlanSummary for GitHub Actions"
```

---

## Task 10: Run Full Test Suite

**Files:** None (verification only)

**Step 1: Run all plan-formatter tests**

Run: `npm test -- --test-name-pattern "plan-formatter"`
Expected: All tests PASS

**Step 2: Run all plan-summary tests**

Run: `npm test -- --test-name-pattern "plan-summary\|planMarkdown\|writePlanSummary"`
Expected: All tests PASS

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 4: Run lint**

Run: `./lint.sh`
Expected: No errors

**Step 5: Commit (if any fixes needed)**

If lint fixes were applied:

```bash
git add -A
git commit -m "fix: lint errors in plan formatters"
```

---

## Task 11: Integration - Wire Up Settings Command (Part 1: Collect Resources)

**Files:**

- Modify: `src/index.ts`

**Step 1: Import new plan formatter at top of file**

```typescript
// Add to imports in src/index.ts
import { Plan, Resource, printPlan, PlanCounts } from "./plan-formatter.js";
import { writePlanSummary } from "./plan-summary.js";
```

**Step 2: Create helper to collect resources from ruleset processor result**

Add before `runSettings` function:

```typescript
function rulesetResultToResources(
  repoName: string,
  result: RulesetProcessorResult
): Resource[] {
  const resources: Resource[] = [];

  if (result.planOutput?.entries) {
    for (const entry of result.planOutput.entries) {
      let action: ResourceAction;
      switch (entry.action) {
        case "create":
          action = "create";
          break;
        case "update":
          action = "update";
          break;
        case "delete":
          action = "delete";
          break;
        default:
          action = "unchanged";
      }

      resources.push({
        type: "ruleset",
        repo: repoName,
        name: entry.name,
        action,
      });
    }
  }

  return resources;
}
```

**Step 3: Create helper for repo settings result**

```typescript
function repoSettingsResultToResources(
  repoName: string,
  result: {
    planOutput?: { entries?: Array<{ property: string; action: string }> };
  }
): Resource[] {
  const resources: Resource[] = [];

  if (result.planOutput?.entries) {
    for (const entry of result.planOutput.entries) {
      resources.push({
        type: "setting",
        repo: repoName,
        name: entry.property,
        action: entry.action === "add" ? "create" : "update",
      });
    }
  }

  return resources;
}
```

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add helpers to convert processor results to resources"
```

---

## Task 12: Integration - Wire Up Settings Command (Part 2: Replace Output)

**Files:**

- Modify: `src/index.ts`

**Step 1: Refactor runSettings to collect resources**

This is a larger refactor. Replace the main processing loops in `runSettings` to:

1. Build a deduplicated list of repos with settings
2. Process each repo, collecting resources
3. Call `printPlan` at the end

The key changes:

```typescript
// Inside runSettings, after config loading:

// Build unified repo list
const reposWithSettings = config.repos.filter(
  (r) =>
    (r.settings?.rulesets && Object.keys(r.settings.rulesets).length > 0) ||
    (r.settings?.repo && Object.keys(r.settings.repo).length > 0)
);

if (reposWithSettings.length === 0) {
  console.log("No settings configured.");
  return;
}

console.log(`Processing ${reposWithSettings.length} repositories...\n`);

const plan: Plan = { resources: [], errors: [] };

for (const repoConfig of reposWithSettings) {
  // ... process rulesets and repo settings
  // ... collect resources into plan.resources
  // ... collect errors into plan.errors
}

// Print the plan
printPlan(plan);

// Write GitHub summary
writePlanSummary(plan, {
  title: "Repository Settings Summary",
  dryRun: options.dryRun ?? false,
});

// Exit with error if any failures
if (plan.errors && plan.errors.length > 0) {
  process.exit(1);
}
```

**Step 2: Run settings command manually to verify**

Run: `npm run dev -- settings -c test-config.yaml -d`
Expected: Terraform-style output

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: refactor settings command to use Terraform-style output"
```

---

## Task 13: Integration - Wire Up Sync Command

**Files:**

- Modify: `src/index.ts`
- Modify: `src/repository-processor.ts` (to expose file change info)

**Step 1: Add file resource collection to processor result**

The `ProcessorResult` needs to include file change details. Check if it already has `fileChanges` - if so, map those to resources.

**Step 2: Refactor runSync similar to settings**

Follow the same pattern:

1. Process repos, collecting file resources
2. Call `printPlan` at the end
3. Write GitHub summary

**Step 3: Run sync command manually to verify**

Run: `npm run dev -- sync -c test-config.yaml -d`
Expected: Terraform-style output

**Step 4: Commit**

```bash
git add src/index.ts src/repository-processor.ts
git commit -m "feat: refactor sync command to use Terraform-style output"
```

---

## Task 14: Update Existing Tests

**Files:**

- Modify: `test/unit/index.test.ts`
- Modify: `test/unit/github-summary.test.ts`

**Step 1: Update index tests for new output format**

The index tests mock processors and check output. Update assertions to match new format.

**Step 2: Deprecate or update github-summary tests**

Either:

- Mark old `github-summary.ts` tests as deprecated if the file is replaced
- Or update the tests if we're keeping backwards compatibility

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add test/
git commit -m "test: update tests for Terraform-style output"
```

---

## Task 15: Cleanup Old Logger Methods

**Files:**

- Modify: `src/logger.ts`
- Modify: `test/unit/logger.test.ts`

**Step 1: Identify unused logger methods**

After the refactor, methods like `setTotal`, `progress`, `success`, `skip`, `error`, `summary` may no longer be called from the main code paths.

**Step 2: Mark deprecated or remove**

If methods are still needed for sync command or other paths, keep them. Otherwise, remove and update tests.

**Step 3: Run tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/logger.ts test/unit/logger.test.ts
git commit -m "refactor: remove unused logger methods"
```

---

## Task 16: Final Verification

**Files:** None (verification only)

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run lint**

Run: `./lint.sh`
Expected: No errors

**Step 3: Run coverage check**

Run: `npm run test:coverage`
Expected: Coverage >= 95%

**Step 4: Manual testing with real config**

Test both commands:

```bash
npm run dev -- sync -c <your-config.yaml> -d
npm run dev -- settings -c <your-config.yaml> -d
```

Expected: Terraform-style output for both

**Step 5: Verify GitHub Actions summary (if possible)**

Set `GITHUB_STEP_SUMMARY` env var and check output file.

**Step 6: Final commit if any fixes**

```bash
git add -A
git commit -m "fix: final adjustments for Terraform-style output"
```

---

## Summary

This plan implements Terraform-style output in 16 tasks:

1. **Tasks 1-6:** Build `plan-formatter.ts` with TDD
2. **Tasks 7-9:** Build `plan-summary.ts` for GitHub Actions
3. **Task 10:** Verify all new code
4. **Tasks 11-13:** Integrate into settings and sync commands
5. **Tasks 14-15:** Update/cleanup existing tests and code
6. **Task 16:** Final verification

Each task is 2-5 minutes of focused work with clear verification steps.
