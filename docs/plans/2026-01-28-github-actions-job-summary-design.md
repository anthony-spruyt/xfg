# GitHub Actions Job Summary Output

**Issue:** [#245](https://github.com/anthony-spruyt/xfg/issues/245)
**Date:** 2026-01-28

## Overview

Add support for writing sync results to `$GITHUB_STEP_SUMMARY` when running as a GitHub Action. The summary provides visibility into sync results directly in workflow run summaries.

## Design Decisions

| Decision        | Choice                                 | Rationale                                                 |
| --------------- | -------------------------------------- | --------------------------------------------------------- |
| Detail level    | Stats + repo details                   | PR URLs, skip reasons, error messages, file change counts |
| Implementation  | New `github-summary.ts` module         | Separation of concerns, easier to test                    |
| Data collection | Collect in `main()`                    | Follows SOLID - Logger stays focused on stdout            |
| Triggering      | Auto-detect via `$GITHUB_STEP_SUMMARY` | Zero config, just works in GitHub Actions                 |

## Data Types

```typescript
// src/github-summary.ts

export type MergeOutcome = "manual" | "auto" | "force" | "direct";

export interface FileChanges {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
}

export interface RepoResult {
  repoName: string;
  status: "succeeded" | "skipped" | "failed";
  message: string;
  prUrl?: string;
  mergeOutcome?: MergeOutcome;
  fileChanges?: FileChanges;
}

export interface SummaryData {
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  results: RepoResult[];
}
```

## Output Format

```markdown
## Config Sync Summary

| Status       | Count |
| ------------ | ----- |
| ✅ Succeeded | 3     |
| ⏭️ Skipped   | 1     |
| ❌ Failed    | 0     |
| **Total**    | **4** |

<details>
<summary>Repository Details</summary>

| Repository | Status        | Changes  | Result         |
| ---------- | ------------- | -------- | -------------- |
| org/repo-a | ✅ Merged     | +2 ~1 -0 | [PR #42](url)  |
| org/repo-b | ✅ Auto-merge | +1 ~0 -0 | [PR #15](url)  |
| org/repo-c | ✅ Pushed     | +1 ~1 -0 | Direct to main |
| org/repo-d | ⏭️ Skipped    | -        | No changes     |

</details>
```

### Status Values

| Outcome               | Status Column   |
| --------------------- | --------------- |
| PR created, left open | `✅ Open`       |
| PR with auto-merge    | `✅ Auto-merge` |
| PR merged immediately | `✅ Merged`     |
| Direct push to branch | `✅ Pushed`     |
| No changes needed     | `⏭️ Skipped`    |
| Error occurred        | `❌ Failed`     |

## Module API

```typescript
// Check if running in GitHub Actions
export function isGitHubActions(): boolean {
  return !!process.env.GITHUB_STEP_SUMMARY;
}

// Write summary to job summary file (no-op if not in GitHub Actions)
export function writeSummary(data: SummaryData): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatSummary(data);
  appendFileSync(summaryPath, markdown + "\n");
}

// Generates markdown string (exported for testing)
export function formatSummary(data: SummaryData): string {
  // ... builds markdown from data
}
```

## Integration

In `index.ts`:

```typescript
import { writeSummary, RepoResult } from "./github-summary.js";

async function main(): Promise<void> {
  const results: RepoResult[] = [];

  for (const repoConfig of config.repos) {
    // ... process repo ...
    results.push({
      repoName,
      status,
      message,
      prUrl,
      mergeOutcome,
      fileChanges,
    });
  }

  logger.summary();
  writeSummary({
    total: config.repos.length,
    succeeded: results.filter((r) => r.status === "succeeded").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
```

## Test Coverage

Tests must achieve 95%+ coverage per codecov requirements.

### `github-summary.test.ts`

```typescript
describe("formatSummary", () => {
  // Stats table
  it("generates stats table with all counts");
  it("handles zero counts correctly");

  // Succeeded variations
  it("shows PR with manual merge (open)");
  it("shows PR with auto-merge enabled");
  it("shows PR with force merge (merged)");
  it("shows direct push without PR URL");

  // File changes formatting
  it("formats file changes as +N ~N -N");
  it("omits unchanged from display");
  it("shows dash when no fileChanges");

  // Skipped/failed
  it("shows skipped repos with reason");
  it("shows failed repos with error message");
  it("escapes markdown special chars in messages");

  // Edge cases
  it("handles empty results array");
  it("handles all repos skipped");
  it("handles all repos failed");
  it("handles long repo names");
  it("handles URLs with special characters");
});

describe("writeSummary", () => {
  it("writes markdown to GITHUB_STEP_SUMMARY path");
  it("appends newline after content");
  it("no-ops when env var not set");
  it("no-ops when env var is empty string");
});

describe("isGitHubActions", () => {
  it("returns true when GITHUB_STEP_SUMMARY set");
  it("returns false when not set");
  it("returns false when empty string");
});
```

## Implementation Order (TDD)

1. **Red**: Write failing tests for `formatSummary` (stats table)
2. **Green**: Implement stats table generation
3. **Red**: Write failing tests for repo details table
4. **Green**: Implement repo details formatting
5. **Red**: Write failing tests for `writeSummary`
6. **Green**: Implement file writing with env detection
7. **Refactor**: Clean up, ensure 95%+ coverage
8. **Integrate**: Update `index.ts` to collect results and call writeSummary

## Files Changed

| File                         | Action                                      |
| ---------------------------- | ------------------------------------------- |
| `src/github-summary.ts`      | Create - types, formatSummary, writeSummary |
| `src/github-summary.test.ts` | Create - unit tests                         |
| `src/index.ts`               | Modify - collect results, call writeSummary |

## Files Unchanged

- `logger.ts` - stays focused on stdout
- `action.yml` - auto-detection, no new inputs needed
- Existing tests - new module is additive
