# Settings Output Redesign

> **For Claude:** Use superpowers:executing-plans to implement this design.

## Problem

The current settings command output is confusing and redundant:

1. **Mislabeled diffs** - All diff lines get attached to the first resource due to a bug in `resource-converters.ts`
2. **Redundant structure** - Resources table lists each setting separately, then diffs repeat the same info
3. **Wrong abstraction** - Settings are modeled as individual "resources" (`setting "repo/deleteBranchOnMerge"`) when they're really properties of a repo

Current output:

```
Resources
| Resource | Action |
| ~ setting "repo/deleteBranchOnMerge" | update |
| ~ setting "repo/webCommitSignoffRequired" | update |

Diff: setting "repo/deleteBranchOnMerge"    <-- WRONG: shows both settings
    ~ deleteBranchOnMerge: false → true
    ~ webCommitSignoffRequired: false → true
```

## Goals

1. **Group by repo** - Each repo is one block with all its changes
2. **No redundancy** - Show each change exactly once
3. **Flat settings, tree rulesets** - Settings are key-value, rulesets have nested structure
4. **Full detail always** - No collapsed sections, no "(N properties)" summaries

Target output:

```
~ anthony-spruyt/repo-operator
    ~ deleteBranchOnMerge: false → true
    ~ webCommitSignoffRequired: false → true
    ~ ruleset "branch-protection"
        ~ enforcement: active → evaluate

Plan: 2 settings, 1 ruleset to update
```

---

## Data Model

Replace the `Resource[]` model with a repo-centric structure:

```typescript
// src/output/settings-report.ts

interface SettingsReport {
  repos: RepoChanges[];
  totals: {
    settings: { add: number; change: number };
    rulesets: { create: number; update: number; delete: number };
  };
}

interface RepoChanges {
  repoName: string;
  settings: SettingChange[];
  rulesets: RulesetChange[];
  error?: string;
}

interface SettingChange {
  name: string;
  action: "add" | "change";
  oldValue?: unknown;
  newValue: unknown;
}

interface RulesetChange {
  name: string;
  action: "create" | "update" | "delete"; // no "unchanged" - only track changes
  propertyDiffs?: PropertyDiff[]; // for update - reuse existing type
  config?: Ruleset; // for create - full config to render
}
```

**Key design decisions:**

1. **Settings have no delete** - Removing from config = stop managing, not revert
2. **Rulesets have full lifecycle** - create/update/delete with state tracking via manifest
3. **PropertyDiff reused** - `rulesets/formatter.ts` already has tree diffing, keep it
4. **Error at repo level** - If processing fails, attach error to that repo's entry
5. **Unchanged not tracked** - Only include things that are actually changing

**What gets deleted:**

- `resource-converters.ts` - the broken abstraction
- `Resource`, `ResourceAction`, `ResourceType` types from `plan-formatter.ts`

---

## Formatter & Rendering

One formatter module that outputs both CLI and GitHub markdown from the same data:

```typescript
// src/output/settings-report-formatter.ts

// CLI output (with chalk colors)
function formatSettingsReportCLI(report: SettingsReport): string[];

// GitHub markdown (for GITHUB_STEP_SUMMARY)
function formatSettingsReportMarkdown(
  report: SettingsReport,
  dryRun: boolean
): string;
```

**CLI Output Rules:**

1. Repo line gets `~` if it has any changes
2. Settings rendered as flat `~ name: old → new` or `+ name: value`
3. Rulesets rendered with action prefix, then indented property tree
4. Blank line between repos
5. Summary line at end

```
~ anthony-spruyt/repo-operator
    ~ deleteBranchOnMerge: false → true
    + hasWiki: true
    + ruleset "ci-bypass"
        + enforcement: active
        + target: branch
        + conditions.ref_name.include: ["refs/heads/main"]
    ~ ruleset "branch-protection"
        ~ enforcement: active → evaluate
    - ruleset "old-ruleset"

~ other-org/other-repo
    ~ description: "old" → "new"

Plan: 3 settings, 3 rulesets (1 create, 1 update, 1 delete)
```

**GitHub Markdown Output:**

Same structure but in a code block with diff syntax highlighting:

````markdown
## Repository Settings Summary (Dry Run)

> [!WARNING]
> This was a dry run — no changes were applied

```diff
~ anthony-spruyt/repo-operator
    ~ deleteBranchOnMerge: false → true
    + ruleset "ci-bypass"
        + enforcement: active
```

**Plan: 3 settings, 3 rulesets (1 create, 1 update, 1 delete)**
````

No tables, no `<details>`, just the diff block.

---

## Data Flow & Integration

