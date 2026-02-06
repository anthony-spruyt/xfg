# Dry-Run Summary Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a clear dry-run indicator to GitHub Actions job summaries so users can distinguish dry-run output from real apply output.

**Architecture:** Add `dryRun?: boolean` to `SummaryData`, propagate it from both callers in `index.ts`, and modify `formatSummary()` / `formatStatus()` to render hypothetical wording when set. TDD throughout.

**Tech Stack:** TypeScript, node:test, node:assert

---

### Task 1: Add dry-run tests for title and banner

**Files:**

- Modify: `test/unit/github-summary.test.ts` (add new describe block after line 410, before `writeSummary` tests)
- Reference: `src/github-summary.ts:21-28` (current `SummaryData` interface)

**Step 1: Write the failing tests**

Add this new describe block inside the `formatSummary` describe, after the "edge cases" describe block (after line 410):

```typescript
describe("dry-run mode", () => {
  test("appends '(Dry Run)' to the title", () => {
    const data: SummaryData = {
      title: "Config Sync Summary",
      dryRun: true,
      total: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      results: [],
    };

    const markdown = formatSummary(data);

    assert.ok(markdown.includes("## Config Sync Summary (Dry Run)"));
  });

  test("includes warning admonition banner", () => {
    const data: SummaryData = {
      title: "Config Sync Summary",
      dryRun: true,
      total: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      results: [],
    };

    const markdown = formatSummary(data);

    assert.ok(markdown.includes("> [!WARNING]"));
    assert.ok(
      markdown.includes("> This was a dry run \u2014 no changes were applied")
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "dry-run mode" 2>&1 | tail -20`
Expected: TypeScript compilation error - `dryRun` does not exist on type `SummaryData`

**Step 3: Commit**

```
git add test/unit/github-summary.test.ts
git commit -m "test(summary): add failing tests for dry-run title and banner"
```

---

### Task 2: Implement title suffix and warning banner

**Files:**

- Modify: `src/github-summary.ts:21-28` (add `dryRun` to `SummaryData`)
- Modify: `src/github-summary.ts:74-79` (modify header + add banner in `formatSummary`)

**Step 1: Add `dryRun` field to `SummaryData`**

In `src/github-summary.ts`, change the interface at line 21-28 to:

```typescript
export interface SummaryData {
  title: string;
  dryRun?: boolean;
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  results: RepoResult[];
}
```

**Step 2: Modify `formatSummary` header section**

Replace lines 77-79 in `src/github-summary.ts`:

```typescript
// Header
const titleSuffix = data.dryRun ? " (Dry Run)" : "";
lines.push(`## ${data.title}${titleSuffix}`);
lines.push("");

// Dry-run warning banner
if (data.dryRun) {
  lines.push("> [!WARNING]");
  lines.push("> This was a dry run \u2014 no changes were applied");
  lines.push("");
}
```

**Step 3: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "dry-run mode" 2>&1 | tail -20`
Expected: 2 tests PASS

**Step 4: Run full test suite to check for regressions**

Run: `npm test 2>&1 | tail -20`
Expected: All tests PASS

**Step 5: Commit**

```
git add src/github-summary.ts
git commit -m "feat(summary): add dry-run title suffix and warning banner"
```

---

### Task 3: Add dry-run tests for stats table labels

**Files:**

- Modify: `test/unit/github-summary.test.ts` (add tests inside "dry-run mode" describe)

**Step 1: Write the failing tests**

Add these tests inside the existing `describe("dry-run mode", ...)` block:

```typescript
test("stats table shows hypothetical labels", () => {
  const data: SummaryData = {
    title: "Config Sync Summary",
    dryRun: true,
    total: 3,
    succeeded: 1,
    skipped: 1,
    failed: 1,
    results: [],
  };

  const markdown = formatSummary(data);

  assert.ok(markdown.includes("✅ Would Succeed"));
  assert.ok(markdown.includes("⏭️ Would Skip"));
  assert.ok(markdown.includes("❌ Would Fail"));
  assert.ok(!markdown.includes("✅ Succeeded"));
  assert.ok(!markdown.includes("⏭️ Skipped"));
  assert.ok(!markdown.includes("❌ Failed"));
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "stats table shows hypothetical" 2>&1 | tail -20`
Expected: FAIL - "Would Succeed" not found in output

**Step 3: Commit**

```
git add test/unit/github-summary.test.ts
git commit -m "test(summary): add failing test for dry-run stats table labels"
```

