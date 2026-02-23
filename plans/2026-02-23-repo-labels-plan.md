# Repo Labels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add declarative label management to xfg's `settings` command — create, update, rename, and delete GitHub labels to match desired state in config.

**Architecture:** Strategy pattern matching rulesets: `ILabelsStrategy` interface with `GitHubLabelsStrategy` implementation via `gh api`. Pure `diffLabels()` for comparison, `formatLabelsPlan()` for Terraform-style output. Integrated into the settings command alongside rulesets and repo-settings.

**Tech Stack:** TypeScript ESM, Node.js native test runner, `gh` CLI for GitHub API

**Design doc:** `plans/2026-02-23-repo-labels-design.md`

---

### Task 1: Add Label type to config types

**Files:**

- Modify: `src/config/types.ts`

**Step 1: Add Label interface and update settings types**

After the `GitHubRepoSettings` interface (~line 399), add:

```typescript
/**
 * GitHub label configuration.
 * @see https://docs.github.com/en/rest/issues/labels
 */
export interface Label {
  /** Hex color code (with or without #). Stripped on normalization. */
  color: string;
  /** Label description (max 100 characters) */
  description?: string;
  /** Rename target. Maps to GitHub API's new_name field. */
  new_name?: string;
}
```

Update `RawRepoSettings` (line ~447) — add `labels` alongside `rulesets`:

```typescript
export interface RawRepoSettings {
  rulesets?: Record<string, Ruleset | false> & { inherit?: boolean };
  repo?: GitHubRepoSettings | false;
  labels?: Record<string, Label | false> & { inherit?: boolean };
  deleteOrphaned?: boolean;
}
```

Update `RepoSettings` (line ~405) — add `labels`:

```typescript
export interface RepoSettings {
  /** GitHub rulesets keyed by name */
  rulesets?: Record<string, Ruleset>;
  /** GitHub repository settings */
  repo?: GitHubRepoSettings;
  /** GitHub labels keyed by name */
  labels?: Record<string, Label>;
  deleteOrphaned?: boolean;
}
```

**Step 2: Run build to verify types compile**

Run: `npm run build`
Expected: PASS (no type errors)

**Step 3: Commit**

```bash
git add src/config/types.ts
git commit -m "feat(labels): add Label type to config types"
```

---

### Task 2: Converter module (pure utilities)

**Files:**

- Create: `src/settings/labels/converter.ts`
- Create: `test/unit/labels-converter.test.ts`

**Step 1: Write the failing tests**

```typescript
// test/unit/labels-converter.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  normalizeColor,
  labelConfigToPayload,
} from "../../src/settings/labels/converter.js";

describe("normalizeColor", () => {
  test("strips # prefix", () => {
    assert.equal(normalizeColor("#d73a4a"), "d73a4a");
  });

  test("lowercases hex", () => {
    assert.equal(normalizeColor("D73A4A"), "d73a4a");
  });

  test("strips # and lowercases", () => {
    assert.equal(normalizeColor("#D73A4A"), "d73a4a");
  });

  test("passes through valid lowercase hex", () => {
    assert.equal(normalizeColor("d73a4a"), "d73a4a");
  });
});

describe("labelConfigToPayload", () => {
  test("converts label config to API payload for create", () => {
    const payload = labelConfigToPayload("bug", {
      color: "#d73a4a",
      description: "Something isn't working",
    });
    assert.deepEqual(payload, {
      name: "bug",
      color: "d73a4a",
      description: "Something isn't working",
    });
  });

  test("includes new_name when present", () => {
    const payload = labelConfigToPayload("old-name", {
      color: "d73a4a",
      new_name: "new-name",
    });
    assert.deepEqual(payload, {
      name: "old-name",
      new_name: "new-name",
      color: "d73a4a",
    });
  });

  test("omits description when undefined", () => {
    const payload = labelConfigToPayload("bug", { color: "d73a4a" });
    assert.deepEqual(payload, { name: "bug", color: "d73a4a" });
  });

  test("includes empty string description", () => {
    const payload = labelConfigToPayload("bug", {
      color: "d73a4a",
      description: "",
    });
    assert.deepEqual(payload, {
      name: "bug",
      color: "d73a4a",
      description: "",
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/labels-converter.test.ts`
Expected: FAIL (module not found)

**Step 3: Write minimal implementation**

```typescript
// src/settings/labels/converter.ts
import type { Label } from "../../config/types.js";

export interface GitHubLabelPayload {
  name: string;
  new_name?: string;
  color: string;
  description?: string;
}

/**
 * Strips '#' prefix and lowercases hex color.
 */
export function normalizeColor(color: string): string {
  return color.replace(/^#/, "").toLowerCase();
}

/**
 * Converts a label config entry to a GitHub API payload.
 */
export function labelConfigToPayload(
  name: string,
  label: Label
): GitHubLabelPayload {
  const payload: GitHubLabelPayload = {
    name,
    color: normalizeColor(label.color),
  };
  if (label.new_name !== undefined) {
    payload.new_name = label.new_name;
  }
  if (label.description !== undefined) {
    payload.description = label.description;
  }
  return payload;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/labels-converter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/settings/labels/converter.ts test/unit/labels-converter.test.ts
git commit -m "feat(labels): add converter module with normalizeColor and labelConfigToPayload"
```

---

### Task 3: Labels types module (strategy interface, API types)

**Files:**

- Create: `src/settings/labels/types.ts`

**Step 1: Write the types file**

```typescript
// src/settings/labels/types.ts
import type { RepoInfo } from "../../shared/repo-detector.js";

export interface LabelsStrategyOptions {
  token?: string;
  host?: string;
}

/**
 * GitHub label as returned by the API.
 */
export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
  default: boolean;
}

/**
 * Strategy interface for label operations.
 * Abstracts platform-specific API calls.
 */
export interface ILabelsStrategy {
  list(
    repoInfo: RepoInfo,
    options?: LabelsStrategyOptions
  ): Promise<GitHubLabel[]>;
  create(
    repoInfo: RepoInfo,
    label: { name: string; color: string; description?: string },
    options?: LabelsStrategyOptions
  ): Promise<void>;
  update(
    repoInfo: RepoInfo,
    currentName: string,
    label: { new_name?: string; color?: string; description?: string },
    options?: LabelsStrategyOptions
  ): Promise<void>;
  delete(
    repoInfo: RepoInfo,
    name: string,
    options?: LabelsStrategyOptions
  ): Promise<void>;
}
```

**Step 2: Run build to verify types compile**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/settings/labels/types.ts
git commit -m "feat(labels): add strategy interface and API types"
```

---

### Task 4: Diff logic

**Files:**

- Create: `src/settings/labels/diff.ts`
- Create: `test/unit/labels-diff.test.ts`

**Step 1: Write the failing tests**

```typescript
// test/unit/labels-diff.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  diffLabels,
  type LabelChange,
} from "../../src/settings/labels/diff.js";
import type { Label } from "../../src/config/types.js";
import type { GitHubLabel } from "../../src/settings/labels/types.js";

function makeGitHubLabel(
  overrides: Partial<GitHubLabel> & { name: string; color: string }
): GitHubLabel {
  return { id: 1, description: null, default: false, ...overrides };
}

