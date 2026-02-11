# Settings Output Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken Resource-based output model with a repo-centric SettingsReport that groups all changes by repository and renders them clearly.

**Architecture:** Create new types (`SettingsReport`, `RepoChanges`, `SettingChange`, `RulesetChange`) in a new module, build a formatter that outputs both CLI and GitHub markdown, then wire it into `settings-command.ts` to replace the current `printPlan()`/`writePlanSummary()` calls. Delete the broken `resource-converters.ts` and `plan-summary.ts`.

**Tech Stack:** TypeScript, chalk (for CLI colors), node:fs (for GITHUB_STEP_SUMMARY)

---

## Phase 1: New Types and Formatter (No Integration Yet)

### Task 1: Create SettingsReport Types

**Files:**

- Create: `src/output/settings-report.ts`

**Step 1: Write the failing test**

Create test file first to verify types exist.

```typescript
// test/unit/settings-report-formatter.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import type {
  SettingsReport,
  RepoChanges,
  SettingChange,
  RulesetChange,
} from "../../src/output/settings-report.js";

describe("settings-report types", () => {
  test("SettingsReport structure is correct", () => {
    const report: SettingsReport = {
      repos: [],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };
    assert.ok(report);
  });

  test("RepoChanges structure is correct", () => {
    const repoChanges: RepoChanges = {
      repoName: "org/repo",
      settings: [],
      rulesets: [],
    };
    assert.ok(repoChanges);
  });

  test("SettingChange structure is correct", () => {
    const change: SettingChange = {
      name: "deleteBranchOnMerge",
      action: "change",
      oldValue: false,
      newValue: true,
    };
    assert.ok(change);
  });

  test("RulesetChange structure is correct", () => {
    const change: RulesetChange = {
      name: "branch-protection",
      action: "update",
      propertyDiffs: [],
    };
    assert.ok(change);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "settings-report types"`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/output/settings-report.ts
import type { PropertyDiff } from "../settings/rulesets/formatter.js";
import type { Ruleset } from "../config/index.js";

export interface SettingsReport {
  repos: RepoChanges[];
  totals: {
    settings: { add: number; change: number };
    rulesets: { create: number; update: number; delete: number };
  };
}

export interface RepoChanges {
  repoName: string;
  settings: SettingChange[];
  rulesets: RulesetChange[];
  error?: string;
}

export interface SettingChange {
  name: string;
  action: "add" | "change";
  oldValue?: unknown;
  newValue: unknown;
}