```
settings-command.ts
        │
        ├─► RepoSettingsProcessor.process()
        │       └─► returns RepoSettingsProcessorResult with planOutput
        │
        ├─► RulesetProcessor.process()
        │       └─► returns RulesetProcessorResult with planOutput
        │
        ▼
buildSettingsReport()  ◄── NEW: converts processor results to SettingsReport
        │
        ▼
formatSettingsReportCLI()  ──► console output
formatSettingsReportMarkdown()  ──► GITHUB_STEP_SUMMARY
```

**New function in `settings-command.ts`:**

```typescript
function buildSettingsReport(
  results: Array<{
    repoName: string;
    settingsResult?: RepoSettingsProcessorResult;
    rulesetResult?: RulesetProcessorResult;
    error?: string;
  }>
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
        // ... map to SettingChange, increment totals
      }
    }

    // Convert ruleset processor output
    if (result.rulesetResult?.planOutput?.entries) {
      for (const entry of result.rulesetResult.planOutput.entries) {
        // ... map to RulesetChange, increment totals
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

**Key change:** Process all repos first, collect results, then build report once at the end. No more interleaved logging during processing.

---

## Files Changed

### Files to Create

| File                                          | Purpose                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/output/settings-report.ts`               | New types: `SettingsReport`, `RepoChanges`, `SettingChange`, `RulesetChange` |
| `src/output/settings-report-formatter.ts`     | `formatSettingsReportCLI()`, `formatSettingsReportMarkdown()`                |
| `test/unit/settings-report-formatter.test.ts` | Tests for new formatter                                                      |

### Files to Modify

| File                                      | Changes                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `src/cli/settings-command.ts`             | Replace resource collection with `buildSettingsReport()`, use new formatters |
| `src/settings/repo-settings/formatter.ts` | Add `oldValue` to entries (currently only has `property` and `action`)       |
| `src/settings/rulesets/formatter.ts`      | Ensure `RulesetPlanEntry` includes property diffs for updates                |

### Files to Delete

| File                                  | Reason                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| `src/settings/resource-converters.ts` | Broken abstraction, replaced by `buildSettingsReport()` |
| `src/output/plan-summary.ts`          | Replaced by `settings-report-formatter.ts`              |

### Files to Keep (but stop using for settings)

| File                           | Notes                                                               |
| ------------------------------ | ------------------------------------------------------------------- |
| `src/output/plan-formatter.ts` | May still be used by sync command for file resources - review later |
| `src/output/github-summary.ts` | Used by sync command - separate concern                             |

---

## Testing

**Unit tests for new formatter** (`test/unit/settings-report-formatter.test.ts`):

```typescript
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

    expect(lines).toContain("~ org/repo");
    expect(lines).toContain("    ~ deleteBranchOnMerge: false → true");
    expect(lines).toContain("Plan: 1 setting to change");
  });

  test("renders repo with ruleset create showing full tree");
  test("renders repo with ruleset update showing property diffs");
  test("renders repo with ruleset delete");
  test("renders repo with mixed settings and rulesets");
  test("renders multiple repos");
  test("renders repo with error");
  test("renders empty report as no changes");
});

describe("formatSettingsReportMarkdown", () => {
  test("includes dry run warning when dryRun=true");
  test("wraps output in diff code block");
  test("includes plan summary as bold text");
});
```

**Integration test:** Run `settings --dry-run` against test config, verify output format matches expected structure.

**What to delete:** Tests in `test/unit/plan-summary.test.ts` that cover the old Resource-based formatting (or repurpose for sync command if still needed there).

---

## Implementation Plan

### Phase 1: New formatter (no integration yet)

1. Create `src/output/settings-report.ts` with types
2. Create `src/output/settings-report-formatter.ts` with CLI formatter
3. Add tests, verify output format
4. Add markdown formatter
5. Add markdown tests

### Phase 2: Wire up to settings command

6. Modify `src/settings/repo-settings/formatter.ts` to include `oldValue` in entries
7. Modify `src/settings/rulesets/formatter.ts` to include property diffs in entries
8. Add `buildSettingsReport()` to `settings-command.ts`
9. Replace `printPlan()` and `writePlanSummary()` calls with new formatters
10. Delete `src/settings/resource-converters.ts`

### Phase 3: Cleanup

11. Remove unused imports from `settings-command.ts`
12. Delete `src/output/plan-summary.ts` (if not used by sync)
13. Update any remaining tests

### Future (separate PR)

Refactor sync command's file output and GitHub summary to use same repo-grouped pattern, then consolidate or remove `plan-formatter.ts` and `github-summary.ts`.

### Estimated Size

- ~200 lines new code (types + formatters)
- ~100 lines deleted (resource-converters, old plan-summary usage)
- Net: roughly even, but much cleaner