describe("diffLabels", () => {
  describe("create", () => {
    test("identifies labels in desired but not in current as create", () => {
      const current: GitHubLabel[] = [];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "Something isn't working" },
      };

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "create");
      assert.equal(changes[0].name, "bug");
    });
  });

  describe("update", () => {
    test("identifies labels with different color as update", () => {
      const current = [makeGitHubLabel({ name: "bug", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        bug: { color: "ff0000" },
      };

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
      assert.equal(changes[0].name, "bug");
    });

    test("identifies labels with different description as update", () => {
      const current = [
        makeGitHubLabel({
          name: "bug",
          color: "d73a4a",
          description: "Old desc",
        }),
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "New desc" },
      };

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
    });

    test("rename via new_name produces update", () => {
      const current = [makeGitHubLabel({ name: "old-name", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        "old-name": { color: "d73a4a", new_name: "new-name" },
      };

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
      assert.equal(changes[0].newName, "new-name");
    });
  });

  describe("delete", () => {
    test("identifies labels in managedLabels but not in desired as delete", () => {
      const current = [makeGitHubLabel({ name: "stale", color: "cccccc" })];
      const desired: Record<string, Label> = {};

      const changes = diffLabels(current, desired, ["stale"], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "delete");
      assert.equal(changes[0].name, "stale");
    });

    test("does not delete when noDelete is true", () => {
      const current = [makeGitHubLabel({ name: "stale", color: "cccccc" })];
      const desired: Record<string, Label> = {};

      const changes = diffLabels(current, desired, ["stale"], true);

      assert.equal(changes.length, 0);
    });

    test("does not delete unmanaged labels", () => {
      const current = [makeGitHubLabel({ name: "unmanaged", color: "cccccc" })];
      const desired: Record<string, Label> = {};

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 0);
    });
  });

  describe("unchanged", () => {
    test("identifies matching labels as unchanged", () => {
      const current = [
        makeGitHubLabel({
          name: "bug",
          color: "d73a4a",
          description: "Something isn't working",
        }),
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "Something isn't working" },
      };

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
    });
  });

  describe("case insensitive matching", () => {
    test("matches label names case-insensitively", () => {
      const current = [makeGitHubLabel({ name: "Bug", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
    });

    test("color comparison is case-insensitive", () => {
      const current = [makeGitHubLabel({ name: "bug", color: "D73A4A" })];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
    });
  });

  describe("description null/undefined equivalence", () => {
    test("null description matches undefined (no update)", () => {
      const current = [
        makeGitHubLabel({ name: "bug", color: "d73a4a", description: null }),
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a" },
      };

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
    });

    test("null and empty string description are treated as equivalent (no update)", () => {
      const current = [
        makeGitHubLabel({
          name: "bug",
          color: "d73a4a",
          description: null,
        }),
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "" },
      };

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
    });

    test("explicit empty string description triggers update from non-empty", () => {
      const current = [
        makeGitHubLabel({
          name: "bug",
          color: "d73a4a",
          description: "has desc",
        }),
      ];
      const desired: Record<string, Label> = {
        bug: { color: "d73a4a", description: "" },
      };

      const changes = diffLabels(current, desired, [], false);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
    });
  });

  describe("rename collision detection", () => {
    test("errors when new_name collides with existing label not being removed", () => {
      const current = [
        makeGitHubLabel({ name: "old", color: "d73a4a" }),
        makeGitHubLabel({ id: 2, name: "new-name", color: "cccccc" }),
      ];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new-name" },
        "new-name": { color: "cccccc" },
      };

      assert.throws(
        () => diffLabels(current, desired, [], false),
        /collision|collides/i
      );
    });

    test("allows rename when target name is being deleted", () => {
      const current = [
        makeGitHubLabel({ name: "old", color: "d73a4a" }),
        makeGitHubLabel({ id: 2, name: "new-name", color: "cccccc" }),
      ];
      const desired: Record<string, Label> = {
        old: { color: "d73a4a", new_name: "new-name" },
      };

      // "new-name" is in managedLabels but not in desired -> will be deleted
      const changes = diffLabels(current, desired, ["old", "new-name"], false);

      // Should not throw
      const deleteChange = changes.find((c) => c.action === "delete");
      const updateChange = changes.find((c) => c.action === "update");
      assert.ok(deleteChange);
      assert.ok(updateChange);
    });

    test("errors on duplicate rename targets", () => {
      const current = [
        makeGitHubLabel({ name: "a", color: "aaaaaa" }),
        makeGitHubLabel({ id: 2, name: "b", color: "bbbbbb" }),
      ];
      const desired: Record<string, Label> = {
        a: { color: "aaaaaa", new_name: "target" },
        b: { color: "bbbbbb", new_name: "target" },
      };

      assert.throws(
        () => diffLabels(current, desired, [], false),
        /collision|duplicate/i
      );
    });
  });

  describe("ordering", () => {
    test("orders changes: deletes first, then updates, then creates", () => {
      const current = [
        makeGitHubLabel({ name: "delete-me", color: "cccccc" }),
        makeGitHubLabel({ id: 2, name: "update-me", color: "aaaaaa" }),
      ];
      const desired: Record<string, Label> = {
        "update-me": { color: "ffffff" },
        "create-me": { color: "000000" },
      };

      const changes = diffLabels(
        current,
        desired,
        ["delete-me", "update-me"],
        false
      );

      const actions = changes.map((c) => c.action);
      assert.deepEqual(actions, ["delete", "update", "create"]);
    });

    test("unchanged entries sort after create", () => {
      const current = [makeGitHubLabel({ name: "unchanged", color: "d73a4a" })];
      const desired: Record<string, Label> = {
        unchanged: { color: "d73a4a" },
        "new-one": { color: "000000" },
      };

      const changes = diffLabels(current, desired, [], false);

      const actions = changes.map((c) => c.action);
      assert.deepEqual(actions, ["create", "unchanged"]);
    });
  });

  describe("chain rename", () => {
    test("allows chain rename where target label is itself being renamed away", () => {
      const current = [
        makeGitHubLabel({ name: "a", color: "aaaaaa" }),
        makeGitHubLabel({ id: 2, name: "b", color: "bbbbbb" }),
      ];
      const desired: Record<string, Label> = {
        a: { color: "aaaaaa", new_name: "b" },
        b: { color: "bbbbbb", new_name: "c" },
      };

      // Should not throw — "b" is being renamed to "c", so "a" can take "b"
      const changes = diffLabels(current, desired, [], false);

      const updates = changes.filter((c) => c.action === "update");
      assert.equal(updates.length, 2);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/labels-diff.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the diff implementation**

```typescript
// src/settings/labels/diff.ts
import type { Label } from "../../config/types.js";
import type { GitHubLabel } from "./types.js";
import { normalizeColor } from "./converter.js";

export type LabelAction = "create" | "update" | "delete" | "unchanged";

export interface LabelChange {
  action: LabelAction;
  name: string;
  newName?: string;
  current?: GitHubLabel;
  desired?: Label;
  propertyChanges?: {
    property: string;
    oldValue?: string;
    newValue?: string;
  }[];
}

/**
 * Compares current labels (from GitHub) with desired labels (from config).
 *
 * Matching is case-insensitive by name (GitHub label names are case-insensitive).
 * Color comparison is case-insensitive bare hex (strip #, lowercase both sides).
 * Description: undefined in config means "do not compare" (leave current value).
 * An explicit empty string "" means "set to empty."
 * GitHub API returns null for labels without descriptions — treat null and
 * undefined as equivalent when comparing (neither triggers an update).
 *
 * @param current - Current labels from GitHub API
 * @param desired - Desired labels from config (name -> label)
 * @param managedLabels - Names of labels managed by xfg (from manifest)
 * @param noDelete - If true, skip delete operations
 * @returns Array of changes to apply
 * @throws Error if rename collisions are detected
 */
export function diffLabels(
  current: GitHubLabel[],
  desired: Record<string, Label>,
  managedLabels: string[],
  noDelete: boolean
): LabelChange[] {
  const changes: LabelChange[] = [];

  // Build case-insensitive lookup of current labels
  const currentByName = new Map<string, GitHubLabel>();
  for (const label of current) {
    currentByName.set(label.name.toLowerCase(), label);
  }

  const managedSet = new Set(managedLabels.map((n) => n.toLowerCase()));

  // Collect rename targets for collision detection
  const renameTargets = new Map<string, string>(); // lowercase target -> source name
  for (const [name, label] of Object.entries(desired)) {
    if (label.new_name) {
      const targetLower = label.new_name.toLowerCase();
      if (renameTargets.has(targetLower)) {
        throw new Error(
          `Rename collision: both '${renameTargets.get(targetLower)}' and '${name}' rename to '${label.new_name}'`
        );
      }
      renameTargets.set(targetLower, name);
    }
  }

  // Determine which labels will be deleted (for collision checking)
  const desiredLower = new Set(
    Object.keys(desired).map((n) => n.toLowerCase())
  );
  const deletedNames = new Set<string>();
  if (!noDelete) {
    for (const name of managedSet) {
      if (!desiredLower.has(name) && currentByName.has(name)) {
        deletedNames.add(name);
      }
    }
  }

  // Check rename targets for collisions with existing labels
  for (const [name, label] of Object.entries(desired)) {
    if (!label.new_name) continue;
    const targetLower = label.new_name.toLowerCase();
    const nameLower = name.toLowerCase();

    // Check if target collides with an existing label that is NOT:
    // 1. The source label itself
    // 2. Being deleted in this diff
    // 3. Being renamed away in this diff
    if (
      currentByName.has(targetLower) &&
      targetLower !== nameLower &&
      !deletedNames.has(targetLower)
    ) {
      const collidingDesired = Object.entries(desired).find(
        ([n]) => n.toLowerCase() === targetLower
      );
      if (!collidingDesired || !collidingDesired[1].new_name) {
        throw new Error(
          `Rename collision: '${name}' would rename to '${label.new_name}', but that label already exists`
        );
      }
    }
  }

  // Check each desired label
  for (const [name, desiredLabel] of Object.entries(desired)) {
    const nameLower = name.toLowerCase();
    const currentLabel = currentByName.get(nameLower);

    if (!currentLabel) {
      changes.push({
        action: "create",
        name,
        desired: desiredLabel,
      });
    } else {
      const propChanges: LabelChange["propertyChanges"] = [];
      const desiredColor = normalizeColor(desiredLabel.color);
      const currentColor = currentLabel.color.toLowerCase();

      if (desiredColor !== currentColor) {
        propChanges.push({
          property: "color",
          oldValue: currentLabel.color,
          newValue: desiredColor,
        });
      }

      // Description: undefined = don't compare, explicit value = compare
      if (desiredLabel.description !== undefined) {
        const currentDesc = currentLabel.description ?? "";
        if (desiredLabel.description !== currentDesc) {
          propChanges.push({
            property: "description",
            oldValue: currentLabel.description ?? undefined,
            newValue: desiredLabel.description,
          });
        }
      }

      // new_name always triggers an update
      if (desiredLabel.new_name) {
        propChanges.push({
          property: "new_name",
          oldValue: name,
          newValue: desiredLabel.new_name,
        });
      }

      if (propChanges.length > 0) {
        changes.push({
          action: "update",
          name,
          newName: desiredLabel.new_name,
          current: currentLabel,
          desired: desiredLabel,
          propertyChanges: propChanges,
        });
      } else {
        changes.push({
          action: "unchanged",
          name,
          current: currentLabel,
          desired: desiredLabel,
        });
      }
    }
  }

  // Check for orphaned labels (in manifest but not in desired config)
  if (!noDelete) {
    for (const name of managedSet) {
      if (!desiredLower.has(name)) {
        const currentLabel = currentByName.get(name);
        if (currentLabel) {
          changes.push({
            action: "delete",
            name: currentLabel.name,
            current: currentLabel,
          });
        }
      }
    }
  }

  // Sort: delete first, then update, then create, then unchanged
  const actionOrder: Record<LabelAction, number> = {
    delete: 0,
    update: 1,
    create: 2,
    unchanged: 3,
  };

  return changes.sort((a, b) => actionOrder[a.action] - actionOrder[b.action]);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/labels-diff.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/settings/labels/diff.ts test/unit/labels-diff.test.ts
git commit -m "feat(labels): add diff logic with case-insensitive matching and rename collision detection"
```

---

### Task 5: Formatter module

**Files:**

- Create: `src/settings/labels/formatter.ts`
- Create: `test/unit/labels-formatter.test.ts`

**Step 1: Write the failing tests**

```typescript
// test/unit/labels-formatter.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatLabelsPlan } from "../../src/settings/labels/formatter.js";
import type { LabelChange } from "../../src/settings/labels/diff.js";

// Strip ANSI escape codes for assertion
function stripAnsi(str: string): string {
  return str.replace(
    new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g"),
    ""
  );
}

describe("formatLabelsPlan", () => {
  test("formats create action", () => {
    const changes: LabelChange[] = [
      {
        action: "create",
        name: "deploy",
        desired: { color: "0e8a16", description: "Deployment related" },
      },
    ];

    const result = formatLabelsPlan(changes);

    assert.equal(result.creates, 1);
    assert.equal(result.updates, 0);
    assert.equal(result.deletes, 0);
    assert.ok(
      result.lines.some((l) => stripAnsi(l).includes('label "deploy"'))
    );
    assert.ok(result.lines.some((l) => stripAnsi(l).includes("0e8a16")));
  });

  test("formats update action with property changes", () => {
    const changes: LabelChange[] = [
      {
        action: "update",
        name: "bug",
        desired: { color: "ff0000" },
        propertyChanges: [
          { property: "color", oldValue: "d73a4a", newValue: "ff0000" },
        ],
      },
    ];

    const result = formatLabelsPlan(changes);

    assert.equal(result.updates, 1);
    assert.ok(result.lines.some((l) => stripAnsi(l).includes('label "bug"')));
  });

  test("formats rename", () => {
    const changes: LabelChange[] = [
      {
        action: "update",
        name: "old-name",
        newName: "new-name",
        desired: { color: "d73a4a", new_name: "new-name" },
        propertyChanges: [
          { property: "new_name", oldValue: "old-name", newValue: "new-name" },
        ],
      },
    ];

    const result = formatLabelsPlan(changes);

    assert.equal(result.updates, 1);
    const renamed = result.entries.find((e) => e.newName === "new-name");
    assert.ok(renamed);
  });

  test("formats delete action", () => {
    const changes: LabelChange[] = [{ action: "delete", name: "stale" }];

    const result = formatLabelsPlan(changes);

    assert.equal(result.deletes, 1);
    assert.ok(result.lines.some((l) => stripAnsi(l).includes('label "stale"')));
  });

  test("counts unchanged", () => {
    const changes: LabelChange[] = [
      {
        action: "unchanged",
        name: "bug",
        desired: { color: "d73a4a" },
      },
    ];

    const result = formatLabelsPlan(changes);

    assert.equal(result.unchanged, 1);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].action, "unchanged");
  });

  test("summary line includes counts", () => {
    const changes: LabelChange[] = [
      { action: "create", name: "a", desired: { color: "000000" } },
      {
        action: "update",
        name: "b",
        desired: { color: "111111" },
        propertyChanges: [
          { property: "color", oldValue: "222222", newValue: "111111" },
        ],
      },
      { action: "delete", name: "c" },
    ];

    const result = formatLabelsPlan(changes);

    assert.equal(result.creates, 1);
    assert.equal(result.updates, 1);
    assert.equal(result.deletes, 1);
    const summary = result.lines.find((l) =>
      stripAnsi(l).includes("to create")
    );
    assert.ok(summary);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/labels-formatter.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the formatter implementation**

```typescript
// src/settings/labels/formatter.ts
import chalk from "chalk";
import type { LabelChange, LabelAction } from "./diff.js";
import type { Label } from "../../config/types.js";

export interface LabelsPlanEntry {
  name: string;
  action: LabelAction;
  newName?: string;
  propertyChanges?: {
    property: string;
    oldValue?: string;
    newValue?: string;
  }[];
  config?: Label;
}

export interface LabelsPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  entries: LabelsPlanEntry[];
}

/**
 * Format label changes as a Terraform-style plan.
 */
export function formatLabelsPlan(changes: LabelChange[]): LabelsPlanResult {
  const lines: string[] = [];
  const entries: LabelsPlanEntry[] = [];

  const createChanges = changes.filter((c) => c.action === "create");
  const updateChanges = changes.filter((c) => c.action === "update");
  const deleteChanges = changes.filter((c) => c.action === "delete");
  const unchangedChanges = changes.filter((c) => c.action === "unchanged");

  const creates = createChanges.length;
  const updates = updateChanges.length;
  const deletes = deleteChanges.length;
  const unchanged = unchangedChanges.length;

  // Format creates
  if (createChanges.length > 0) {
    lines.push(chalk.bold("  Create:"));
    for (const change of createChanges) {
      lines.push(chalk.green(`    + label "${change.name}"`));
      if (change.desired) {
        lines.push(chalk.green(`        color: "${change.desired.color}"`));
        if (change.desired.description !== undefined) {
          lines.push(
            chalk.green(`        description: "${change.desired.description}"`)
          );
        }
      }
      entries.push({
        name: change.name,
        action: "create",
        config: change.desired,
      });
      lines.push("");
    }
  }

  // Format updates
  if (updateChanges.length > 0) {
    lines.push(chalk.bold("  Update:"));
    for (const change of updateChanges) {
      if (change.newName) {
        lines.push(
          chalk.yellow(
            `    ~ label "${change.name}" \u2192 "${change.newName}"`
          )
        );
      } else {
        lines.push(chalk.yellow(`    ~ label "${change.name}"`));
      }
      if (change.propertyChanges) {
        for (const prop of change.propertyChanges) {
          if (prop.property === "new_name") continue; // shown in header
          if (prop.oldValue !== undefined) {
            lines.push(
              chalk.yellow(
                `        ${prop.property}: "${prop.oldValue}" \u2192 "${prop.newValue}"`
              )
            );
          } else {
            lines.push(
              chalk.yellow(`        ${prop.property}: "${prop.newValue}"`)
            );
          }
        }
      }
      entries.push({
        name: change.name,
        action: "update",
        newName: change.newName,
        propertyChanges: change.propertyChanges,
      });
      lines.push("");
    }
  }

  // Format deletes
  if (deleteChanges.length > 0) {
    lines.push(chalk.bold("  Delete:"));
    for (const change of deleteChanges) {
      lines.push(chalk.red(`    - label "${change.name}"`));
      entries.push({ name: change.name, action: "delete" });
    }
    lines.push("");
  }

  // Unchanged (entries only, no output lines)
  for (const change of unchangedChanges) {
    entries.push({ name: change.name, action: "unchanged" });
  }

  // Summary line
  const total = creates + updates + deletes;
  if (total > 0) {
    const parts: string[] = [];
    if (creates > 0) parts.push(`${creates} to create`);
    if (updates > 0) parts.push(`${updates} to update`);
    if (deletes > 0) parts.push(`${deletes} to delete`);
    lines.push(`  Plan: ${total} labels (${parts.join(", ")})`);
  }

  return { lines, creates, updates, deletes, unchanged, entries };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/labels-formatter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/settings/labels/formatter.ts test/unit/labels-formatter.test.ts
git commit -m "feat(labels): add Terraform-style plan formatter"
```

---

### Task 6: GitHub Labels Strategy

**Files:**

- Create: `src/settings/labels/github-labels-strategy.ts`

**Step 1: Write the strategy implementation**

Follow the same pattern as `src/settings/rulesets/github-ruleset-strategy.ts`. Use `ICommandExecutor` from `../../shared/command-executor.js` for shell command execution (the project's safe executor pattern). Use `escapeShellArg` from `../../shared/shell-utils.js` for input sanitization. Use `encodeURIComponent()` for label names in PATCH/DELETE URL paths. Use `--paginate` on the list endpoint. Wrap every API call in `withRetry` from `../../shared/retry-utils.js` (matching the rulesets strategy pattern for transient failure resilience).

**Step 2: Run build to verify it compiles**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/settings/labels/github-labels-strategy.ts
git commit -m "feat(labels): add GitHub labels strategy using gh api with pagination"
```

---

### Task 7: Labels Processor

**Files:**

- Create: `src/settings/labels/processor.ts`
- Create: `test/unit/labels-processor.test.ts`

**Step 1: Write the failing tests**

Test cases:

- Skips non-GitHub repos
- Creates new labels
- Dry run does not call strategy mutations
- Applies changes in correct order: deletes, updates, creates
- Returns manifest update when deleteOrphaned is true
- Returns no manifest update when deleteOrphaned is false
- Handles API errors gracefully

Use a `MockLabelsStrategy` class that tracks method calls (same pattern as `test/unit/ruleset-processor.test.ts`).

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/labels-processor.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the processor implementation**

Follow the same pattern as `src/settings/rulesets/processor.ts`:

- Export `ILabelsProcessor` interface, `LabelsProcessorOptions` type, and `LabelsProcessorResult` type as named exports (required by Task 8 barrel and Task 14 CLI types)
- Constructor takes optional `ILabelsStrategy` (defaults to `GitHubLabelsStrategy`)
- Constructor checks `hasGitHubAppCredentials()` for `GitHubAppTokenManager`
- `process()` method: skip non-GitHub, fetch current, diff, format plan, apply if not dry-run
- Apply ordering: deletes first, then updates, then creates
- `computeManifestUpdate()` returns `{ labels: string[] }` when `deleteOrphaned` is true

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/labels-processor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/settings/labels/processor.ts test/unit/labels-processor.test.ts
git commit -m "feat(labels): add labels processor with strategy pattern and manifest support"
```

---

### Task 8: Barrel exports (index.ts)

**Files:**

- Create: `src/settings/labels/index.ts`
- Modify: `src/settings/index.ts`

**Step 1: Write the barrel exports**

```typescript
// src/settings/labels/index.ts

// Types
export type {
  ILabelsStrategy,
  GitHubLabel,
  LabelsStrategyOptions,
} from "./types.js";

// Converter
export {
  normalizeColor,
  labelConfigToPayload,
  type GitHubLabelPayload,
} from "./converter.js";

// Diff
export { diffLabels, type LabelChange, type LabelAction } from "./diff.js";

// Formatter
export {
  formatLabelsPlan,
  type LabelsPlanResult,
  type LabelsPlanEntry,
} from "./formatter.js";

// Processor
export {
  LabelsProcessor,
  type ILabelsProcessor,
  type LabelsProcessorOptions,
  type LabelsProcessorResult,
} from "./processor.js";

// Strategy
export { GitHubLabelsStrategy } from "./github-labels-strategy.js";
```

**Step 2: Update `src/settings/index.ts` parent barrel**

Add `export * from "./labels/index.js";` to `src/settings/index.ts` (matching the existing `export * from "./rulesets/index.js"` and `export * from "./repo-settings/index.js"` pattern).

**Step 3: Run build to verify**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/settings/labels/index.ts src/settings/index.ts
git commit -m "feat(labels): add barrel exports"
```

---

### Task 9: Config schema (JSON schema)

**Files:**

- Modify: `config-schema.json`

**Step 1: Read the current schema**

Read `config-schema.json` to find where definitions and `repoSettings` are defined.

**Step 2: Add label definition**

Add a `label` definition to the `definitions` section:

```json
"label": {
  "type": "object",
  "description": "GitHub label configuration",
  "required": ["color"],
  "properties": {
    "color": {
      "type": "string",
      "pattern": "^#?[0-9a-fA-F]{6}$",
      "description": "Hex color code (with or without #). Example: 'd73a4a' or '#d73a4a'"
    },
    "description": {
      "type": "string",
      "maxLength": 100,
      "description": "Label description (max 100 characters)"
    },
    "new_name": {
      "type": "string",
      "description": "Rename this label. Maps to GitHub API's new_name field."
    }
  }
}
```

**Step 3: Add labels to repoSettings**

Add `labels` property to the `repoSettings` definition alongside `rulesets`:

```json
"labels": {
  "type": "object",
  "description": "Map of label names to configurations. Set a label to false to opt out. Set inherit: false to skip all inherited labels.",
  "properties": {
    "inherit": {
      "type": "boolean",
      "description": "Set to false to skip all inherited root labels. Default: true"
    }
  },
  "additionalProperties": {
    "oneOf": [
      {
        "type": "boolean",
        "const": false,
        "description": "Set to false to opt out of this inherited label"
      },
      {
        "$ref": "#/definitions/label"
      }
    ]
  }
}
```

**Step 4: Commit**

```bash
git add config-schema.json
git commit -m "feat(labels): add label definition to JSON schema"
```

---

### Task 10: Config validator — add label validation

**Files:**

- Modify: `src/config/validator.ts`
- Modify: `test/unit/config-validator.test.ts`

**Step 1: Write failing tests for label validation**

Add tests to `test/unit/config-validator.test.ts` in a new `describe("labels validation")` block:

- Test: valid label config passes validation
- Test: invalid color format (not 6-char hex) throws
- Test: description over 100 chars throws
- Test: `inherit` at root labels level throws (`"'inherit' is a reserved key and cannot be used as a label name"`)
- Test: opt-out of non-existent root label throws
- Test: `validateForSettings` passes with labels-only config
- Test: `hasActionableSettings` returns true for labels-only settings

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/config-validator.test.ts`
Expected: FAIL (new tests fail because labels validation doesn't exist yet)

**Step 3: Implement label validation**

In `src/config/validator.ts`:

1. Add a `validateLabel()` function:

   ```typescript
   function validateLabel(label: unknown, name: string, context: string): void {
     if (typeof label !== "object" || label === null || Array.isArray(label)) {
       throw new Error(`${context}: label '${name}' must be an object`);
     }
     const l = label as Record<string, unknown>;
     if (typeof l.color !== "string" || !/^#?[0-9a-fA-F]{6}$/.test(l.color)) {
       throw new Error(
         `${context}: label '${name}' color must be a 6-character hex code (with or without #)`
       );
     }
     if (l.description !== undefined) {
       if (typeof l.description !== "string") {
         throw new Error(
           `${context}: label '${name}' description must be a string`
         );
       }
       if (l.description.length > 100) {
         throw new Error(
           `${context}: label '${name}' description exceeds 100 characters (GitHub limit)`
         );
       }
     }
     if (l.new_name !== undefined && typeof l.new_name !== "string") {
       throw new Error(`${context}: label '${name}' new_name must be a string`);
     }
   }
   ```

2. Update `validateSettings()` — add labels validation block after rulesets:

   ```typescript
   if (s.labels !== undefined) {
     if (
       typeof s.labels !== "object" ||
       s.labels === null ||
       Array.isArray(s.labels)
     ) {
       throw new Error(`${context}: labels must be an object`);
     }
     const labels = s.labels as Record<string, unknown>;
     for (const [name, label] of Object.entries(labels)) {
       if (name === "inherit") continue;
       if (label === false) {
         if (rootLabelNames && !rootLabelNames.includes(name)) {
           throw new Error(
             `${context}: Cannot opt out of label '${name}' - not defined in root settings.labels`
           );
         }
         continue;
       }
       validateLabel(label, name, context);
     }
   }
   ```

3. Update `validateSettings()` signature — add `rootLabelNames?: string[]` as the **5th parameter** (after `hasRootRepoSettings?: boolean`). This position preserves all existing 4-argument call sites without changes:

   ```typescript
   export function validateSettings(
     settings: unknown,
     context: string,
     rootRulesetNames?: string[],
     hasRootRepoSettings?: boolean,
     rootLabelNames?: string[] // <-- new, 5th parameter
   ): void;
   ```

4. Update calls to `validateSettings()` in `validateRawConfig()`:
   - Root level: pass no `rootLabelNames`
   - Per-repo level: extract root label names and pass them

5. Update `validateRawConfig()` root settings check — add `inherit` check for root labels:

   ```typescript
   if (config.settings.labels && "inherit" in config.settings.labels) {
     throw new Error(
       "'inherit' is a reserved key and cannot be used as a label name"
     );
   }
   ```

6. Update `hasActionableSettings()` — filter out the `inherit` key (matching the rulesets pattern) to avoid false positives when only `labels: { inherit: false }` is set:

   ```typescript
   if (
     settings.labels &&
     Object.keys(settings.labels).filter((k) => k !== "inherit").length > 0
   ) {
     return true;
   }
   ```

7. Update `validateForSettings()` error message — change `"Currently supported: rulesets"` to `"Currently supported: rulesets, labels"` (and include `repo` if already listed).

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/config-validator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/validator.ts test/unit/config-validator.test.ts
git commit -m "feat(labels): add label validation to config validator"
```

---

### Task 11: Config normalizer — add labels merge logic

**Files:**

- Modify: `src/config/normalizer.ts`
- Modify: `test/unit/config-normalizer.test.ts`

**Step 1: Write failing tests for labels merge**

Add tests to `test/unit/config-normalizer.test.ts`:

- Test: `mergeSettings` merges root and per-repo labels (per-repo overrides root color)
- Test: `mergeSettings` handles `inherit: false` for labels (skips all root labels)
- Test: `mergeSettings` handles individual label opt-out (`label: false`)
- Test: `mergeSettings` per-repo label overrides root label properties
- Test: `normalizeConfig` strips `#` from color values during normalization
- Test: root labels are preserved in `Config.settings.labels`
- Test: per-repo-only labels appear without root labels

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/config-normalizer.test.ts`
Expected: FAIL (new tests fail)

**Step 3: Implement labels merge logic**

In `src/config/normalizer.ts`:

1. Import `Label` type.

2. Add `mergeLabels()` helper:

   ```typescript
   function mergeLabels(
     rootLabels: Record<string, unknown> | undefined,
     repoLabels: Record<string, unknown> | undefined
   ): Record<string, Label> | undefined {
     if (!rootLabels && !repoLabels) return undefined;

     const root = rootLabels ?? {};
     const repo = repoLabels ?? {};
     const inheritLabels = (repo as Record<string, unknown>)?.inherit !== false;

     const allLabelNames = new Set([
       ...Object.keys(root).filter((name) => name !== "inherit"),
       ...Object.keys(repo).filter((name) => name !== "inherit"),
     ]);

     if (allLabelNames.size === 0) return undefined;

     const result: Record<string, Label> = {};
     for (const name of allLabelNames) {
       const rootLabel = root[name];
       const repoLabel = repo[name];

       if (repoLabel === false) continue;
       if (!inheritLabels && !repoLabel && rootLabel) continue;

       const merged: Label = {
         ...((rootLabel && rootLabel !== false ? rootLabel : {}) as Label),
         ...((repoLabel && repoLabel !== false ? repoLabel : {}) as Label),
       };
       // Strip # from color
       merged.color = merged.color.replace(/^#/, "").toLowerCase();
       result[name] = merged;
     }

     return Object.keys(result).length > 0 ? result : undefined;
   }
   ```

3. Update `mergeSettings()` to call `mergeLabels()`:

   ```typescript
   // After rulesets merge, add:
   const mergedLabels = mergeLabels(
     root?.labels as Record<string, unknown> | undefined,
     perRepo?.labels as Record<string, unknown> | undefined
   );
   if (mergedLabels) {
     result.labels = mergedLabels;
   }
   ```

4. Update root settings normalization block (lines ~311-334) to handle `raw.settings.labels`:
   ```typescript
   if (raw.settings.labels) {
     const filteredLabels: Record<string, Label> = {};
     for (const [name, label] of Object.entries(raw.settings.labels)) {
       if (name === "inherit" || label === false) continue;
       const l = label as Label;
       filteredLabels[name] = {
         ...l,
         color: l.color.replace(/^#/, "").toLowerCase(),
       };
     }
     if (Object.keys(filteredLabels).length > 0) {
       normalizedRootSettings.labels = filteredLabels;
     }
   }
   ```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/config-normalizer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat(labels): add labels merge logic to config normalizer"
```

---

### Task 12: Manifest — add labels tracking

**Files:**

- Modify: `src/sync/manifest.ts`
- Modify: `test/unit/manifest.test.ts`

**Step 1: Write failing tests**

Add tests to `test/unit/manifest.test.ts`:

- Test: `getManagedLabels` returns labels from manifest
- Test: `getManagedLabels` returns empty array for null manifest
- Test: `updateManifestLabels` adds labels to manifest, preserving files and rulesets
- Test: `updateManifestLabels` detects orphaned labels
- Test: `updateManifest` preserves labels sibling when updating files
- Test: `updateManifestRulesets` preserves labels sibling when updating rulesets

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/manifest.test.ts`
Expected: FAIL

**Step 3: Implement manifest label support**

In `src/sync/manifest.ts`:

1. Add `labels?: string[]` to `XfgManifestConfigEntry`.

2. Add `getManagedLabels()`:

   ```typescript
   export function getManagedLabels(
     manifest: XfgManifest | null,
     configId: string
   ): string[] {
     if (!manifest) return [];
     return [...(manifest.configs[configId]?.labels ?? [])];
   }
   ```

3. Add `updateManifestLabels()` — preserves both `files` and `rulesets` siblings:

   ```typescript
   export function updateManifestLabels(
     manifest: XfgManifest | null,
     configId: string,
     labelsWithDeleteOrphaned: Map<string, boolean | undefined>
   ): { manifest: XfgManifest; labelsToDelete: string[] } {
     const existingManaged = new Set(getManagedLabels(manifest, configId));
     const newManaged = new Set<string>();
     const labelsToDelete: string[] = [];

     for (const [labelName, deleteOrphaned] of labelsWithDeleteOrphaned) {
       if (deleteOrphaned === true) {
         newManaged.add(labelName);
       }
     }

     for (const labelName of existingManaged) {
       if (!labelsWithDeleteOrphaned.has(labelName)) {
         labelsToDelete.push(labelName);
       }
     }

     const updatedConfigs: Record<string, XfgManifestConfigEntry> = {
       ...(manifest?.configs ?? {}),
     };

     const existingEntry = manifest?.configs[configId];
     const existingFiles = existingEntry?.files;
     const existingRulesets = existingEntry?.rulesets;
     const sortedManaged = Array.from(newManaged).sort();

     if (
       sortedManaged.length > 0 ||
       (existingFiles && existingFiles.length > 0) ||
       (existingRulesets && existingRulesets.length > 0)
     ) {
       updatedConfigs[configId] = {
         ...(existingFiles && existingFiles.length > 0
           ? { files: existingFiles }
           : {}),
         ...(existingRulesets && existingRulesets.length > 0
           ? { rulesets: existingRulesets }
           : {}),
         ...(sortedManaged.length > 0 ? { labels: sortedManaged } : {}),
       };
     } else {
       delete updatedConfigs[configId];
     }

     return {
       manifest: { version: 3, configs: updatedConfigs },
       labelsToDelete,
     };
   }
   ```

4. Update `updateManifest()` — preserve `labels` alongside `rulesets`:

   ```typescript
   const existingLabels = existingEntry?.labels;
   // Include in entry construction:
   ...(existingLabels && existingLabels.length > 0 ? { labels: existingLabels } : {}),
   ```

5. Update `updateManifestRulesets()` — preserve `labels` alongside `files`:
   ```typescript
   const existingLabels = existingEntry?.labels;
   // Include in entry construction:
   ...(existingLabels && existingLabels.length > 0 ? { labels: existingLabels } : {}),
   ```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/manifest.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sync/manifest.ts test/unit/manifest.test.ts
git commit -m "feat(labels): add labels tracking to manifest with three-way sibling preservation"
```

---

### Task 13: Manifest strategy and repository processor — update for labels

**Files:**

- Modify: `src/sync/manifest-strategy.ts`
- Modify: `src/sync/repository-processor.ts`
- Modify: `src/sync/types.ts`
- Modify: `src/cli/types.ts`

**Step 1: Update ManifestUpdateParams**

In `src/sync/manifest-strategy.ts`:

```typescript
export interface ManifestUpdateParams {
  rulesets?: string[];
  labels?: string[];
}
```

**Step 2: Update ManifestStrategy to handle labels**

Import `updateManifestLabels` from `./manifest.js`. Update `execute()`:

- **IMPORTANT:** Since `rulesets` is now optional on `ManifestUpdateParams`, the existing `this.params.rulesets.map(...)` call in `execute()` will become a TypeScript error. Guard ALL existing `this.params.rulesets` accesses with `if (this.params.rulesets)` checks.
- When only `this.params.rulesets` is present, call `updateManifestRulesets()` (current behavior, now inside guard)
- When only `this.params.labels` is present, call `updateManifestLabels()`. Build the `Map<string, boolean | undefined>` for labels using the same pattern as rulesets: `new Map(this.params.labels.map((name) => [name, true]))`.
- When both are present, apply **sequentially**: call `updateManifestRulesets()` first (guarded), then pass the resulting manifest to `updateManifestLabels()`.
- Note: `rulesetsToDelete` and `labelsToDelete` from the return values are not used downstream (the current rulesets implementation already discards `rulesetsToDelete`) — discard them.
- Make commit message dynamic based on which params are present:
  1. Rulesets only → `"chore: update manifest with ruleset tracking"` (preserve existing message)
  2. Labels only → `"chore: update manifest with labels tracking"`
  3. Both → `"chore: update manifest with ruleset/labels tracking"`

**Step 3: Update IRepositoryProcessor signature**

In `src/sync/types.ts` (line ~317-323) and `src/cli/types.ts` (line ~27-32), update `updateManifestOnly()`:

```typescript
manifestUpdate: { rulesets?: string[]; labels?: string[] }
```

**Step 4: Update RepositoryProcessor.updateManifestOnly() — method signature AND pre-check logic**

In `src/sync/repository-processor.ts`:

1. **Update the method signature** (line ~122) — change the `manifestUpdate` parameter type from `{ rulesets: string[] }` to `{ rulesets?: string[]; labels?: string[] }` to match the updated interface.

2. **Update the pre-check logic** (lines ~118-148):
   - Import `updateManifestLabels` alongside `updateManifestRulesets`
   - **IMPORTANT:** The existing `manifestUpdate.rulesets.map(...)` call (line ~129-130) will become a TypeScript error since `rulesets` is now `string[] | undefined`. Guard it with `if (manifestUpdate.rulesets)` before calling `updateManifestRulesets()`. This is the same guard pattern required in `ManifestStrategy.execute()` (Step 2 above).
   - For the "would anything change?" pre-check: when both rulesets and labels are present, simulate the combined update **sequentially** — call `updateManifestRulesets()` first on the loaded manifest (guarded), then call `updateManifestLabels()` on the resulting manifest (guarded). Compare the final result against the original to determine if a write is needed.
   - When only one of rulesets/labels is present, the pre-check runs just that one update function (existing behavior for rulesets-only).
   - Only skip if the final manifest equals the original (neither update changed anything)
   - Pass the full `manifestUpdate` to `ManifestStrategy`

**Step 5: Run build and existing tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/sync/manifest-strategy.ts src/sync/repository-processor.ts src/sync/types.ts src/cli/types.ts
git commit -m "feat(labels): update manifest strategy and repository processor for labels support"
```

---

### Task 14: CLI types — add LabelsProcessorFactory

**Files:**

- Modify: `src/cli/types.ts`

**Step 1: Add factory type and default**

Note: `src/cli/types.ts` was also modified in Task 13 (Step 3). These additions are **additive** on top of those changes — do not revert the `updateManifestOnly` signature change from Task 13.

Add to `src/cli/types.ts`:

```typescript
import {
  LabelsProcessor,
  type ILabelsProcessor,
} from "../settings/labels/processor.js";

export type LabelsProcessorFactory = () => ILabelsProcessor;

export const defaultLabelsProcessorFactory: LabelsProcessorFactory = () =>
  new LabelsProcessor();

export type { ILabelsProcessor };
```

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/cli/types.ts
git commit -m "feat(labels): add LabelsProcessorFactory to CLI types"
```

---

### Task 15: Settings command — wire labels processing

**Files:**

- Modify: `src/cli/settings-command.ts`

**Step 1: Add imports and processLabels function**

Add imports:

```typescript
import { getManagedLabels } from "../sync/manifest.js";
import {
  LabelsProcessorFactory,
  defaultLabelsProcessorFactory,
  ILabelsProcessor,
} from "./types.js";
```

Add `processLabels()` function — follow `processRepoSettings()` pattern with find-and-merge for results. Key behaviors:

- Accept an `indexOffset` parameter for correct `[x/n]` logger position numbering (same pattern as `processRepoSettings()`) — the offset should be the sum of preceding repo counts (rulesets + repo-settings repos)
- Skip non-GitHub repos with `logger.skip()`
- Get `managedLabels` via `getManagedLabels(null, config.id)` — note: this mirrors the rulesets pattern of passing `null` (manifest is written downstream by `updateManifestOnly` but not loaded here). This means orphan deletion via manifest tracking requires two runs: the first run writes the manifest, the second run would need to load it. This is a known limitation shared with rulesets and can be addressed in a follow-up.
- Call `processor.process(...)`, log plan output with header `${repoName} - Labels:`
- If `result.manifestUpdate?.labels?.length > 0`, call `repoProcessor.updateManifestOnly(...)` with `{ labels: result.manifestUpdate.labels }` (branch: `chore/sync-labels`). Note: repos with both rulesets and labels will produce separate manifest PRs on different branches (`chore/sync-rulesets` vs `chore/sync-labels`). This mirrors the rulesets pattern; consolidation into a single manifest PR can be addressed in a follow-up.
- Use find-and-merge pattern: check if repo already exists in `results` array
- Set `collector.getOrCreate(repoName).labelsResult = result`

**Step 2: Update runSettings()**

- Add `labelsProcessorFactory` parameter as the 4th parameter (before `lifecycleManager` which has no default), with default: `defaultLabelsProcessorFactory`
- Add `reposWithLabels` filter:
  ```typescript
  const reposWithLabels = config.repos.filter(
    (r) => r.settings?.labels && Object.keys(r.settings.labels).length > 0
  );
  ```
- Update three-way emptiness check
- Update log messages and `logger.setTotal()` to include labels
- Add labels repos to `allRepos` for lifecycle checks
- Call `processLabels()` after `processRepoSettings()`
- Update "no settings" message to mention labels

**Step 3: Run build and tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cli/settings-command.ts
git commit -m "feat(labels): wire labels processing into settings command"
```

---

### Task 16: Settings report — add labels types and display

> **Note:** This task MUST come before Task 17 (report builder) because Task 17 imports `LabelChange` from `settings-report.ts` and uses `labels` on `RepoChanges` and `SettingsReport.totals`.

**Files:**

- Modify: `src/output/settings-report.ts`

**Step 1: Add LabelChange type and update interfaces**

Import `Label` type. Add `LabelChange`:

```typescript
export interface LabelChange {
  name: string;
  action: "create" | "update" | "delete";
  newName?: string;
  propertyChanges?: {
    property: string;
    oldValue?: string;
    newValue?: string;
  }[];
  config?: Label;
}
```

Add `labels: LabelChange[]` to `RepoChanges`.

Add `labels: { create: number; update: number; delete: number }` to `SettingsReport.totals`.

**Step 2: Update formatSettingsReportCLI**

Add labels rendering after rulesets section. Update empty-repo guard to include `repo.labels.length === 0`. Update `formatSummary()` to include labels totals.

**Step 3: Update formatSettingsReportMarkdown**

Add labels rendering in the markdown diff block. Update empty-repo guard.

**Step 4: Run build and tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/settings-report.ts
git commit -m "feat(labels): add labels to settings report CLI and markdown formatters"
```

---

### Task 17: Report builder — add labels support

> **Note:** This task depends on Task 16 which defines `LabelChange` on `RepoChanges` and `labels` on `SettingsReport.totals`.

**Files:**

- Modify: `src/cli/settings-report-builder.ts`

**Step 1: Update ProcessorResults and buildSettingsReport**

Add imports:

```typescript
import type { LabelsPlanEntry } from "../settings/labels/formatter.js";
import type { LabelChange } from "../output/settings-report.js";
```

Add `labelsResult` to `ProcessorResults`:

```typescript
labelsResult?: {
  planOutput?: {
    entries?: LabelsPlanEntry[];
  };
};
```

Add `labels: { create: 0, update: 0, delete: 0 }` to the `totals` initialization object.

**IMPORTANT:** Initialize `labels: []` in the `repoChanges` construction (alongside `settings: []` and `rulesets: []`):

```typescript
const repoChanges: RepoChanges = {
  repoName: result.repoName,
  settings: [],
  rulesets: [],
  labels: [], // <-- MUST be initialized or output layer crashes on r.labels.length
};
```

Add labels conversion block in `buildSettingsReport()` (parallel to rulesets):

```typescript
if (result.labelsResult?.planOutput?.entries) {
  for (const entry of result.labelsResult.planOutput.entries) {
    if (entry.action === "unchanged") continue;

    const labelChange: LabelChange = {
      name: entry.name,
      action: entry.action as "create" | "update" | "delete",
      newName: entry.newName,
      propertyChanges: entry.propertyChanges,
      config: entry.config,
    };
    repoChanges.labels.push(labelChange);

    if (entry.action === "create") totals.labels.create++;
    else if (entry.action === "update") totals.labels.update++;
    else if (entry.action === "delete") totals.labels.delete++;
  }
}
```

**Step 2: Run build and tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/cli/settings-report-builder.ts
git commit -m "feat(labels): add labels to settings report builder"
```

---

### Task 18: GitHub summary — add labels plan details

**Files:**

- Modify: `src/output/github-summary.ts`

**Step 1: Add LabelsPlanDetail and update RepoResult**

```typescript
export interface LabelsPlanDetail {
  name: string;
  action: "create" | "update" | "delete" | "unchanged";
  newName?: string;
}
```

Add `labelsPlanDetails?: LabelsPlanDetail[]` to `RepoResult`.

**Step 2: Update formatChangesColumn**

Add labels plan summary. Add `formatLabelsPlanSummary()` helper.

**Step 3: Add labels plan details rendering**

Add labels details block in the plan details section (parallel to rulesets).

**Step 4: Run build and tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/output/github-summary.ts
git commit -m "feat(labels): add labels plan details to GitHub summary"
```

---

### Task 19: Unified summary — add labels support

**Files:**

- Modify: `src/output/unified-summary.ts`

**Step 1: Update renderSettingsLines**

Add labels rendering after rulesets. For each label change, render the appropriate diff line (`+`, `!`, or `-`).

**Step 2: Update formatCombinedSummary**

Add labels totals section after rulesets totals.

**Step 3: Update hasAnyChanges**

Include `r.labels.length > 0` in the settings repo check.

**Step 4: Update hasSettingsChanges in formatUnifiedSummaryMarkdown**

Include `settingsRepo.labels.length > 0`.

**Step 5: Run build and tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/output/unified-summary.ts
git commit -m "feat(labels): add labels to unified summary output"
```

---

### Task 20: Update index.ts exports

**Files:**

- Modify: `src/cli/index.ts`
- Modify: `src/index.ts`

**Step 1: Update `src/cli/index.ts` — add labels re-exports**

Add the following to the existing re-export block from `"./types.js"`:

```typescript
export {
  // ... existing exports ...
  type ILabelsProcessor,
  type LabelsProcessorFactory,
  defaultLabelsProcessorFactory,
} from "./types.js";
```

**Step 2: Update `src/index.ts` — add labels exports**

Export through `./cli/index.js` for consistency with rulesets. Export only interface and factory types (matching the rulesets pattern where `IRulesetProcessor` is exported but not the concrete `RulesetProcessor` class):

```typescript
// Labels (via cli barrel, matching rulesets pattern)
export type { ILabelsProcessor, LabelsProcessorFactory } from "./cli/index.js";
export { defaultLabelsProcessorFactory } from "./cli/index.js";
```

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cli/index.ts src/index.ts
git commit -m "feat(labels): add labels exports to public API"
```

---

### Task 21: Package.json — coverage exclusion

**Files:**

- Modify: `package.json`

**Step 1: Add types.ts exclusion**

Add `--exclude='src/settings/labels/types.ts'` to the `test:coverage` script's c8 command (add after the existing `--exclude='src/settings/repo-settings/types.ts'`).

**Step 2: Run tests with coverage**

Run: `npm run test:coverage`
Expected: PASS (95% line coverage threshold)

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: exclude labels types from coverage threshold"
```

---

### Task 22: Lint and full test pass

**Files:** None (verification only)

**Step 1: Run linting**

Run: `./lint.sh`
Expected: PASS

**Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 3: Run coverage**

Run: `npm run test:coverage`
Expected: PASS (95% line threshold)

**Step 4: Fix any issues found, commit**

If any lint or test issues, fix and commit with descriptive message.

---

### Task 23: Documentation

**Files:**

- Create: `docs/configuration/labels.md`
- Modify: `mkdocs.yml`
- Modify: `docs/configuration/index.md` (if labels section needed)
- Modify: `docs/configuration/inheritance.md` (add labels inheritance examples)
- Modify: `docs/configuration/repo-settings.md` (mention labels as sibling)
- Modify: `docs/platforms/github.md` (add labels to supported features)
- Modify: `docs/reference/config-schema.md` (add Label Config table)

**Step 1: Create labels documentation page**

Create `docs/configuration/labels.md` covering:

- Overview and purpose
- Basic config examples (create labels, update colors, add descriptions)
- Rename labels with `new_name`
- `deleteOrphaned` for cleanup
- Inheritance (root + per-repo, `inherit: false`, `label: false`, overrides)
- Color format notes (with/without `#`)
- GitHub API reference

**Step 2: Update mkdocs.yml**

Add nav entry: `Labels: configuration/labels.md`

**Step 3: Update supporting docs**

Brief mentions in related pages pointing to the labels doc.

**Step 4: Commit**

```bash
git add docs/ mkdocs.yml
git commit -m "docs: add labels configuration documentation"
```

---

### Task 24: Final verification

**Step 1: Run full pre-PR checklist**

```bash
npm test
./lint.sh
npm run build
```

Expected: All PASS

**Step 2: Review git log**

Run: `git log --oneline`
Verify: All commits are clean, descriptive, and in logical order.