export interface RulesetChange {
  name: string;
  action: "create" | "update" | "delete";
  propertyDiffs?: PropertyDiff[];
  config?: Ruleset;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "settings-report types"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/settings-report.ts test/unit/settings-report-formatter.test.ts
git commit -m "feat(output): add SettingsReport types for repo-centric output

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Create CLI Formatter - Basic Settings

**Files:**

- Modify: `src/output/settings-report.ts`
- Modify: `test/unit/settings-report-formatter.test.ts`

**Step 1: Write the failing test**

Add to existing test file:

```typescript
import {
  formatSettingsReportCLI,
  type SettingsReport,
} from "../../src/output/settings-report.js";

describe("formatSettingsReportCLI", () => {
  test("renders repo with settings changes only", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "deleteBranchOnMerge",
              action: "change",
              oldValue: false,
              newValue: true,
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("org/repo"), "should include repo name");
    assert.ok(
      output.includes("deleteBranchOnMerge"),
      "should include setting name"
    );
    assert.ok(output.includes("false"), "should include old value");
    assert.ok(output.includes("true"), "should include new value");
    assert.ok(output.includes("1 setting"), "should include summary");
  });

  test("renders setting add action", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "hasWiki",
              action: "add",
              newValue: true,
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 1, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("hasWiki"), "should include setting name");
    assert.ok(output.includes("true"), "should include new value");
  });

  test("renders empty report as no changes", () => {
    const report: SettingsReport = {
      repos: [],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("No changes"), "should show no changes message");
  });

  test("renders multiple repos with blank lines between", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo1",
          settings: [{ name: "hasWiki", action: "add", newValue: true }],
          rulesets: [],
        },
        {
          repoName: "org/repo2",
          settings: [
            {
              name: "deleteBranchOnMerge",
              action: "change",
              oldValue: false,
              newValue: true,
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 1, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("org/repo1"), "should include first repo");
    assert.ok(output.includes("org/repo2"), "should include second repo");
    // Verify blank line between repos (repo1 content, blank, repo2 header)
    const repo1Index = lines.findIndex((l) => l.includes("org/repo1"));
    const repo2Index = lines.findIndex((l) => l.includes("org/repo2"));
    assert.ok(
      repo2Index > repo1Index + 2,
      "should have separation between repos"
    );
  });

  test("renders repo with error", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/failed-repo",
          settings: [],
          rulesets: [],
          error: "Connection refused",
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const lines = formatSettingsReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("org/failed-repo"), "should include repo name");
    assert.ok(output.includes("Error:"), "should show error label");
    assert.ok(
      output.includes("Connection refused"),
      "should show error message"
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "formatSettingsReportCLI"`
Expected: FAIL with "formatSettingsReportCLI is not a function"

**Step 3: Write minimal implementation**

Add to `src/output/settings-report.ts`:

```typescript
import chalk from "chalk";

function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return val ? "true" : "false";
  return String(val);
}

function formatSummary(totals: SettingsReport["totals"]): string {
  const parts: string[] = [];
  const settingsTotal = totals.settings.add + totals.settings.change;
  const rulesetsTotal =
    totals.rulesets.create + totals.rulesets.update + totals.rulesets.delete;

  if (settingsTotal > 0) {
    const settingWord = settingsTotal === 1 ? "setting" : "settings";
    const actions: string[] = [];
    if (totals.settings.add > 0) actions.push(`${totals.settings.add} to add`);
    if (totals.settings.change > 0)
      actions.push(`${totals.settings.change} to change`);
    parts.push(`${settingsTotal} ${settingWord} (${actions.join(", ")})`);
  }

  if (rulesetsTotal > 0) {
    const rulesetWord = rulesetsTotal === 1 ? "ruleset" : "rulesets";
    const actions: string[] = [];
    if (totals.rulesets.create > 0)
      actions.push(`${totals.rulesets.create} to create`);
    if (totals.rulesets.update > 0)
      actions.push(`${totals.rulesets.update} to update`);
    if (totals.rulesets.delete > 0)
      actions.push(`${totals.rulesets.delete} to delete`);
    parts.push(`${rulesetsTotal} ${rulesetWord} (${actions.join(", ")})`);
  }

  if (parts.length === 0) {
    return "No changes";
  }

  return `Plan: ${parts.join(", ")}`;
}

export function formatSettingsReportCLI(report: SettingsReport): string[] {
  const lines: string[] = [];

  for (const repo of report.repos) {
    if (
      repo.settings.length === 0 &&
      repo.rulesets.length === 0 &&
      !repo.error
    ) {
      continue;
    }

    // Repo header
    lines.push(chalk.yellow(`~ ${repo.repoName}`));

    // Settings
    for (const setting of repo.settings) {
      if (setting.action === "add") {
        lines.push(
          chalk.green(`    + ${setting.name}: ${formatValue(setting.newValue)}`)
        );
      } else {
        lines.push(
          chalk.yellow(
            `    ~ ${setting.name}: ${formatValue(setting.oldValue)} → ${formatValue(setting.newValue)}`
          )
        );
      }
    }

    // Error
    if (repo.error) {
      lines.push(chalk.red(`    Error: ${repo.error}`));
    }

    lines.push(""); // Blank line between repos
  }

  // Summary
  lines.push(formatSummary(report.totals));

  return lines;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "formatSettingsReportCLI"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/settings-report.ts test/unit/settings-report-formatter.test.ts
git commit -m "feat(output): add formatSettingsReportCLI for settings

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Add Ruleset Rendering to CLI Formatter

**Files:**

- Modify: `src/output/settings-report.ts`
- Modify: `test/unit/settings-report-formatter.test.ts`

**Step 1: Write the failing test**

Add to test file:

```typescript
test("renders ruleset create with full config tree", () => {
  const report: SettingsReport = {
    repos: [
      {
        repoName: "org/repo",
        settings: [],
        rulesets: [
          {
            name: "ci-bypass",
            action: "create",
            config: {
              name: "ci-bypass",
              target: "branch",
              enforcement: "active",
              conditions: {
                ref_name: {
                  include: ["refs/heads/main"],
                  exclude: [],
                },
              },
            },
          },
        ],
      },
    ],
    totals: {
      settings: { add: 0, change: 0 },
      rulesets: { create: 1, update: 0, delete: 0 },
    },
  };

  const lines = formatSettingsReportCLI(report);
  const output = lines.join("\n");

  assert.ok(
    output.includes('ruleset "ci-bypass"'),
    "should include ruleset name in header"
  );
  assert.ok(output.includes("enforcement"), "should include properties");
  assert.ok(output.includes("active"), "should include property values");
  // Verify "name" is NOT in tree output (it's in the header, not duplicated in tree)
  const treeLines = lines.filter((l) => l.includes("+ name:"));
  assert.equal(
    treeLines.length,
    0,
    "should not include 'name' property in tree (it's in header)"
  );
});

test("renders ruleset update with property diffs", () => {
  const report: SettingsReport = {
    repos: [
      {
        repoName: "org/repo",
        settings: [],
        rulesets: [
          {
            name: "branch-protection",
            action: "update",
            propertyDiffs: [
              {
                path: ["enforcement"],
                action: "change",
                oldValue: "active",
                newValue: "evaluate",
              },
            ],
          },
        ],
      },
    ],
    totals: {
      settings: { add: 0, change: 0 },
      rulesets: { create: 0, update: 1, delete: 0 },
    },
  };

  const lines = formatSettingsReportCLI(report);
  const output = lines.join("\n");

  assert.ok(
    output.includes('ruleset "branch-protection"'),
    "should include ruleset name"
  );
  assert.ok(output.includes("enforcement"), "should include changed property");
  assert.ok(output.includes("active"), "should include old value");
  assert.ok(output.includes("evaluate"), "should include new value");
});

test("renders ruleset delete", () => {
  const report: SettingsReport = {
    repos: [
      {
        repoName: "org/repo",
        settings: [],
        rulesets: [
          {
            name: "old-ruleset",
            action: "delete",
          },
        ],
      },
    ],
    totals: {
      settings: { add: 0, change: 0 },
      rulesets: { create: 0, update: 0, delete: 1 },
    },
  };

  const lines = formatSettingsReportCLI(report);
  const output = lines.join("\n");

  assert.ok(
    output.includes('ruleset "old-ruleset"'),
    "should include ruleset name"
  );
});

test("renders mixed settings and rulesets", () => {
  const report: SettingsReport = {
    repos: [
      {
        repoName: "org/repo",
        settings: [
          {
            name: "deleteBranchOnMerge",
            action: "change",
            oldValue: false,
            newValue: true,
          },
        ],
        rulesets: [
          {
            name: "branch-protection",
            action: "update",
            propertyDiffs: [
              {
                path: ["enforcement"],
                action: "change",
                oldValue: "active",
                newValue: "evaluate",
              },
            ],
          },
        ],
      },
    ],
    totals: {
      settings: { add: 0, change: 1 },
      rulesets: { create: 0, update: 1, delete: 0 },
    },
  };

  const lines = formatSettingsReportCLI(report);
  const output = lines.join("\n");

  assert.ok(output.includes("deleteBranchOnMerge"), "should include setting");
  assert.ok(output.includes("branch-protection"), "should include ruleset");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "renders ruleset"`
Expected: FAIL (rulesets not rendered)

**Step 3: Write minimal implementation**

Update `formatSettingsReportCLI` in `src/output/settings-report.ts`:

```typescript
import { formatPropertyTree } from "../settings/rulesets/formatter.js";

// Add helper to format ruleset config as tree
function formatRulesetConfig(config: Ruleset, indent: number): string[] {
  const lines: string[] = [];
  const pad = "    ".repeat(indent);

  function renderValue(
    key: string,
    value: unknown,
    currentIndent: number
  ): void {
    const currentPad = "    ".repeat(currentIndent);
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(chalk.green(`${currentPad}+ ${key}: []`));
      } else if (value.every((v) => typeof v !== "object")) {
        lines.push(
          chalk.green(
            `${currentPad}+ ${key}: [${value.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(", ")}]`
          )
        );
      } else {
        lines.push(chalk.green(`${currentPad}+ ${key}:`));
        for (const item of value) {
          if (typeof item === "object" && item !== null) {
            lines.push(
              chalk.green(`${currentPad}    + ${JSON.stringify(item)}`)
            );
          } else {
            lines.push(chalk.green(`${currentPad}    + ${formatValue(item)}`));
          }
        }
      }
    } else if (typeof value === "object") {
      lines.push(chalk.green(`${currentPad}+ ${key}:`));
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        renderValue(k, v, currentIndent + 1);
      }
    } else {
      lines.push(chalk.green(`${currentPad}+ ${key}: ${formatValue(value)}`));
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (key === "name") continue; // Name is in the header
    renderValue(key, value, indent);
  }

  return lines;
}

export function formatSettingsReportCLI(report: SettingsReport): string[] {
  const lines: string[] = [];

  for (const repo of report.repos) {
    if (
      repo.settings.length === 0 &&
      repo.rulesets.length === 0 &&
      !repo.error
    ) {
      continue;
    }

    // Repo header
    lines.push(chalk.yellow(`~ ${repo.repoName}`));

    // Settings
    for (const setting of repo.settings) {
      if (setting.action === "add") {
        lines.push(
          chalk.green(`    + ${setting.name}: ${formatValue(setting.newValue)}`)
        );
      } else {
        lines.push(
          chalk.yellow(
            `    ~ ${setting.name}: ${formatValue(setting.oldValue)} → ${formatValue(setting.newValue)}`
          )
        );
      }
    }

    // Rulesets
    for (const ruleset of repo.rulesets) {
      if (ruleset.action === "create") {
        lines.push(chalk.green(`    + ruleset "${ruleset.name}"`));
        if (ruleset.config) {
          lines.push(...formatRulesetConfig(ruleset.config, 2));
        }
      } else if (ruleset.action === "update") {
        lines.push(chalk.yellow(`    ~ ruleset "${ruleset.name}"`));
        if (ruleset.propertyDiffs && ruleset.propertyDiffs.length > 0) {
          const treeLines = formatPropertyTree(ruleset.propertyDiffs);
          for (const line of treeLines) {
            lines.push(`        ${line}`);
          }
        }
      } else if (ruleset.action === "delete") {
        lines.push(chalk.red(`    - ruleset "${ruleset.name}"`));
      }
    }

    // Error
    if (repo.error) {
      lines.push(chalk.red(`    Error: ${repo.error}`));
    }

    lines.push(""); // Blank line between repos
  }

  // Summary
  lines.push(formatSummary(report.totals));

  return lines;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "renders ruleset|renders mixed"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/settings-report.ts test/unit/settings-report-formatter.test.ts
git commit -m "feat(output): add ruleset rendering to CLI formatter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Add Markdown Formatter

**Files:**

- Modify: `src/output/settings-report.ts`
- Modify: `test/unit/settings-report-formatter.test.ts`

**Step 1: Write the failing test**

Add to test file:

````typescript
import { formatSettingsReportMarkdown } from "../../src/output/settings-report.js";

describe("formatSettingsReportMarkdown", () => {
  test("includes dry run warning when dryRun=true", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "deleteBranchOnMerge",
              action: "change",
              oldValue: false,
              newValue: true,
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, true);

    assert.ok(
      markdown.includes("(Dry Run)"),
      "should include dry run in title"
    );
    assert.ok(
      markdown.includes("[!WARNING]"),
      "should include warning callout"
    );
    assert.ok(
      markdown.includes("no changes were applied"),
      "should explain dry run"
    );
  });

  test("wraps output in diff code block", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "deleteBranchOnMerge",
              action: "change",
              oldValue: false,
              newValue: true,
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(markdown.includes("```diff"), "should have diff code block");
    assert.ok(markdown.includes("org/repo"), "should include repo name");
    assert.ok(
      markdown.includes("deleteBranchOnMerge"),
      "should include setting"
    );
  });

