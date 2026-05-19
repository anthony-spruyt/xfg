# createOnly Mode Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix createOnly files skipping executable mode enforcement so `.sh` files with wrong permissions get corrected.

**Architecture:** Modify `processOneFile` in `FileWriter` to compute file mode before the createOnly early-return. If mode drifted, emit a `modeOnly` update instead of `skip`. No new types, no downstream changes.

**Tech Stack:** TypeScript, node:test, node:assert

**Spec:** `plans/superpowers/specs/2026-05-18-createonly-mode-enforcement-design.md` **Issue:** [#818](https://github.com/anthony-spruyt/xfg/issues/818)

______________________________________________________________________

## File Map

| Action | File                                            | Responsibility                                    |
| ------ | ----------------------------------------------- | ------------------------------------------------- |
| Modify | `src/sync/file-writer.ts:94-109`                | Fix createOnly early-return to compute mode first |
| Modify | `test/unit/sync/file-writer-mode-drift.test.ts` | Add 3 createOnly + mode tests                     |

**Note:** The existing createOnly test in `test/unit/sync/file-writer.test.ts:71-106` does NOT need changes. It uses `createMockAuthenticatedGitOps` which returns `"100644"` for `getFileMode`. The test file is `existing.json` (not `.sh`), so `shouldBeExecutable` returns false, `desiredMode = "100644"`, mode matches — still emits `skip`. The spec's note about needing a mock update was incorrect.

______________________________________________________________________

### Task 1: Red — Write failing test for createOnly mode drift

**Files:**

- Modify: `test/unit/sync/file-writer-mode-drift.test.ts` (append inside `describe` block, after line 201)

- [ ] **Step 1: Write the failing test**

Add this test at the end of the `describe("FileWriter mode drift", ...)` block (before the closing `});` on line 202):

```typescript
  test("createOnly file with mode drift emits modeOnly update and calls setExecutable", async () => {
    const execCalls: string[] = [];
    const files: FileContent[] = [
      {
        fileName: "scripts/setup.sh",
        content: "same content\n",
        createOnly: true,
      },
    ];
    const result = await new FileWriter().writeFiles(files, ctx, {
      gitOps: makeGitOpsStub({
        setExecutable: async (name: string) => {
          execCalls.push(name);
        },
      }),
      log: silentLogger,
    });
    const change = result.fileChanges.get("scripts/setup.sh");
    assert.ok(change, "expected modeOnly fileChange for createOnly .sh file");
    assert.equal(change!.action, "update");
    assert.equal(change!.modeOnly, true);
    assert.equal(change!.mode, "100755");
    assert.equal(change!.content, null);
    assert.deepEqual(execCalls, ["scripts/setup.sh"]);
  });
```

Mock defaults from `makeGitOpsStub` already provide:

- `fileExistsOnBranch: async () => true` — createOnly sees file exists

- `getFileMode: async () => "100644"` — wrong mode for `.sh`

- `getFileContent: () => "same content\n"` — content matches

- `wouldChange: () => false` — no content change

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/sync/file-writer-mode-drift.test.ts`

Expected: FAIL — the new test fails because current code sets `action: "skip"` for createOnly files, not `action: "update"` with `modeOnly: true`. The `change` variable will have `action: "skip"` and the assertion `assert.equal(change!.action, "update")` fails.

______________________________________________________________________

### Task 2: Green — Implement createOnly mode computation in processOneFile

**Files:**

- Modify: `src/sync/file-writer.ts:94-109`

- [ ] **Step 3: Replace the createOnly early-return block**

Replace lines 94-109 of `src/sync/file-writer.ts` (the entire `if (file.createOnly) { ... }` block) with:

```typescript
    if (file.createOnly) {
      const existsOnBase = await gitOps.fileExistsOnBranch(
        file.fileName,
        baseBranch
      );
      if (existsOnBase) {
        const desiredMode: "100755" | "100644" = shouldBeExecutable(file)
          ? "100755"
          : "100644";
        const currentMode = await gitOps.getFileMode(file.fileName);
        modeCache.set(file.fileName, currentMode);
        const modeDiffers =
          currentMode !== null && currentMode !== desiredMode;

        if (modeDiffers) {
          fileChanges.set(file.fileName, {
            fileName: file.fileName,
            content: null,
            action: "update",
            mode: desiredMode,
            modeOnly: true,
          });
          incrementDiffStats(diffStats, "MODIFIED");
          if (dryRun) {
            log.info(
              `Would change mode: ${file.fileName} ${currentMode} -> ${desiredMode}`
            );
          }
        } else {
          log.info(
            `Skipping ${file.fileName} (createOnly: exists on ${baseBranch})`
          );
          fileChanges.set(file.fileName, {
            fileName: file.fileName,
            content: null,
            action: "skip",
          });
        }
        return;
      }
    }
```

Key differences from original:

1. Computes `desiredMode`, `currentMode`, populates `modeCache` before deciding action
1. If mode drifted → emits `{ action: "update", modeOnly: true }` instead of `{ action: "skip" }`
1. If mode correct → emits `{ action: "skip" }` as before
1. Mirrors the existing mode-drift pattern at lines 145-152 and 162-172

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/sync/file-writer-mode-drift.test.ts`

Expected: ALL PASS — the new test passes because createOnly now emits `modeOnly` update for drifted mode, and `applyExecutablePermissions` calls `setExecutable` (since `action: "update"` passes the skip guard).

- [ ] **Step 5: Run existing createOnly test to verify no regression**

Run: `npx tsx --test test/unit/sync/file-writer.test.ts`

Expected: ALL PASS — the existing createOnly test (`existing.json`, not `.sh`) still gets `desiredMode = "100644"` matching mock's `getFileMode` return of `"100644"`, so `modeDiffers = false` → `action: "skip"`.

______________________________________________________________________

### Task 3: Add test for createOnly with correct mode (skip path)

**Files:**

- Modify: `test/unit/sync/file-writer-mode-drift.test.ts`

- [ ] **Step 6: Write the test**

Add after the test from Task 1:

```typescript
  test("createOnly file with correct mode emits skip", async () => {
    const files: FileContent[] = [
      {
        fileName: "scripts/setup.sh",
        content: "same content\n",
        createOnly: true,
      },
    ];
    const result = await new FileWriter().writeFiles(files, ctx, {
      gitOps: makeGitOpsStub({
        getFileMode: async () => "100755",
      }),
      log: silentLogger,
    });
    const change = result.fileChanges.get("scripts/setup.sh");
    assert.ok(change, "expected skip entry for createOnly file");
    assert.equal(change!.action, "skip");
    assert.equal(change!.modeOnly, undefined);
  });
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx tsx --test test/unit/sync/file-writer-mode-drift.test.ts`

Expected: ALL PASS — mode matches (`"100755"` desired, `"100755"` current), so `modeDiffers = false` → `action: "skip"`.

______________________________________________________________________

### Task 4: Add test for createOnly mode drift in dry-run

**Files:**

- Modify: `test/unit/sync/file-writer-mode-drift.test.ts`

- [ ] **Step 8: Write the test**

Add after the test from Task 3:

```typescript
  test("createOnly file with mode drift in dry-run reports MODIFIED", async () => {
    const infos: string[] = [];
    const files: FileContent[] = [
      {
        fileName: "scripts/setup.sh",
        content: "same content\n",
        createOnly: true,
      },
    ];
    const result = await new FileWriter().writeFiles(
      files,
      { ...ctx, dryRun: true },
      {
        gitOps: makeGitOpsStub(),
        log: {
          ...silentLogger,
          info: (m: string) => {
            infos.push(m);
          },
        } as unknown as ILogger,
      }
    );
    assert.equal(result.diffStats.modifiedCount, 1);
    assert.ok(
      infos.some((m) =>
        /Would change mode.*scripts\/setup\.sh.*100644.*100755/.test(m)
      )
    );
  });
```

This mirrors the existing dry-run test pattern (lines 171-201).

- [ ] **Step 9: Run test to verify it passes**

Run: `npx tsx --test test/unit/sync/file-writer-mode-drift.test.ts`

Expected: ALL PASS

______________________________________________________________________

### Task 5: Full verification and commit

- [ ] **Step 10: Run full unit test suite**

Run: `npm test`

Expected: ALL PASS

- [ ] **Step 11: Run test type checking**

Run: `npm run test:typecheck`

Expected: ALL PASS

- [ ] **Step 12: Run linter**

Run: `./lint.sh`

Expected: ALL PASS

- [ ] **Step 13: Commit**

```bash
git add src/sync/file-writer.ts test/unit/sync/file-writer-mode-drift.test.ts
git commit -m "fix: createOnly files enforce executable file mode (#818)

createOnly early-return now computes desired/current mode before deciding
action. If mode drifted, emits modeOnly update instead of skip.
Fixes .sh files committed as 100644 never getting corrected to 100755."
```

- [ ] **Step 14: Push**

```bash
git push -u origin fix/createonly-mode-enforcement
```
