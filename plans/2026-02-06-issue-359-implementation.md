# Filter Read-Only Ruleset Fields Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace blocklist-based filtering of GitHub API metadata fields with a type-safe allowlist derived from the `Ruleset` config interface, fixing noisy diffs showing read-only fields as removals.

**Architecture:** A `Record<keyof Ruleset, string>` map in `config.ts` maps camelCase config keys to snake_case API keys. Both `ruleset-diff.ts` and `ruleset-plan-formatter.ts` import the derived `Set` and use it as an allowlist instead of their current blocklists. TypeScript enforces the map stays in sync with the `Ruleset` interface at compile time.

**Tech Stack:** TypeScript, node:test, node:assert

**Design doc:** `plans/2026-02-06-issue-359-filter-readonly-ruleset-fields.md`

---

### Task 1: Add RULESET_COMPARABLE_FIELDS to config.ts

**Files:**

- Modify: `src/config.ts:332` (after `Ruleset` interface)

**Step 1: Add the field map and exported set**

Insert after line 332 (closing `}` of `Ruleset` interface), before the `// GitHub Repository Settings Types` section separator:

```typescript
/**
 * Maps Ruleset config keys (camelCase) to GitHub API keys (snake_case).
 * TypeScript enforces this stays in sync with the Ruleset interface.
 */
const RULESET_FIELD_MAP: Record<keyof Ruleset, string> = {
  target: "target",
  enforcement: "enforcement",
  bypassActors: "bypass_actors",
  conditions: "conditions",
  rules: "rules",
};

/**
 * Set of snake_case field names that are comparable between config and API.
 * Used as an allowlist — any API response field not in this set is ignored.
 */
export const RULESET_COMPARABLE_FIELDS = new Set(
  Object.values(RULESET_FIELD_MAP)
);
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add RULESET_COMPARABLE_FIELDS allowlist derived from Ruleset type (#359)"
```

---

### Task 2: Update ruleset-diff.ts to use allowlist + test

**Files:**

- Modify: `src/ruleset-diff.ts:1,58,63-76`
- Modify: `test/unit/ruleset-diff.test.ts:207-226`

**Step 1: Write the failing test**

In `test/unit/ruleset-diff.test.ts`, replace the existing test at line 207-226 ("ignores extra fields from GitHub API response") with a more comprehensive version that covers all read-only fields:

```typescript
test("ignores read-only API metadata fields (node_id, _links, created_at, updated_at, current_user_can_bypass)", () => {
  const current: GitHubRuleset[] = [
    {
      id: 1,
      name: "main-protection",
      target: "branch",
      enforcement: "active",
      source_type: "Repository",
      source: "test-org/test-repo",
      // These are read-only API fields not in GitHubRuleset interface
      // but present in real API responses via JSON.parse
      ...({
        node_id: "RRS_lACqUmVwb3NpdG9yec5Di7RzzgC1f1Y",
        _links: { self: { href: "https://api.github.com/..." } },
        created_at: "2026-01-17T05:42:55.087Z",
        updated_at: "2026-01-30T12:34:29.079Z",
        current_user_can_bypass: "always",
      } as unknown as Partial<GitHubRuleset>),
    },
  ];
  const desired = new Map<string, Ruleset>([
    ["main-protection", { target: "branch", enforcement: "active" }],
  ]);
  const managed: string[] = [];

  const changes = diffRulesets(current, desired, managed);

  assert.equal(changes[0].action, "unchanged");
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/ruleset-diff.test.ts`
Expected: FAIL — the current blocklist doesn't filter `node_id`, `_links`, etc., so they cause a diff and the action will be `update` instead of `unchanged`.

**Step 3: Update the import in ruleset-diff.ts**

At `src/ruleset-diff.ts:1`, change:

```typescript
import type { Ruleset } from "./config.js";
```

to:

```typescript
import { RULESET_COMPARABLE_FIELDS, type Ruleset } from "./config.js";
```

**Step 4: Replace blocklist with allowlist in normalizeGitHubRuleset**

In `src/ruleset-diff.ts`, delete the `IGNORE_FIELDS` constant at line 58:

```typescript
// DELETE THIS:
const IGNORE_FIELDS = new Set(["id", "name", "source_type", "source"]);
```

Then in `normalizeGitHubRuleset` (lines 63-76), change the loop body from:

```typescript
for (const [key, value] of Object.entries(ruleset)) {
  if (IGNORE_FIELDS.has(key) || value === undefined) {
    continue;
  }
  normalized[key] = normalizeValue(value);
}
```

to:

```typescript
for (const [key, value] of Object.entries(ruleset)) {
  if (!RULESET_COMPARABLE_FIELDS.has(key) || value === undefined) {
    continue;
  }
  normalized[key] = normalizeValue(value);
}
```

Note: No `camelToSnake` conversion needed here because GitHub API response keys are already snake_case, matching the allowlist values.

**Step 5: Run test to verify it passes**

Run: `npx tsx --test test/unit/ruleset-diff.test.ts`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/ruleset-diff.ts test/unit/ruleset-diff.test.ts
git commit -m "fix(diff): use allowlist for ruleset field filtering in diff module (#359)"
```

---

### Task 3: Update ruleset-plan-formatter.ts to use allowlist + test

**Files:**

- Modify: `src/ruleset-plan-formatter.ts:3,264-278`
- Modify: `test/unit/ruleset-plan-formatter.test.ts`

**Step 1: Write the failing test**

In `test/unit/ruleset-plan-formatter.test.ts`, add a new test inside the `formatRulesetPlan` describe block (after the last test, before the `entries population` describe):

```typescript
test("filters read-only API metadata fields from update diff", () => {
  const changes: RulesetChange[] = [
    {
      action: "update",
      name: "pr-rules",
      rulesetId: 1,
      current: {
        id: 1,
        name: "pr-rules",
        target: "branch",
        enforcement: "disabled",
        // Read-only API fields that should not appear in diff
        ...({
          node_id: "RRS_lACqUmVwb3NpdG9yec5Di7RzzgC1f1Y",
          _links: { self: { href: "https://api.github.com/..." } },
          created_at: "2026-01-17T05:42:55.087Z",
          updated_at: "2026-01-30T12:34:29.079Z",
          current_user_can_bypass: "always",
        } as Record<string, unknown>),
      },
      desired: {
        target: "branch",
        enforcement: "active",
      },
    },
  ];

  const result = formatRulesetPlan(changes);

  const output = result.lines.join("\n");
  // Should show the real change
  assert.ok(output.includes("enforcement"));
  // Should NOT show read-only fields as removals
  assert.ok(!output.includes("node_id"));
  assert.ok(!output.includes("_links"));
  assert.ok(!output.includes("created_at"));
  assert.ok(!output.includes("updated_at"));
  assert.ok(!output.includes("current_user_can_bypass"));
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/ruleset-plan-formatter.test.ts`
Expected: FAIL — the current blocklist doesn't filter these fields, so they appear in the diff output.

**Step 3: Update the import in ruleset-plan-formatter.ts**

At `src/ruleset-plan-formatter.ts:4`, change:

```typescript
import type { Ruleset } from "./config.js";
```

to:

```typescript
import { RULESET_COMPARABLE_FIELDS, type Ruleset } from "./config.js";
```

**Step 4: Replace blocklist with allowlist in normalizeForDiff**

In `src/ruleset-plan-formatter.ts`, in the `normalizeForDiff` function (lines 264-278), change:

```typescript
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
```

to:

```typescript
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
```

Note: The snake_case conversion must happen before the allowlist check here, because `current` objects from the GitHub API have snake_case keys while `desired` objects from config have camelCase keys. Both pass through this function.

**Step 5: Run test to verify it passes**

Run: `npx tsx --test test/unit/ruleset-plan-formatter.test.ts`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/ruleset-plan-formatter.ts test/unit/ruleset-plan-formatter.test.ts
git commit -m "fix(diff): use allowlist for ruleset field filtering in plan formatter (#359)"
```

---

### Task 4: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 2: Run linter**

Run: `./lint.sh`
Expected: No errors

**Step 3: Build**

Run: `npm run build`
Expected: Clean build, no errors