---

### Task 4: Implement dry-run stats table labels

**Files:**

- Modify: `src/github-summary.ts:82-87` (stats table section of `formatSummary`)

**Step 1: Update stats table rendering**

Replace the stats table lines (currently lines 82-87) in `formatSummary` with:

```typescript
// Stats table
const succeededLabel = data.dryRun ? "✅ Would Succeed" : "✅ Succeeded";
const skippedLabel = data.dryRun ? "⏭️ Would Skip" : "⏭️ Skipped";
const failedLabel = data.dryRun ? "❌ Would Fail" : "❌ Failed";
lines.push("| Status | Count |");
lines.push("|--------|-------|");
lines.push(`| ${succeededLabel} | ${data.succeeded} |`);
lines.push(`| ${skippedLabel} | ${data.skipped} |`);
lines.push(`| ${failedLabel} | ${data.failed} |`);
lines.push(`| **Total** | **${data.total}** |`);
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "dry-run mode" 2>&1 | tail -20`
Expected: 3 tests PASS

**Step 3: Run full test suite for regressions**

Run: `npm test 2>&1 | tail -20`
Expected: All tests PASS

**Step 4: Commit**

```
git add src/github-summary.ts
git commit -m "feat(summary): use hypothetical labels in dry-run stats table"
```

---

### Task 5: Add dry-run tests for repo detail statuses

**Files:**

- Modify: `test/unit/github-summary.test.ts` (add tests inside "dry-run mode" describe)

**Step 1: Write the failing tests**

Add these tests inside the existing `describe("dry-run mode", ...)` block:

```typescript
test("repo detail statuses show hypothetical wording", () => {
  const results: RepoResult[] = [
    {
      repoName: "org/repo-a",
      status: "succeeded",
      message: "PR created",
      prUrl: "https://github.com/org/repo-a/pull/42",
      mergeOutcome: "manual",
    },
    {
      repoName: "org/repo-b",
      status: "succeeded",
      message: "Auto-merge enabled",
      prUrl: "https://github.com/org/repo-b/pull/15",
      mergeOutcome: "auto",
    },
    {
      repoName: "org/repo-c",
      status: "succeeded",
      message: "PR merged",
      prUrl: "https://github.com/org/repo-c/pull/99",
      mergeOutcome: "force",
    },
    {
      repoName: "org/repo-d",
      status: "succeeded",
      message: "Pushed to main",
      mergeOutcome: "direct",
    },
    {
      repoName: "org/repo-e",
      status: "skipped",
      message: "No changes",
    },
    {
      repoName: "org/repo-f",
      status: "failed",
      message: "Clone failed",
    },
  ];
  const data: SummaryData = {
    title: "Config Sync Summary",
    dryRun: true,
    total: 6,
    succeeded: 4,
    skipped: 1,
    failed: 1,
    results,
  };

  const markdown = formatSummary(data);

  assert.ok(markdown.includes("✅ Would Open"));
  assert.ok(markdown.includes("✅ Would Auto-merge"));
  assert.ok(markdown.includes("✅ Would Merge"));
  assert.ok(markdown.includes("✅ Would Push"));
  assert.ok(markdown.includes("⏭️ Would Skip"));
  assert.ok(markdown.includes("❌ Would Fail"));
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "repo detail statuses show hypothetical" 2>&1 | tail -20`
Expected: FAIL - "Would Open" not found

**Step 3: Commit**

```
git add test/unit/github-summary.test.ts
git commit -m "test(summary): add failing test for dry-run repo detail statuses"
```

---

### Task 6: Implement dry-run repo detail statuses

**Files:**

- Modify: `src/github-summary.ts:40-57` (`formatStatus` function)
- Modify: `src/github-summary.ts:100` (call site in `formatSummary`)

**Step 1: Add `dryRun` parameter to `formatStatus`**

Replace the `formatStatus` function (lines 40-57) with:

```typescript
function formatStatus(result: RepoResult, dryRun?: boolean): string {
  if (result.status === "skipped")
    return dryRun ? "⏭️ Would Skip" : "⏭️ Skipped";
  if (result.status === "failed") return dryRun ? "❌ Would Fail" : "❌ Failed";

  // Succeeded - format based on merge outcome
  switch (result.mergeOutcome) {
    case "manual":
      return dryRun ? "✅ Would Open" : "✅ Open";
    case "auto":
      return dryRun ? "✅ Would Auto-merge" : "✅ Auto-merge";
    case "force":
      return dryRun ? "✅ Would Merge" : "✅ Merged";
    case "direct":
      return dryRun ? "✅ Would Push" : "✅ Pushed";
    default:
      return dryRun ? "✅ Would Succeed" : "✅ Succeeded";
  }
}
```