  test("includes plan summary as bold text", () => {
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "deleteBranchOnMerge",
              action: "change",
              oldValue: false,
              newValue: true,
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(markdown.includes("**Plan:"), "should have bold plan summary");
  });

  test("no dry run warning when dryRun=false", () => {
    const report: SettingsReport = {
      repos: [],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatSettingsReportMarkdown(report, false);

    assert.ok(!markdown.includes("[!WARNING]"), "should not include warning");
    assert.ok(!markdown.includes("Dry Run"), "should not mention dry run");
  });
});
````

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "formatSettingsReportMarkdown"`
Expected: FAIL with "formatSettingsReportMarkdown is not a function"

**Step 3: Write minimal implementation**

Add to `src/output/settings-report.ts`:

````typescript
// Plain text version of formatValue (no chalk)
function formatValuePlain(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return val ? "true" : "false";
  return String(val);
}

function formatRulesetConfigPlain(config: Ruleset, indent: number): string[] {
  const lines: string[] = [];

  function renderValue(
    key: string,
    value: unknown,
    currentIndent: number
  ): void {
    const pad = "    ".repeat(currentIndent);
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}+ ${key}: []`);
      } else if (value.every((v) => typeof v !== "object")) {
        lines.push(
          `${pad}+ ${key}: [${value.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(", ")}]`
        );
      } else {
        lines.push(`${pad}+ ${key}:`);
        for (const item of value) {
          if (typeof item === "object" && item !== null) {
            lines.push(`${pad}    + ${JSON.stringify(item)}`);
          } else {
            lines.push(`${pad}    + ${formatValuePlain(item)}`);
          }
        }
      }
    } else if (typeof value === "object") {
      lines.push(`${pad}+ ${key}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        renderValue(k, v, currentIndent + 1);
      }
    } else {
      lines.push(`${pad}+ ${key}: ${formatValuePlain(value)}`);
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (key === "name") continue;
    renderValue(key, value, indent);
  }

  return lines;
}

export function formatSettingsReportMarkdown(
  report: SettingsReport,
  dryRun: boolean
): string {
  const lines: string[] = [];

  // Title
  const titleSuffix = dryRun ? " (Dry Run)" : "";
  lines.push(`## Repository Settings Summary${titleSuffix}`);
  lines.push("");

  // Dry-run warning
  if (dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Diff block
  const diffLines: string[] = [];

  for (const repo of report.repos) {
    if (
      repo.settings.length === 0 &&
      repo.rulesets.length === 0 &&
      !repo.error
    ) {
      continue;
    }

    diffLines.push(`~ ${repo.repoName}`);

    for (const setting of repo.settings) {
      if (setting.action === "add") {
        diffLines.push(
          `    + ${setting.name}: ${formatValuePlain(setting.newValue)}`
        );
      } else {
        diffLines.push(
          `    ~ ${setting.name}: ${formatValuePlain(setting.oldValue)} → ${formatValuePlain(setting.newValue)}`
        );
      }
    }

    for (const ruleset of repo.rulesets) {
      if (ruleset.action === "create") {
        diffLines.push(`    + ruleset "${ruleset.name}"`);
        if (ruleset.config) {
          diffLines.push(...formatRulesetConfigPlain(ruleset.config, 2));
        }
      } else if (ruleset.action === "update") {
        diffLines.push(`    ~ ruleset "${ruleset.name}"`);
        if (ruleset.propertyDiffs && ruleset.propertyDiffs.length > 0) {
          for (const diff of ruleset.propertyDiffs) {
            const path = diff.path.join(".");
            if (diff.action === "add") {
              diffLines.push(
                `        + ${path}: ${formatValuePlain(diff.newValue)}`
              );
            } else if (diff.action === "change") {
              diffLines.push(
                `        ~ ${path}: ${formatValuePlain(diff.oldValue)} → ${formatValuePlain(diff.newValue)}`
              );
            } else if (diff.action === "remove") {
              diffLines.push(`        - ${path}`);
            }
          }
        }
      } else if (ruleset.action === "delete") {
        diffLines.push(`    - ruleset "${ruleset.name}"`);
      }
    }

    if (repo.error) {
      diffLines.push(`    ! Error: ${repo.error}`);
    }
  }

  if (diffLines.length > 0) {
    lines.push("```diff");
    lines.push(...diffLines);
    lines.push("```");
    lines.push("");
  }

  // Summary
  lines.push(`**${formatSummary(report.totals)}**`);

  return lines.join("\n");
}
````

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "formatSettingsReportMarkdown"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/settings-report.ts test/unit/settings-report-formatter.test.ts
git commit -m "feat(output): add formatSettingsReportMarkdown for GitHub summary

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Add writeSettingsReportSummary Function

**Files:**

- Modify: `src/output/settings-report.ts`
- Modify: `test/unit/settings-report-formatter.test.ts`

**Step 1: Write the failing test**

Add to test file:

```typescript
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeSettingsReportSummary } from "../../src/output/settings-report.js";

describe("writeSettingsReportSummary", () => {
  let tempFile: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempFile = join(tmpdir(), `settings-report-test-${Date.now()}.md`);
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
    const report: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "deleteBranchOnMerge",
              action: "change",
              oldValue: false,
              newValue: true,
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    writeSettingsReportSummary(report, false);

    assert.ok(existsSync(tempFile));
    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.includes("Repository Settings Summary"));
  });

  test("no-ops when env var not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    const report: SettingsReport = {
      repos: [],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    writeSettingsReportSummary(report, false);

    assert.ok(!existsSync(tempFile));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "writeSettingsReportSummary"`
Expected: FAIL with "writeSettingsReportSummary is not a function"

**Step 3: Write minimal implementation**

Add to `src/output/settings-report.ts`:

```typescript
import { appendFileSync } from "node:fs";

export function writeSettingsReportSummary(
  report: SettingsReport,
  dryRun: boolean
): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatSettingsReportMarkdown(report, dryRun);
  appendFileSync(summaryPath, "\n" + markdown + "\n");
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "writeSettingsReportSummary"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/settings-report.ts test/unit/settings-report-formatter.test.ts
git commit -m "feat(output): add writeSettingsReportSummary for CI

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 2: Wire Up to Settings Command

### Task 6: Add oldValue to RepoSettingsPlanEntry

**Files:**

- Modify: `src/settings/repo-settings/formatter.ts`
- Modify: `test/unit/repo-settings-formatter.test.ts` (if exists, otherwise add tests)

**Step 1: Write the failing test**

Check if test file exists, create/modify as needed:

```typescript
// test/unit/repo-settings-formatter.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatRepoSettingsPlan } from "../../src/settings/repo-settings/formatter.js";
import type { RepoSettingsChange } from "../../src/settings/repo-settings/diff.js";

describe("formatRepoSettingsPlan", () => {
  test("entries include oldValue and newValue for change action", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "deleteBranchOnMerge",
        action: "change",
        oldValue: false,
        newValue: true,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].property, "deleteBranchOnMerge");
    assert.equal(result.entries[0].action, "change");
    assert.equal(result.entries[0].oldValue, false);
    assert.equal(result.entries[0].newValue, true);
  });

  test("entries include newValue for add action", () => {
    const changes: RepoSettingsChange[] = [
      {
        property: "hasWiki",
        action: "add",
        newValue: true,
      },
    ];

    const result = formatRepoSettingsPlan(changes);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].action, "add");
    assert.equal(result.entries[0].newValue, true);
    assert.equal(result.entries[0].oldValue, undefined);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "entries include"`
Expected: FAIL (oldValue/newValue not on entries)

**Step 3: Write minimal implementation**

Modify `src/settings/repo-settings/formatter.ts`:

```typescript
export interface RepoSettingsPlanEntry {
  property: string;
  action: "add" | "change";
  oldValue?: unknown;
  newValue?: unknown;
}

// In formatRepoSettingsPlan, update the entry creation:
if (change.action === "add") {
  // ... existing line formatting
  entries.push({
    property: change.property,
    action: "add",
    newValue: change.newValue,
  });
} else if (change.action === "change") {
  // ... existing line formatting
  entries.push({
    property: change.property,
    action: "change",
    oldValue: change.oldValue,
    newValue: change.newValue,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "entries include"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/settings/repo-settings/formatter.ts test/unit/repo-settings-formatter.test.ts
git commit -m "feat(settings): add oldValue/newValue to RepoSettingsPlanEntry

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Add propertyDiffs to RulesetPlanEntry

**Files:**

- Modify: `src/settings/rulesets/formatter.ts`

**Step 1: Write the failing test**

```typescript
// test/unit/ruleset-formatter.test.ts (add to existing or create)
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatRulesetPlan } from "../../src/settings/rulesets/formatter.js";
import type { RulesetChange } from "../../src/settings/rulesets/diff.js";

describe("formatRulesetPlan propertyDiffs", () => {
  test("entries include propertyDiffs for update action", () => {
    const changes: RulesetChange[] = [
      {
        name: "branch-protection",
        action: "update",
        current: {
          name: "branch-protection",
          enforcement: "active",
          target: "branch",
        },
        desired: {
          name: "branch-protection",
          enforcement: "evaluate",
          target: "branch",
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].action, "update");
    assert.ok(result.entries[0].propertyDiffs);
    assert.ok(result.entries[0].propertyDiffs!.length > 0);
    const enforcementDiff = result.entries[0].propertyDiffs!.find(
      (d) => d.path[0] === "enforcement"
    );
    assert.ok(enforcementDiff);
    assert.equal(enforcementDiff!.oldValue, "active");
    assert.equal(enforcementDiff!.newValue, "evaluate");
  });

  test("entries include config for create action", () => {
    const changes: RulesetChange[] = [
      {
        name: "new-ruleset",
        action: "create",
        desired: {
          name: "new-ruleset",
          enforcement: "active",
          target: "branch",
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].action, "create");
    assert.ok(result.entries[0].config);
    assert.equal(result.entries[0].config!.name, "new-ruleset");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "propertyDiffs|config for create"`
Expected: FAIL (propertyDiffs/config not on entries)

**Step 3: Write minimal implementation**

Modify `src/settings/rulesets/formatter.ts`:

```typescript
import type { Ruleset } from "../../config/index.js";

export interface RulesetPlanEntry {
  name: string;
  action: RulesetAction;
  propertyCount?: number;
  propertyChanges?: {
    added: number;
    changed: number;
    removed: number;
  };
  propertyDiffs?: PropertyDiff[]; // NEW
  config?: Ruleset; // NEW
}

// In formatRulesetPlan, update the entry creation for creates:
entries.push({
  name: change.name,
  action: "create",
  propertyCount,
  config: change.desired, // ADD THIS
});

// For updates, add propertyDiffs to the entry:
if (change.current && change.desired) {
  // ... existing diff computation
  const diffs = computePropertyDiffs(projectedCurrent, desiredNorm);
  // ... existing tree formatting

  entries.push({
    name: change.name,
    action: "update",
    propertyChanges: { added, changed, removed },
    propertyDiffs: diffs, // ADD THIS
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "propertyDiffs|config for create"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/settings/rulesets/formatter.ts test/unit/ruleset-formatter.test.ts
git commit -m "feat(rulesets): add propertyDiffs and config to RulesetPlanEntry

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Add buildSettingsReport Function

**Files:**

- Create: `src/cli/settings-report-builder.ts`
- Create: `test/unit/settings-report-builder.test.ts`

**Step 1: Write the failing test**

```typescript
// test/unit/settings-report-builder.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { buildSettingsReport } from "../../src/cli/settings-report-builder.js";
import type { SettingsReport } from "../../src/output/settings-report.js";

describe("buildSettingsReport", () => {
  test("converts settings processor result to SettingsReport", () => {
    const results = [
      {
        repoName: "org/repo",
        settingsResult: {
          planOutput: {
            entries: [
              {
                property: "deleteBranchOnMerge",
                action: "change" as const,
                oldValue: false,
                newValue: true,
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.repos.length, 1);
    assert.equal(report.repos[0].repoName, "org/repo");
    assert.equal(report.repos[0].settings.length, 1);
    assert.equal(report.repos[0].settings[0].name, "deleteBranchOnMerge");
    assert.equal(report.repos[0].settings[0].action, "change");
    assert.equal(report.totals.settings.change, 1);
  });

  test("converts ruleset processor result to SettingsReport", () => {
    const results = [
      {
        repoName: "org/repo",
        rulesetResult: {
          planOutput: {
            entries: [
              {
                name: "branch-protection",
                action: "update" as const,
                propertyDiffs: [
                  {
                    path: ["enforcement"],
                    action: "change" as const,
                    oldValue: "active",
                    newValue: "evaluate",
                  },
                ],
              },
            ],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.repos.length, 1);
    assert.equal(report.repos[0].rulesets.length, 1);
    assert.equal(report.repos[0].rulesets[0].name, "branch-protection");
    assert.equal(report.repos[0].rulesets[0].action, "update");
    assert.equal(report.totals.rulesets.update, 1);
  });

  test("includes error in repo entry", () => {
    const results = [
      {
        repoName: "org/repo",
        error: "Connection failed",
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.repos.length, 1);
    assert.equal(report.repos[0].error, "Connection failed");
  });

  test("aggregates totals correctly", () => {
    const results = [
      {
        repoName: "org/repo1",
        settingsResult: {
          planOutput: {
            entries: [
              { property: "p1", action: "add" as const, newValue: true },
              {
                property: "p2",
                action: "change" as const,
                oldValue: 1,
                newValue: 2,
              },
            ],
          },
        },
        rulesetResult: {
          planOutput: {
            entries: [{ name: "r1", action: "create" as const }],
          },
        },
      },
      {
        repoName: "org/repo2",
        rulesetResult: {
          planOutput: {
            entries: [{ name: "r2", action: "delete" as const }],
          },
        },
      },
    ];

    const report = buildSettingsReport(results);

    assert.equal(report.totals.settings.add, 1);
    assert.equal(report.totals.settings.change, 1);
    assert.equal(report.totals.rulesets.create, 1);
    assert.equal(report.totals.rulesets.delete, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "buildSettingsReport"`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/cli/settings-report-builder.ts
import type {
  SettingsReport,
  RepoChanges,
  SettingChange,
  RulesetChange,
} from "../output/settings-report.js";
import type { RepoSettingsPlanEntry } from "../settings/repo-settings/formatter.js";
import type { RulesetPlanEntry } from "../settings/rulesets/formatter.js";

interface ProcessorResults {
  repoName: string;
  settingsResult?: {
    planOutput?: {
      entries?: RepoSettingsPlanEntry[];
    };
  };
  rulesetResult?: {
    planOutput?: {
      entries?: RulesetPlanEntry[];
    };
  };
  error?: string;
}

export function buildSettingsReport(
  results: ProcessorResults[]
): SettingsReport {
  const repos: RepoChanges[] = [];
  const totals = {
    settings: { add: 0, change: 0 },
    rulesets: { create: 0, update: 0, delete: 0 },
  };

  for (const result of results) {
    const repoChanges: RepoChanges = {
      repoName: result.repoName,
      settings: [],
      rulesets: [],
    };

    // Convert settings processor output
    if (result.settingsResult?.planOutput?.entries) {
      for (const entry of result.settingsResult.planOutput.entries) {
        const settingChange: SettingChange = {
          name: entry.property,
          action: entry.action,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
        };
        repoChanges.settings.push(settingChange);

        if (entry.action === "add") {
          totals.settings.add++;
        } else {
          totals.settings.change++;
        }
      }
    }

    // Convert ruleset processor output
    if (result.rulesetResult?.planOutput?.entries) {
      for (const entry of result.rulesetResult.planOutput.entries) {
        if (entry.action === "unchanged") continue;

        const rulesetChange: RulesetChange = {
          name: entry.name,
          action: entry.action as "create" | "update" | "delete",
          propertyDiffs: entry.propertyDiffs,
          config: entry.config,
        };
        repoChanges.rulesets.push(rulesetChange);

        if (entry.action === "create") {
          totals.rulesets.create++;
        } else if (entry.action === "update") {
          totals.rulesets.update++;
        } else if (entry.action === "delete") {
          totals.rulesets.delete++;
        }
      }
    }

    if (result.error) {
      repoChanges.error = result.error;
    }

    repos.push(repoChanges);
  }

  return { repos, totals };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "buildSettingsReport"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/settings-report-builder.ts test/unit/settings-report-builder.test.ts
git commit -m "feat(cli): add buildSettingsReport to convert processor results

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Integrate New Report into Settings Command

**Files:**

- Modify: `src/cli/settings-command.ts`

**Step 1: Understand the current flow**

The current `settings-command.ts` has TWO SEPARATE LOOPS that may process the SAME repo:

1. **Loop 1** (lines 100-215): Iterates `reposWithRulesets` - repos that have `settings.rulesets`
2. **Loop 2** (lines 217-295): Iterates `reposWithRepoSettings` - repos that have `settings.repo`

A single repo can appear in BOTH loops if it has both rulesets and repo settings configured.

Key changes needed:

1. Create a unified result collection that merges results from both loops
2. Replace `plan.resources.push(...)` calls with result collection
3. Replace `plan.errors.push(...)` calls with error tracking on results
4. Replace `printPlan(plan)` with `formatSettingsReportCLI(report)`
5. Replace `writePlanSummary(plan, ...)` with `writeSettingsReportSummary(report, ...)`
6. Remove imports from resource-converters and plan-summary

**Step 2: Update imports**

```typescript
// REMOVE these imports:
import { Plan, printPlan } from "../output/plan-formatter.js";
import { writePlanSummary } from "../output/plan-summary.js";
import {
  rulesetResultToResources,
  repoSettingsResultToResources,
} from "../settings/resource-converters.js";

// ADD these imports:
import {
  formatSettingsReportCLI,
  writeSettingsReportSummary,
} from "../output/settings-report.js";
import { buildSettingsReport } from "./settings-report-builder.js";
```

**Step 3: Create result collection helper**

Add after the processor factory calls (~line 97):

```typescript
// Replace: const plan: Plan = { resources: [], errors: [] };

interface RepoProcessingResult {
  repoName: string;
  settingsResult?: { planOutput?: { entries?: RepoSettingsPlanEntry[] } };
  rulesetResult?: { planOutput?: { entries?: RulesetPlanEntry[] } };
  error?: string;
}
const processingResults: RepoProcessingResult[] = [];

function getOrCreateResult(repoName: string): RepoProcessingResult {
  let result = processingResults.find((r) => r.repoName === repoName);
  if (!result) {
    result = { repoName };
    processingResults.push(result);
  }
  return result;
}
```

**Step 4: Update Loop 1 (rulesets)**

In the ruleset processing loop, replace these patterns:

```typescript
// REPLACE (around line 206):
plan.resources.push(...rulesetResultToResources(repoName, result));
// WITH:
getOrCreateResult(repoName).rulesetResult = result;

// REPLACE error handling (around lines 111-115 and 207-214):
plan.errors!.push({ repo: repoConfig.git, message: ... });
// WITH:
getOrCreateResult(repoConfig.git).error = error instanceof Error ? error.message : String(error);
```

**Step 5: Update Loop 2 (repo settings)**

In the repo settings loop, replace these patterns:

```typescript
// REPLACE (around line 286):
plan.resources.push(...repoSettingsResultToResources(repoName, result));
// WITH:
getOrCreateResult(repoName).settingsResult = result;

// REPLACE error handling (around lines 233-236 and 287-293):
plan.errors!.push({ repo: repoConfig.git, message: ... });
// WITH:
// Merge error if repo already has one, or set if new
const existingResult = getOrCreateResult(repoName);
if (existingResult.error) {
  existingResult.error += `; ${error instanceof Error ? error.message : String(error)}`;
} else {
  existingResult.error = error instanceof Error ? error.message : String(error);
}
```

**Step 6: Update output at end**

Replace (around lines 297-303):

```typescript
// OLD:
// console.log("");
// printPlan(plan);
// writePlanSummary(plan, { title: "Repository Settings Summary", dryRun: options.dryRun ?? false });

// NEW:
console.log("");
const report = buildSettingsReport(processingResults);
const lines = formatSettingsReportCLI(report);
for (const line of lines) {
  console.log(line);
}
writeSettingsReportSummary(report, options.dryRun ?? false);
```

**Step 7: Update exit condition**

The current code exits with error if `plan.errors.length > 0`. Update to check report:

```typescript
// OLD:
// if (plan.errors && plan.errors.length > 0) {
//   process.exit(1);
// }

// NEW:
const hasErrors = report.repos.some((r) => r.error);
if (hasErrors) {
  process.exit(1);
}
```

**Step 8: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 9: Run manually to verify output**

Run: `npm run dev -- settings --config test/fixtures/settings-test.yaml --dry-run`
Expected: New output format with repos grouped together

**Step 10: Commit**

```bash
git add src/cli/settings-command.ts
git commit -m "feat(cli): integrate SettingsReport into settings command

Replace Resource-based output with repo-centric SettingsReport.
Each repo now shows all its settings and rulesets together.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 3: Cleanup

### Task 10: Delete resource-converters.ts

**Files:**

- Delete: `src/settings/resource-converters.ts`
- Delete: `test/unit/resource-converters.test.ts`

**Step 1: Verify no remaining imports**

Run: `grep -r "resource-converters" src/`
Expected: No results (all imports removed in Task 9)

**Step 2: Delete files**

```bash
rm src/settings/resource-converters.ts
rm test/unit/resource-converters.test.ts
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete resource-converters.ts (replaced by settings-report-builder)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Delete plan-summary.ts (If Not Used by Sync)

**CRITICAL VERIFICATION:** `plan-summary.ts` and `plan-formatter.ts` are DIFFERENT files:

- `plan-summary.ts` - Has `formatPlanMarkdown()` and `writePlanSummary()` for GitHub summaries
- `plan-formatter.ts` - Has `formatPlan()` and `printPlan()` for CLI output

`sync-command.ts` imports from `plan-formatter.ts` (NOT `plan-summary.ts`).
`settings-command.ts` (before Task 9) imported from BOTH.

**Files:**

- Potentially delete: `src/output/plan-summary.ts`
- Potentially delete: `test/unit/plan-summary.test.ts`

**Step 1: Verify sync command does NOT use plan-summary**

Run: `grep -r "plan-summary" src/`

Expected: After Task 9, should return NO results (settings-command.ts was the only consumer).

Also verify sync uses plan-formatter:
Run: `grep "plan-formatter" src/cli/sync-command.ts`

Expected: Should show sync-command.ts imports from plan-formatter.ts (which we keep).

If plan-summary is used elsewhere, investigate and leave for future PR.

**Step 2: Delete if unused**

```bash
rm src/output/plan-summary.ts
rm test/unit/plan-summary.test.ts
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete plan-summary.ts (replaced by settings-report for settings command)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 12: Run Linting and Final Verification

**Files:** None (verification only)

**Step 1: Run linter**

Run: `./lint.sh`
Expected: No errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Run type check**

Run: `npm run build`
Expected: Builds successfully

**Step 4: Manual verification**

Test with a real config if available:
Run: `npm run dev -- settings --config <your-config.yaml> --dry-run`

Verify:

- Output shows repos grouped together
- Settings show `~ name: old → new` format
- Rulesets show tree structure for creates/updates
- Summary line at end

**Step 5: Commit any remaining fixes**

If any fixes were needed, commit them.

---

### Task 13: Create PR

**Step 1: Push branch**

```bash
git push -u origin feat/settings-output-redesign
```

**Step 2: Create PR**

```bash
gh pr create --title "feat(output): redesign settings command output to be repo-centric" --body "$(cat <<'EOF'
## Summary

- Replaces Resource-based output model with SettingsReport that groups changes by repository
- Each repo now shows all its settings and rulesets together instead of listing them separately
- Fixes bug where all diff lines were attached to first resource
- Cleaner output with no redundant tables

## Changes

- **New:** `src/output/settings-report.ts` - Types and formatters for new output
- **New:** `src/cli/settings-report-builder.ts` - Converts processor results to SettingsReport
- **Modified:** `src/cli/settings-command.ts` - Uses new report instead of Plan
- **Modified:** `src/settings/repo-settings/formatter.ts` - Adds oldValue/newValue to entries
- **Modified:** `src/settings/rulesets/formatter.ts` - Adds propertyDiffs/config to entries
- **Deleted:** `src/settings/resource-converters.ts` - Replaced by settings-report-builder
- **Deleted:** `src/output/plan-summary.ts` - Replaced by settings-report formatters

## Test plan

- [x] Unit tests for new formatters
- [x] Unit tests for buildSettingsReport
- [ ] Manual test with dry-run against test config
- [ ] Integration test against GitHub

## Before/After

**Before:**
```

Resources
| Resource | Action |
| ~ setting "repo/deleteBranchOnMerge" | update |
| ~ setting "repo/webCommitSignoffRequired" | update |

Diff: setting "repo/deleteBranchOnMerge"
~ deleteBranchOnMerge: false → true
~ webCommitSignoffRequired: false → true

```

**After:**
```

~ anthony-spruyt/repo-operator
~ deleteBranchOnMerge: false → true
~ webCommitSignoffRequired: false → true

Plan: 2 settings (2 to change)

```

---

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3: Enable automerge**

```bash
gh pr merge --auto --squash --delete-branch
```

---

## Summary

| Phase | Tasks | Purpose                                             |
| ----- | ----- | --------------------------------------------------- |
| 1     | 1-5   | Create new types and formatters without integration |
| 2     | 6-9   | Wire new report into settings command               |
| 3     | 10-13 | Delete old code and verify                          |

**Estimated commits:** 12-13
**Key files created:** 4 new files
**Key files deleted:** 2-3 files
**Net LOC change:** Roughly even, but much cleaner architecture