**Step 2: Update the call site in `formatSummary`**

Change line 100 from:

```typescript
const status = formatStatus(result);
```

to:

```typescript
const status = formatStatus(result, data.dryRun);
```

**Step 3: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "dry-run mode" 2>&1 | tail -20`
Expected: 4 tests PASS

**Step 4: Run full test suite for regressions**

Run: `npm test 2>&1 | tail -20`
Expected: All tests PASS

**Step 5: Commit**

```
git add src/github-summary.ts
git commit -m "feat(summary): use hypothetical statuses in dry-run repo details"
```

---

### Task 7: Add regression test for non-dry-run mode

**Files:**

- Modify: `test/unit/github-summary.test.ts` (add tests inside "dry-run mode" describe)

**Step 1: Write the regression tests**

Add these tests inside the existing `describe("dry-run mode", ...)` block:

```typescript
test("dryRun false produces normal output", () => {
  const data: SummaryData = {
    title: "Config Sync Summary",
    dryRun: false,
    total: 1,
    succeeded: 1,
    skipped: 0,
    failed: 0,
    results: [],
  };

  const markdown = formatSummary(data);

  assert.ok(markdown.includes("## Config Sync Summary"));
  assert.ok(!markdown.includes("(Dry Run)"));
  assert.ok(!markdown.includes("[!WARNING]"));
  assert.ok(markdown.includes("✅ Succeeded"));
});

test("dryRun undefined produces normal output", () => {
  const data: SummaryData = {
    title: "Config Sync Summary",
    total: 1,
    succeeded: 1,
    skipped: 0,
    failed: 0,
    results: [],
  };

  const markdown = formatSummary(data);

  assert.ok(markdown.includes("## Config Sync Summary"));
  assert.ok(!markdown.includes("(Dry Run)"));
  assert.ok(!markdown.includes("[!WARNING]"));
  assert.ok(markdown.includes("✅ Succeeded"));
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "dry-run mode" 2>&1 | tail -20`
Expected: 6 tests PASS (all dry-run tests including regressions)

**Step 3: Commit**

```
git add test/unit/github-summary.test.ts
git commit -m "test(summary): add regression tests for non-dry-run mode"
```

---

### Task 8: Pass dryRun from callers in index.ts

**Files:**

- Modify: `src/index.ts:303-310` (sync caller)
- Modify: `src/index.ts:600-607` (settings caller)

**Step 1: Add `dryRun` to sync caller**

Change the `writeSummary` call at line 303-310 from:

```typescript
writeSummary({
  title: "Config Sync Summary",
  total: config.repos.length,
  succeeded,
  skipped,
  failed,
  results,
});
```

to:

```typescript
writeSummary({
  title: "Config Sync Summary",
  dryRun: options.dryRun,
  total: config.repos.length,
  succeeded,
  skipped,
  failed,
  results,
});
```

**Step 2: Add `dryRun` to settings caller**

Change the `writeSummary` call at line 600-607 from:

```typescript
writeSummary({
  title: "Repository Settings Summary",
  total: reposWithRulesets.length + reposWithRepoSettings.length,
  succeeded: successCount,
  skipped: skipCount,
  failed: failCount,
  results,
});
```

to:

```typescript
writeSummary({
  title: "Repository Settings Summary",
  dryRun: options.dryRun,
  total: reposWithRulesets.length + reposWithRepoSettings.length,
  succeeded: successCount,
  skipped: skipCount,
  failed: failCount,
  results,
});
```

**Step 3: Build to verify no TypeScript errors**

Run: `npm run build 2>&1 | tail -10`
Expected: Clean build, no errors

**Step 4: Run full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: All tests PASS

**Step 5: Commit**

```
git add src/index.ts
git commit -m "feat(summary): pass dryRun flag from sync and settings callers"
```

---

### Task 9: Lint and final verification

**Files:** None (verification only)

**Step 1: Run linter**

Run: `./lint.sh 2>&1 | tail -20`
Expected: No errors

**Step 2: Run full test suite one final time**

Run: `npm test 2>&1 | tail -20`
Expected: All tests PASS

**Step 3: Verify git log looks clean**

Run: `git log --oneline -10`
Expected: Clean series of commits for this feature
