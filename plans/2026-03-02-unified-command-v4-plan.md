# Unified Command v4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the `settings` command, unify everything under `xfg sync`, switch to manifest V4 (files-only), and use desired-state orphan detection for rulesets/labels.

**Architecture:** Settings processors (rulesets, labels, repo-settings) become API-only calls invoked from `runSync()` after file processing. Manifest drops rulesets/labels tracking. Orphan detection for rulesets/labels changes from manifest-based diffing to desired-state: "delete all on repo not in config" when `deleteOrphaned: true`.

**Tech Stack:** TypeScript, Node.js `node:test`, Commander.js CLI

**Design doc:** `plans/2026-03-02-unified-command-v4-design.md`

---

## Phase 1: Manifest V4 (Files-Only)

### Task 1: Update manifest types and migration

**Files:**

- Modify: `src/sync/manifest.ts`
- Test: `test/unit/manifest.test.ts`

**Step 1: Write failing tests for V4 manifest**

Add tests in `test/unit/manifest.test.ts`:

```typescript
describe("V4 manifest", () => {
  test("createEmptyManifest returns version 4", () => {
    const manifest = createEmptyManifest();
    assert.strictEqual(manifest.version, 4);
  });

  test("isV4Manifest recognizes V4 format", () => {
    const manifest = {
      version: 4,
      configs: { "my-config": { files: ["a.json"] } },
    };
    const loaded = loadManifest(workDir);
    // After writing this manifest to disk and loading
    assert.strictEqual(loaded?.version, 4);
  });

  test("V3 manifest with rulesets/labels migrates to V4 dropping those fields", () => {
    const v3 = {
      version: 3,
      configs: {
        "my-config": {
          files: [".eslintrc.json"],
          rulesets: ["protect-main"],
          labels: ["bug", "feature"],
        },
      },
    };
    writeFileSync(join(workDir, ".xfg.json"), JSON.stringify(v3));
    const loaded = loadManifest(workDir);
    assert.strictEqual(loaded?.version, 4);
    assert.deepStrictEqual(loaded?.configs["my-config"], {
      files: [".eslintrc.json"],
    });
  });

  test("V3 manifest with only rulesets/labels migrates to V4 with empty config", () => {
    const v3 = {
      version: 3,
      configs: {
        "my-config": {
          rulesets: ["protect-main"],
        },
      },
    };
    writeFileSync(join(workDir, ".xfg.json"), JSON.stringify(v3));
    const loaded = loadManifest(workDir);
    assert.strictEqual(loaded?.version, 4);
    // Config entry should be removed since no files
    assert.deepStrictEqual(loaded?.configs, {});
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "V4 manifest"`
Expected: FAIL — version is 3, V4 type guard doesn't exist

**Step 3: Implement V4 manifest types and migration**

In `src/sync/manifest.ts`:

1. Update `XfgManifestConfigEntry` — remove `rulesets` and `labels` fields:

```typescript
export interface XfgManifestConfigEntry {
  files?: string[];
  // rulesets and labels removed in V4
}
```

2. Update `XfgManifest` — version becomes 4:

```typescript
export interface XfgManifest {
  version: 4;
  configs: Record<string, XfgManifestConfigEntry>;
}
```

3. Add V3 legacy interface (keep for migration):

```typescript
interface XfgManifestV3 {
  version: 3;
  configs: Record<
    string,
    {
      files?: string[];
      rulesets?: string[];
      labels?: string[];
    }
  >;
}
```

4. Add `isV4Manifest` type guard:

```typescript
function isV4Manifest(manifest: unknown): manifest is XfgManifest {
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    (manifest as XfgManifest).version === 4 &&
    typeof (manifest as XfgManifest).configs === "object" &&
    (manifest as XfgManifest).configs !== null
  );
}
```

5. Rename existing `isV3Manifest` to check for V3 format using the new legacy interface.

6. Add `migrateV3ToV4`:

```typescript
function migrateV3ToV4(v3: XfgManifestV3): XfgManifest {
  const v4Configs: Record<string, XfgManifestConfigEntry> = {};
  for (const [configId, entry] of Object.entries(v3.configs)) {
    // Only preserve files — rulesets and labels are dropped
    if (entry.files && entry.files.length > 0) {
      v4Configs[configId] = { files: entry.files };
    }
  }
  return { version: 4, configs: v4Configs };
}
```

7. Update `loadManifest` — add V4 check first, then V3→V4 migration:

```typescript
if (isV4Manifest(parsed)) return parsed;
if (isV3Manifest(parsed)) return migrateV3ToV4(parsed);
if (isV2Manifest(parsed)) return migrateV3ToV4(migrateV2ToV3(parsed));
// V1 or unknown → null
```

8. Update `parseManifestContent` to handle V4 and V3→V4 migration:

```typescript
export function parseManifestContent(content: string): XfgManifest | null {
  try {
    const parsed = JSON.parse(content) as unknown;

    if (isV4Manifest(parsed)) {
      return parsed;
    }

    if (isV3Manifest(parsed)) {
      return migrateV3ToV4(parsed);
    }

    if (isV2Manifest(parsed)) {
      return migrateV3ToV4(migrateV2ToV3(parsed));
    }

    return null;
  } catch {
    return null;
  }
}
```

9. Update `createEmptyManifest` to return version 4.

10. Update `updateManifest` to return `version: 4`.

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "V4 manifest"`
Expected: PASS

**Step 5: Remove manifest rulesets/labels functions**

Remove these exported functions from `src/sync/manifest.ts`:

- `getManagedRulesets()`
- `getManagedLabels()`
- `updateManifestRulesets()`
- `updateManifestLabels()`

**Step 6: Update updateManifest to stop preserving rulesets/labels**

In `updateManifest()`, simplify the config entry construction — no longer preserve `existingRulesets` or `existingLabels`:

```typescript
const sortedManaged = Array.from(newManaged).sort();
if (sortedManaged.length > 0) {
  updatedConfigs[configId] = { files: sortedManaged };
} else {
  delete updatedConfigs[configId];
}
```

**Step 7: Fix all existing manifest tests**

Update `test/unit/manifest.test.ts`:

- Change all `version: 3` assertions to `version: 4`
- Remove tests for `getManagedRulesets()`, `getManagedLabels()`, `updateManifestRulesets()`, `updateManifestLabels()`
- Remove tests that verify rulesets/labels preservation in `updateManifest()`
- Add V3→V4 migration tests

**Step 8: Run full test suite, fix compilation errors**

Run: `npm test`
Expected: Many compilation failures from imports of removed functions. Fix each caller (addressed in later tasks — for now just verify manifest.test.ts passes).

**Step 9: Commit**

```bash
git add src/sync/manifest.ts test/unit/manifest.test.ts
git commit -m "feat!: manifest V4 — files-only, drop rulesets/labels tracking"
```

---

### Task 2: Remove ManifestStrategy and updateManifestOnly

**Files:**

- Delete: `src/sync/manifest-strategy.ts`
- Modify: `src/sync/repository-processor.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/sync/types.ts`
- Modify: `src/sync/index.ts`
- Modify: `src/index.ts`
- Modify: `test/unit/sync-command.test.ts`
- Test: `test/unit/sync/manifest-strategy.test.ts` (delete)
- Test: `test/unit/repository-processor.test.ts`

**Step 1: Delete manifest-strategy.ts**

Remove `src/sync/manifest-strategy.ts` entirely.

**Step 2: Remove updateManifestOnly from RepositoryProcessor**

In `src/sync/repository-processor.ts`:

- Remove the `updateManifestOnly()` method
- Remove imports: `ManifestStrategy`, `loadManifest`, `updateManifestRulesets`, `updateManifestLabels`, `MANIFEST_FILENAME`
- Remove `ManifestUpdateParams` imports

**Step 3: Remove updateManifestOnly from IRepositoryProcessor interface (BOTH locations)**

The `IRepositoryProcessor` interface is defined in TWO files:

1. In `src/cli/types.ts` (lines 25-37): Remove `updateManifestOnly()` from the interface
2. In `src/sync/types.ts` (lines 311-323): Remove `updateManifestOnly()` from the interface

Both must be updated. The `src/sync/types.ts` version is the canonical type used by `RepositoryProcessor`, while `src/cli/types.ts` is the DI interface used by `sync-command.ts`.

**Step 4: Update barrel exports**

In `src/sync/index.ts`:

- Remove `ManifestStrategy` and `ManifestUpdateParams` exports
- Remove `getManagedRulesets`, `getManagedLabels`, `updateManifestRulesets`, `updateManifestLabels` exports (already removed from manifest.ts in Task 1 Step 5)

**Step 5: Delete manifest-strategy test file**

Remove `test/unit/sync/manifest-strategy.test.ts`.

**Step 6: Update repository-processor tests**

In `test/unit/repository-processor.test.ts`:

- Remove all tests for `updateManifestOnly()`
- Remove mock setups for manifest strategy

**Step 6b: Remove updateManifestOnly mock from sync-command.test.ts**

In `test/unit/sync-command.test.ts`, the `createMockProcessor()` helper (line 31-46) includes an `updateManifestOnly` mock method. Remove it:

```typescript
// BEFORE:
return {
  process: mock.fn(async (): Promise<ProcessorResult> => result),
  updateManifestOnly: mock.fn(async (): Promise<ProcessorResult> => result),
};

// AFTER:
return {
  process: mock.fn(async (): Promise<ProcessorResult> => result),
};
```

Also remove the standalone `updateManifestOnly` mock in the "handles processor exception" test (line 247-253):

```typescript
// REMOVE this from the mockProcessor object:
updateManifestOnly: mock.fn(async () => ({
  success: true,
  skipped: false,
  message: "ok",
  repoName: "test/repo",
})),
```

**Step 7: Run tests**

Run: `npm test`
Expected: Compilation errors from settings command files (process-rulesets.ts, process-labels.ts) — those are addressed in the next tasks.

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor!: remove ManifestStrategy and updateManifestOnly"
```

---

## Phase 2: Desired-State Orphan Detection

### Task 3: Change rulesets diff to desired-state model

**Files:**

- Modify: `src/settings/rulesets/diff.ts`
- Modify: `src/settings/rulesets/processor.ts`
- Test: `test/unit/settings/rulesets/diff-algorithm.test.ts`
- Test: `test/unit/settings/rulesets/github-ruleset-strategy.test.ts`

> **Note:** There is no separate `processor.test.ts` for rulesets. Processor behavior is tested via `github-ruleset-strategy.test.ts`.

**Step 1: Write failing test for desired-state diff**

In `test/unit/settings/rulesets/diff-algorithm.test.ts`, add:

```typescript
describe("desired-state orphan detection", () => {
  test("deleteOrphaned: true deletes ALL current rulesets not in desired", () => {
    const current: GitHubRuleset[] = [
      { id: 1, name: "protect-main", target: "branch", enforcement: "active" },
      {
        id: 2,
        name: "unmanaged-ruleset",
        target: "branch",
        enforcement: "active",
      },
      {
        id: 3,
        name: "another-unmanaged",
        target: "branch",
        enforcement: "active",
      },
    ];
    const desired = new Map<string, Ruleset>([
      ["protect-main", { target: "branch", enforcement: "active" }],
    ]);

    const changes = diffRulesets(current, desired, true); // deleteOrphaned = true
    const deletes = changes.filter((c) => c.action === "delete");
    assert.strictEqual(deletes.length, 2);
    assert.ok(deletes.some((d) => d.name === "unmanaged-ruleset"));
    assert.ok(deletes.some((d) => d.name === "another-unmanaged"));
  });

  test("deleteOrphaned: false does not delete any unmanaged rulesets", () => {
    const current: GitHubRuleset[] = [
      { id: 1, name: "protect-main", target: "branch", enforcement: "active" },
      { id: 2, name: "unmanaged", target: "branch", enforcement: "active" },
    ];
    const desired = new Map<string, Ruleset>([
      ["protect-main", { target: "branch", enforcement: "active" }],
    ]);

    const changes = diffRulesets(current, desired, false);
    const deletes = changes.filter((c) => c.action === "delete");
    assert.strictEqual(deletes.length, 0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "desired-state orphan"`
Expected: FAIL — wrong signature

**Step 3: Update diffRulesets signature**

In `src/settings/rulesets/diff.ts`, change:

```typescript
// OLD:
export function diffRulesets(
  current: GitHubRuleset[],
  desired: Map<string, Ruleset>,
  managedNames: string[]
): RulesetChange[];

// NEW:
export function diffRulesets(
  current: GitHubRuleset[],
  desired: Map<string, Ruleset>,
  deleteOrphaned: boolean
): RulesetChange[];
```

Replace the orphan detection logic:

```typescript
// OLD: Check for orphaned rulesets (in manifest but not in desired config)
// for (const name of managedSet) { ... }

// NEW: Desired-state — delete ALL current not in desired when deleteOrphaned is true
if (deleteOrphaned) {
  for (const [name, currentRuleset] of currentByName) {
    if (!desired.has(name)) {
      changes.push({
        action: "delete",
        name,
        rulesetId: currentRuleset.id,
        current: currentRuleset,
      });
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "desired-state orphan"`
Expected: PASS

**Step 5: Update RulesetProcessor**

In `src/settings/rulesets/processor.ts`:

1. Remove `managedRulesets` from `RulesetProcessorOptions`:

```typescript
export interface RulesetProcessorOptions {
  configId: string;
  dryRun?: boolean;
  noDelete?: boolean;
  token?: string;
  // managedRulesets removed — desired-state model
}
```

2. Remove `manifestUpdate` from `RulesetProcessorResult`:

```typescript
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
  planOutput?: RulesetPlanResult;
  // manifestUpdate removed — no manifest tracking for rulesets
}
```

3. Update `process()` method:
   - Remove `managedRulesets` destructuring
   - Change skip condition from checking both `desiredRulesets` and `managedRulesets` to only checking `desiredRulesets`
     > **Intentional behavior change:** The current skip condition is `Object.keys(desiredRulesets).length === 0 && managedRulesets.length === 0`. Removing the `managedRulesets` check means repos with zero desired rulesets but previously tracked managed rulesets will now be skipped (no cleanup). This is intentional in the desired-state model: no rulesets in config means "don't touch rulesets on this repo." Cleanup of unmanaged rulesets is handled by `deleteOrphaned: true` only when desired rulesets are explicitly configured.
   - Pass `deleteOrphaned` to `diffRulesets()` instead of `managedRulesets`
   - Remove `computeManifestUpdate()` private method and all calls to it

**Step 6: Fix existing diff tests**

Update `test/unit/settings/rulesets/diff-algorithm.test.ts`:

- Change all `diffRulesets(current, desired, managedNames)` calls to `diffRulesets(current, desired, deleteOrphaned)`
- Tests that used `managedNames: ["old-ruleset"]` to trigger deletes now use `deleteOrphaned: true` (with `old-ruleset` in `current` but not in `desired`)
- Tests that used `managedNames: []` to skip deletes now use `deleteOrphaned: false`

**Step 7: Fix existing processor tests**

Update `test/unit/settings/rulesets/github-ruleset-strategy.test.ts`:

- Remove `managedRulesets` from all options objects
- Remove assertions on `manifestUpdate`
- Update mock setups

**Step 8: Run all tests**

Run: `npm test`
Expected: PASS (or compilation errors only in settings-command files, addressed later)

**Step 9: Commit**

```bash
git add src/settings/rulesets/ test/unit/settings/rulesets/
git commit -m "feat!: desired-state orphan detection for rulesets"
```

---

### Task 4: Change labels diff to desired-state model

**Files:**

- Modify: `src/settings/labels/diff.ts`
- Modify: `src/settings/labels/processor.ts`
- Test: `test/unit/settings/labels/diff.test.ts` (NEW — does not currently exist, create it)
- Test: `test/unit/settings/labels/processor.test.ts` (NEW — does not currently exist, create it)

> **Note:** Unlike rulesets, there are currently NO unit test files under `test/unit/settings/labels/`. These files must be created from scratch.

**Step 1: Write failing test for desired-state labels diff**

Create `test/unit/settings/labels/diff.test.ts` and add:

```typescript
describe("desired-state orphan detection", () => {
  test("deleteOrphaned: true deletes ALL current labels not in desired", () => {
    const current: GitHubLabel[] = [
      { name: "bug", color: "d73a4a", description: "" },
      { name: "unmanaged-label", color: "000000", description: null },
    ];
    const desired: Record<string, Label> = {
      bug: { color: "d73a4a" },
    };

    const changes = diffLabels(current, desired, true, false);
    const deletes = changes.filter((c) => c.action === "delete");
    assert.strictEqual(deletes.length, 1);
    assert.strictEqual(deletes[0].name, "unmanaged-label");
  });

  test("deleteOrphaned: false preserves unmanaged labels", () => {
    const current: GitHubLabel[] = [
      { name: "bug", color: "d73a4a", description: "" },
      { name: "unmanaged", color: "000000", description: null },
    ];
    const desired: Record<string, Label> = {
      bug: { color: "d73a4a" },
    };

    const changes = diffLabels(current, desired, false, false);
    const deletes = changes.filter((c) => c.action === "delete");
    assert.strictEqual(deletes.length, 0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "desired-state orphan"`
Expected: FAIL — wrong signature

**Step 3: Update diffLabels signature**

In `src/settings/labels/diff.ts`, change:

```typescript
// OLD:
export function diffLabels(
  current: GitHubLabel[],
  desired: Record<string, Label>,
  managedLabels: string[],
  noDelete: boolean
): LabelChange[];

// NEW:
export function diffLabels(
  current: GitHubLabel[],
  desired: Record<string, Label>,
  deleteOrphaned: boolean,
  noDelete: boolean
): LabelChange[];
```

Replace orphan detection:

```typescript
// OLD: Check for orphaned labels (in manifest but not in desired config)
// for (const name of managedSet) { ... }

// NEW: Desired-state — delete ALL current not in desired when deleteOrphaned is true
if (deleteOrphaned && !noDelete) {
  for (const [nameLower, currentLabel] of currentByName) {
    if (!desiredLower.has(nameLower)) {
      changes.push({
        action: "delete",
        name: currentLabel.name,
        current: currentLabel,
      });
    }
  }
}
```

Also remove the `managedSet` variable and all code referencing it, including the `deletedNames` logic that currently depends on `managedSet`. The `deletedNames` set for rename collision detection should now be built from the desired-state deletion candidates:

```typescript
const deletedNames = new Set<string>();
if (deleteOrphaned && !noDelete) {
  for (const nameLower of currentByName.keys()) {
    if (!desiredLower.has(nameLower)) {
      deletedNames.add(nameLower);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "desired-state orphan"`
Expected: PASS

**Step 5: Update LabelsProcessor**

In `src/settings/labels/processor.ts`:

1. Remove `managedLabels` from `LabelsProcessorOptions`:

```typescript
export interface LabelsProcessorOptions {
  configId: string;
  dryRun?: boolean;
  noDelete?: boolean;
  token?: string;
  // managedLabels removed
}
```

2. Remove `manifestUpdate` from `LabelsProcessorResult`:

```typescript
export interface LabelsProcessorResult {
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
  planOutput?: LabelsPlanResult;
  // manifestUpdate removed
}
```

3. Update `process()` method:
   - Remove `managedLabels` destructuring
   - Change skip condition to only check `desiredLabels`
   - Pass `deleteOrphaned` to `diffLabels()` instead of `managedLabels`
   - Remove `computeManifestUpdate()` method and all calls

**Step 6: Add comprehensive diff tests**

Since `test/unit/settings/labels/diff.test.ts` is new, add full test coverage:

- Tests for create/update/delete/unchanged label changes
- Tests for `diffLabels(current, desired, deleteOrphaned, noDelete)` with all combinations of `deleteOrphaned` and `noDelete`
- Rename collision detection tests

**Step 7: Add processor tests**

Since `test/unit/settings/labels/processor.test.ts` is new, add tests covering:

- Skipping non-GitHub repos
- Skipping when no labels configured
- Processing labels with mock strategy
- Dry-run mode

**Step 8: Run all tests**

Run: `npm test`
Expected: PASS (or compilation errors only in settings-command files)

**Step 9: Commit**

```bash
git add src/settings/labels/ test/unit/settings/labels/
git commit -m "feat!: desired-state orphan detection for labels"
```

---

## Phase 3: Unify Sync Command

### Task 5: Add settings processing to runSync

**Files:**

- Modify: `src/cli/sync-command.ts`
- Modify: `src/cli/types.ts`
- Test: `test/unit/sync-command.test.ts`

**Step 1: Write failing test for unified sync with settings**

In `test/unit/sync-command.test.ts`, add a test that verifies settings processors are called during sync:

```typescript
test("runSync calls rulesets processor for repos with rulesets", async () => {
  // Arrange: config with both files and rulesets
  const mockRulesetProcessor = {
    process: mock.fn(async () => ({
      success: true,
      repoName: "owner/repo",
      message: "Applied: 1 created",
    })),
  };

  await runSync(options, {
    processorFactory,
    rulesetProcessorFactory: () => mockRulesetProcessor,
  });

  assert.strictEqual(mockRulesetProcessor.process.mock.callCount(), 1);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "runSync calls rulesets processor"`
Expected: FAIL — `runSync` doesn't accept settings processor factories

**Step 3: Extend runSync to accept settings processor factories via options object**

In `src/cli/types.ts`, add a `SyncDependencies` interface to avoid a poor API with 6+ positional parameters:

```typescript
export interface SyncDependencies {
  processorFactory?: ProcessorFactory;
  lifecycleManager?: IRepoLifecycleManager;
  rulesetProcessorFactory?: RulesetProcessorFactory;
  repoSettingsProcessorFactory?: RepoSettingsProcessorFactory;
  labelsProcessorFactory?: LabelsProcessorFactory;
}
```

In `src/cli/sync-command.ts`, update the function signature to use the options object:

```typescript
export async function runSync(
  options: SyncOptions,
  deps: SyncDependencies = {}
): Promise<void> {
  const {
    processorFactory = defaultProcessorFactory,
    lifecycleManager,
    rulesetProcessorFactory = defaultRulesetProcessorFactory,
    repoSettingsProcessorFactory = defaultRepoSettingsProcessorFactory,
    labelsProcessorFactory = defaultLabelsProcessorFactory,
  } = deps;
  // ...
}
```

Update all existing callers of `runSync()` to use the new signature:

- `src/cli/program.ts`: `runSync(options, { lifecycleManager })` (or similar)
- `test/unit/sync-command.test.ts`: `runSync(options, { processorFactory: () => mockProcessor, lifecycleManager })` etc.

Add imports for the settings processor types and defaults from `./types.js`.

**Step 4: Add settings processing after file sync loop**

Inside the `runSync` repo loop, after the file sync `processor.process()` block, add settings processing:

Note: The `isGitHubRepo(repoInfo)` guard means settings blocks are silently skipped for non-GitHub repos (ADO, GitLab). This is intentional per the design doc — only GitHub supports rulesets/labels/repo-settings via API.

```typescript
// After file sync, apply settings via API
if (repoConfig.settings && isGitHubRepo(repoInfo)) {
  const githubRepo = repoInfo as GitHubRepoInfo;
  const settingsToken =
    (await tokenManager?.getTokenForRepo(githubRepo)) ?? process.env.GH_TOKEN;

  // Apply rulesets
  if (
    repoConfig.settings.rulesets &&
    Object.keys(repoConfig.settings.rulesets).length > 0
  ) {
    const rulesetProcessor = rulesetProcessorFactory();
    const rulesetResult = await rulesetProcessor.process(repoConfig, repoInfo, {
      configId: config.id,
      dryRun: options.dryRun,
      noDelete: options.noDelete,
      token: settingsToken,
    });
    // Log result, collect for report
    if (rulesetResult.planOutput?.lines?.length) {
      logger.info("");
      logger.info(`${repoName} - Rulesets:`);
      for (const line of rulesetResult.planOutput.lines) {
        logger.info(line);
      }
    }
    if (!rulesetResult.skipped) {
      settingsCollector.getOrCreate(repoName).rulesetResult = rulesetResult;
    }
  }

  // Apply labels
  if (
    repoConfig.settings.labels &&
    Object.keys(repoConfig.settings.labels).length > 0
  ) {
    const labelsProcessor = labelsProcessorFactory();
    const labelsResult = await labelsProcessor.process(repoConfig, repoInfo, {
      configId: config.id,
      dryRun: options.dryRun,
      noDelete: options.noDelete,
      token: settingsToken,
    });
    if (labelsResult.planOutput?.lines?.length) {
      logger.info("");
      logger.info(`${repoName} - Labels:`);
      for (const line of labelsResult.planOutput.lines) {
        logger.info(line);
      }
    }
    if (!labelsResult.skipped) {
      settingsCollector.getOrCreate(repoName).labelsResult = labelsResult;
    }
  }

  // Apply repo settings
  if (
    repoConfig.settings.repo &&
    Object.keys(repoConfig.settings.repo).length > 0
  ) {
    const repoSettingsProcessor = repoSettingsProcessorFactory();
    const repoSettingsResult = await repoSettingsProcessor.process(
      repoConfig,
      repoInfo,
      {
        dryRun: options.dryRun,
        token: settingsToken,
      }
    );
    if (repoSettingsResult.planOutput?.lines?.length) {
      logger.info("");
      logger.info(`${repoName} - Repo Settings:`);
      for (const line of repoSettingsResult.planOutput.lines) {
        logger.info(line);
      }
      if (repoSettingsResult.warnings?.length) {
        for (const warning of repoSettingsResult.warnings) {
          logger.info(`Warning: ${warning}`);
        }
      }
    }
    if (!repoSettingsResult.skipped) {
      settingsCollector.getOrCreate(repoName).settingsResult =
        repoSettingsResult;
    }
  }
}
```

**Step 5: Add settings report to unified summary**

After the repo loop, build and display the settings report alongside the sync report:

```typescript
// Build settings report if any settings were processed
const settingsResults = settingsCollector.getAll();
if (settingsResults.length > 0) {
  const settingsReport = buildSettingsReport(settingsResults);
  const settingsLines = formatSettingsReportCLI(settingsReport);
  for (const line of settingsLines) {
    console.log(line);
  }
  // Include in unified summary
  writeUnifiedSummary({
    lifecycle: lifecycleReport,
    sync: report,
    settings: settingsReport,
    dryRun: options.dryRun ?? false,
  });
} else {
  writeUnifiedSummary({
    lifecycle: lifecycleReport,
    sync: report,
    dryRun: options.dryRun ?? false,
  });
}
```

**Step 6: Import required modules**

Add imports to `sync-command.ts`. Note: `isGitHubRepo` (line 14) and `GitHubRepoInfo` (line 16) are already imported — do NOT add duplicate imports for those.

New imports to add:

```typescript
import {
  RulesetProcessorFactory,
  defaultRulesetProcessorFactory,
  RepoSettingsProcessorFactory,
  defaultRepoSettingsProcessorFactory,
  LabelsProcessorFactory,
  defaultLabelsProcessorFactory,
} from "./types.js";
import { ResultsCollector } from "./settings/results-collector.js";
import { buildSettingsReport } from "./settings-report-builder.js";
import { formatSettingsReportCLI } from "../output/settings-report.js";
```

**Step 7: Run tests**

Run: `npm test`
Expected: PASS

**Step 8: Commit**

```bash
git add src/cli/sync-command.ts src/cli/types.ts test/unit/sync-command.test.ts
git commit -m "feat: add settings processing to sync command"
```

---

### Task 6: Update validator — remove validateForSettings, relax validateForSync

**Files:**

- Modify: `src/config/validator.ts`
- Modify: `src/config/index.ts`
- Test: `test/unit/config-validator.test.ts`

**Step 1: Write failing test**

```typescript
test("validateForSync allows config with only settings and no files", () => {
  const config = {
    id: "test",
    settings: {
      rulesets: { "protect-main": { target: "branch", enforcement: "active" } },
    },
    repos: [{ git: "https://github.com/org/repo" }],
  };
  // Should NOT throw
  assert.doesNotThrow(() => validateForSync(config as RawConfig));
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "allows config with only settings"`
Expected: FAIL — current `validateForSync` requires files

**Step 3: Relax validateForSync**

Rename `validateForSync` to also accept settings-only configs:

```typescript
export function validateForSync(config: RawConfig): void {
  const hasRootFiles = config.files && Object.keys(config.files).length > 0;
  const hasGroupFiles =
    config.groups &&
    Object.values(config.groups).some(
      (g) =>
        g.files &&
        Object.keys(g.files).filter(
          (k) => k !== "inherit" && g.files![k] !== false
        ).length > 0
    );
  const hasSettings = hasActionableSettings(config.settings);
  const hasRepoSettings = config.repos.some((repo) =>
    hasActionableSettings(repo.settings)
  );
  const hasGroupSettings =
    config.groups &&
    typeof config.groups === "object" &&
    !Array.isArray(config.groups) &&
    Object.values(config.groups).some(
      (g) => g.settings && hasActionableSettings(g.settings)
    );

  if (
    !hasRootFiles &&
    !hasGroupFiles &&
    !hasSettings &&
    !hasRepoSettings &&
    !hasGroupSettings
  ) {
    throw new Error(
      "Config requires at least one of: 'files' or 'settings'. " +
        "Use 'files' to sync configuration files, or 'settings' to manage repository settings."
    );
  }
}
```

**Step 4: Remove validateForSettings**

Delete the `validateForSettings` function entirely (line 840 in `src/config/validator.ts`). Remove its export.

Also remove the `validateForSettings` re-export from `src/config/index.ts` (line 122). The validation re-export block should become:

```typescript
export {
  validateRawConfig,
  validateSettings,
  validateForSync,
  hasActionableSettings,
} from "./validator.js";
```

> **Note:** Consider renaming `validateForSync` to `validateConfig` since there is now only one command and the "ForSync" suffix is misleading. The design doc suggests this rename. If renaming, update all callers (search for `validateForSync` across the codebase). This is optional — can be done in this task or deferred to Task 10 cleanup.

**Step 5: Update error message in validateForSync**

Remove the "use xfg settings" reference from the error message since settings is no longer a separate command.

**Step 6: Fix validator tests**

- Remove tests for `validateForSettings`
- Update `validateForSync` tests that expected it to reject settings-only configs
- Add test for settings-only config passing validation

**Step 7: Run tests**

Run: `npm test`
Expected: PASS

**Step 8: Commit**

```bash
git add src/config/validator.ts test/unit/config-validator.test.ts
git commit -m "feat!: unify validation — remove validateForSettings, relax validateForSync"
```

---

### Task 7: Remove settings command and clean up CLI

**Files:**

- Delete: `src/cli/settings-command.ts`
- Delete: `src/cli/settings/process-rulesets.ts`
- Delete: `src/cli/settings/process-labels.ts`
- Delete: `src/cli/settings/process-repo-settings.ts`
- Delete: `src/cli/settings/lifecycle-checks.ts`
- Delete: `src/cli/settings/results-collector.ts` (keep if still used by sync-command)
- Modify: `src/cli/program.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/index.ts`
- Modify: `test/unit/index.test.ts`
- Delete: `test/unit/settings-command.test.ts`
- Delete: `test/unit/settings/process-rulesets.test.ts` (if exists)
- Delete: `test/unit/settings/process-labels.test.ts` (if exists)

**Step 1: Remove settings subcommand from program.ts**

In `src/cli/program.ts`:

- Remove `import { runSettings } from "./settings-command.js"`
- Remove `import type { SettingsOptions } from "./settings-command.js"`
- Remove the entire `settingsCommand` block (lines 97-108)

**Step 2: Delete settings-command.ts**

Remove `src/cli/settings-command.ts`.

**Step 3: Delete settings orchestration modules**

Remove:

- `src/cli/settings/process-rulesets.ts`
- `src/cli/settings/process-labels.ts`
- `src/cli/settings/process-repo-settings.ts`
- `src/cli/settings/lifecycle-checks.ts`

Keep `src/cli/settings/results-collector.ts` — it's now used by `sync-command.ts`.
Keep `src/cli/settings-report-builder.ts` — it's used by `sync-command.ts`.

> **Note:** Deleting `src/cli/settings/process-rulesets.ts` and `src/cli/settings/process-labels.ts` also removes the `"chore/sync-rulesets"` and `"chore/sync-labels"` branch name strings from the codebase (they are only referenced in those two files). Verify with a codebase search after deletion that no other references remain. The `docs/index.md` Mermaid diagrams also reference these branch names — those are cleaned up in Task 13 (docs content).

**Step 4: Update CLI barrel exports**

In `src/cli/index.ts`:

- Remove `runSettings` export
- Remove `SettingsOptions` export

**Step 5: Update public API**

In `src/index.ts`:

- Remove `runSettings` export
- Remove `SettingsOptions` export
- Keep settings processor factories (they're still used by sync-command)

**Step 6: Remove SettingsOptions type**

The `SettingsOptions` type was `SharedOptions`. Since it's gone, ensure `sync-command.ts` doesn't reference it. The settings-command modules that imported it are already deleted.

**Step 7: Delete test files**

Remove:

- `test/unit/settings-command.test.ts`
- Any test files under `test/unit/settings/` that tested the deleted orchestration modules

**Step 7b: Clean up settings tests in `test/unit/index.test.ts`**

This file contains extensive settings command tests that must be removed:

1. Remove the `runSettings` import and related imports (line 1272-1278):

   ```typescript
   import {
     runSettings,
     IRulesetProcessor,
     RulesetProcessorFactory,
   } from "../../src/index.js";
   import type { RulesetProcessorResult } from "../../src/ruleset-processor.js";
   ```

2. Remove the `noopLifecycleManager` const and `MockSettingsRepoProcessor` class (lines 1283-1327)

3. Remove the `MockRulesetProcessor` class (lines 1329-1362)

4. Remove the "settings command CLI" describe block and all its contents (lines 1170-1266), which includes:
   - `settingsTestDir` / `settingsTestConfigPath` variables
   - "argument parsing" tests (help, --config, non-existent config)
   - "config validation" tests (no settings, empty rulesets)

5. Remove the "runSettings with mock processor" describe block and all its contents (line 1367 to end of that block), which includes:
   - `unitTestDir` / `unitTestConfigPath` variables
   - All `runSettings()` test cases

6. Remove the two CLI validation tests that reference the settings command:
   - "settings command fails with files-only config" (line 505-527)
   - "settings command succeeds with settings-only config" (line 529 onward)

**Step 8: Run tests**

Run: `npm test`
Expected: PASS (compilation errors should be gone now)

**Step 9: Commit**

```bash
git add -A
git commit -m "feat!: remove settings command — sync handles everything"
```

---

## Phase 4: Action & CI Updates

### Task 8: Update action.yml

**Files:**

- Modify: `action.yml`

**Step 1: Remove command input**

Remove from `inputs`:

```yaml
command:
  description: "Command to run (sync or settings)"
  required: false
  default: "sync"
```

**Step 2: Simplify the Run step**

Replace the `Run xfg` step. Remove `${{ inputs.command }}` — always run `xfg sync`. Remove the conditional that gates sync-only flags:

```yaml
- name: Run xfg
  shell: bash
  env:
    GH_TOKEN: ${{ inputs.github-token }}
    XFG_GITHUB_APP_ID: ${{ inputs.github-app-id }}
    XFG_GITHUB_APP_PRIVATE_KEY: ${{ inputs.github-app-private-key }}
    AZURE_DEVOPS_EXT_PAT: ${{ inputs.azure-devops-token }}
    GITLAB_TOKEN: ${{ inputs.gitlab-token }}
  run: |
    CMD="xfg sync"
    CMD="$CMD --config ${{ inputs.config }}"
    CMD="$CMD --work-dir ${{ inputs.work-dir }}"
    CMD="$CMD --retries ${{ inputs.retries }}"

    if [ "${{ inputs.dry-run }}" = "true" ]; then
      CMD="$CMD --dry-run"
    fi

    if [ "${{ inputs.no-delete }}" = "true" ]; then
      CMD="$CMD --no-delete"
    fi

    if [ -n "${{ inputs.branch }}" ]; then
      CMD="$CMD --branch ${{ inputs.branch }}"
    fi

    if [ -n "${{ inputs.merge }}" ]; then
      CMD="$CMD --merge ${{ inputs.merge }}"
    fi

    if [ -n "${{ inputs.merge-strategy }}" ]; then
      CMD="$CMD --merge-strategy ${{ inputs.merge-strategy }}"
    fi

    if [ "${{ inputs.delete-branch }}" = "true" ]; then
      CMD="$CMD --delete-branch"
    fi

    echo "Running: $CMD"
    eval "$CMD"
```

**Step 3: Commit**

```bash
git add action.yml
git commit -m "feat!: remove command input from action — always runs sync"
```

---

### Task 9: Update CI integration tests

**Files:**

- Modify: `.github/workflows/_integration-tests.yaml`
- Modify: `test/fixtures/integration-test-action-settings-app.yaml` (review/update comment on line 2; currently says "settings command" — clarify it's now handled via sync)
- Modify: `test/integration/github-app.test.ts`

**Step 0: Update GitHub App integration tests**

`test/integration/github-app.test.ts` has 5 calls to `node dist/cli.js settings` that must be changed to `node dist/cli.js sync`:

- Line 166: `exec(\`node dist/cli.js settings --config ${configPath}\`, xfgEnv)` — in the "settings command with bypass_actors is idempotent" test
- Line 169: `exec(\`node dist/cli.js settings --config ${configPath} --dry-run\`, xfgEnv)` — dry-run follow-up in the same test
- Line 260: `exec(\`node dist/cli.js settings --config ${configPath}\`, xfgEnv)` — in the "repo settings with GitHub App token is idempotent" test
- Line 263: `exec(\`node dist/cli.js settings --config ${configPath}\`, xfgEnv)` — idempotency re-run in the same test
- Line 322: `exec(\`node dist/cli.js settings --config ${rulesetConfig}\`, patOnlyEnv)` — in the "GitHub App Signed Refs Test" beforeEach setup

Replace `settings` with `sync` in all five calls.

**Step 1: Merge settings test jobs**

The following standalone settings test jobs should be merged into the main GitHub sync test or converted to run `xfg sync` instead of `xfg settings`:

- `integration-test-cli-settings-rulesets-pat` → merge into `integration-test-cli-sync-github-pat` or keep separate but run `xfg sync`
- `integration-test-cli-settings-repo-pat` → same
- `integration-test-cli-settings-labels-pat` → same

**Step 2: Update action test for settings**

The `integration-test-action-settings-app` job currently uses `command: settings`. Update it:

- Remove `command: settings` from the `uses: ./` step
- Ensure the fixture config has both files and settings (or settings-only, which now works with sync)

**Step 3: Update integration test files**

The test files have local `runSettings()` wrappers that use the test-helpers `exec()` function. Replace with `runSync()` wrappers:

In `test/integration/github-labels.test.ts`, replace the `runSettings` helper:

```typescript
// OLD:
function runSettings(configPath: string, extraArgs = ""): string {
  return exec(
    `node dist/cli.js settings --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}

// NEW:
function runSync(configPath: string, extraArgs = ""): string {
  return exec(
    `node dist/cli.js sync --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}
```

Then rename all call sites from `runSettings(...)` to `runSync(...)`.

In `test/integration/github-rulesets.test.ts`, the same pattern — replace all:

```typescript
exec(`node dist/cli.js settings --config ${configPath}`, { cwd: projectRoot });
```

with:

```typescript
exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });
```

In `test/integration/github-repo-settings.test.ts`, same change.

**Step 3b: Remove manifest-based assertions, use direct API checks**

Remove calls to `waitForManifestLabels()` — this polls the manifest for tracked labels, which no longer exist in V4. (Note: `waitForManifestRulesets` does not exist — only `waitForManifestLabels` needs removal.)

Replace with direct GitHub API assertions:

```typescript
// OLD: wait for manifest to track the label
// await waitForManifestLabels(testRepo, configId, ["xfg-test-bug"]);

// NEW: verify labels exist via API directly
const labelsJson = exec(`gh api repos/${testRepo}/labels --paginate`);
const labels = JSON.parse(labelsJson) as Array<{ name: string }>;
assert.ok(labels.some((l) => l.name === "xfg-test-bug"));
```

For rulesets:

```typescript
// OLD: wait for manifest to track the ruleset
// NEW: verify ruleset exists via API
const rulesetsJson = exec(`gh api repos/${testRepo}/rulesets`);
const rulesets = JSON.parse(rulesetsJson) as Array<{ name: string }>;
assert.ok(rulesets.some((r) => r.name === "xfg-test-ruleset"));
```

**Step 3c: Add desired-state orphan deletion integration tests**

Add new test cases to verify the v4 desired-state behavior. The design doc specifies 6 scenarios — scenarios 1, 3, 4 are covered above. Add the remaining scenarios:

**Scenario 2: Settings-only config (no files)**

```typescript
test("settings-only config: applies settings via API", async () => {
  // Config with settings but no files section
  const configYaml = `
id: settings-only-test
settings:
  rulesets:
    xfg-test-ruleset:
      target: branch
      enforcement: active
      conditions:
        ref_name:
          include: ["refs/heads/main"]
          exclude: []
      rules: []
repos:
  - git: https://github.com/${testRepo}
`;
  const configPath = writeConfig(tmpDir, configYaml);
  exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

  // Verify ruleset was created
  const rulesets = listRulesets(testRepo);
  assert.ok(rulesets.some((r) => r.name === "xfg-test-ruleset"));
});
```

**Scenario 3: Desired-state orphan deletion for rulesets**

```typescript
test("desired-state: deletes rulesets not in config when deleteOrphaned", async () => {
  // Create a ruleset manually that isn't in config
  exec(
    `gh api --method POST repos/${testRepo}/rulesets ` +
      `-f name="manual-ruleset" -f target=branch -f enforcement=active ` +
      `--input - <<< '{"conditions":{"ref_name":{"include":["refs/heads/main"],"exclude":[]}},"rules":[]}'`
  );

  // Run sync — config only has "xfg-test-ruleset", so "manual-ruleset" should be deleted
  const configPath = makeConfigWithDeleteOrphaned(true);
  exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

  // Verify manual ruleset was deleted
  const rulesets = listRulesets(testRepo);
  assert.ok(!rulesets.some((r) => r.name === "manual-ruleset"));
});
```

**Scenario 5: No labels section = labels untouched**

```typescript
test("no labels section: existing labels are not deleted", async () => {
  // Create a label manually
  exec(
    `gh api --method POST repos/${testRepo}/labels -f name="manual-label" -f color="ff0000"`
  );

  // Config has rulesets but NO settings.labels section
  const configYaml = `
id: no-labels-test
settings:
  rulesets:
    xfg-test-ruleset:
      target: branch
      enforcement: active
      conditions:
        ref_name:
          include: ["refs/heads/main"]
          exclude: []
      rules: []
repos:
  - git: https://github.com/${testRepo}
`;
  const configPath = writeConfig(tmpDir, configYaml);
  exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

  // Verify label was NOT deleted (no labels section = labels untouched)
  const labels = listLabels(testRepo);
  assert.ok(labels.some((l) => l.name === "manual-label"));
});
```

**Scenario 6: deleteOrphaned: false preserves extra rulesets/labels**

```typescript
test("deleteOrphaned false: extra rulesets and labels survive", async () => {
  // Create extra ruleset and label manually
  exec(
    `gh api --method POST repos/${testRepo}/rulesets ` +
      `-f name="extra-ruleset" -f target=branch -f enforcement=active ` +
      `--input - <<< '{"conditions":{"ref_name":{"include":["refs/heads/main"],"exclude":[]}},"rules":[]}'`
  );
  exec(
    `gh api --method POST repos/${testRepo}/labels -f name="extra-label" -f color="00ff00"`
  );

  // Config with deleteOrphaned: false
  const configPath = makeConfigWithDeleteOrphaned(false);
  exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

  // Verify extra ruleset and label were NOT deleted
  const rulesets = listRulesets(testRepo);
  assert.ok(rulesets.some((r) => r.name === "extra-ruleset"));
  const labels = listLabels(testRepo);
  assert.ok(labels.some((l) => l.name === "extra-label"));
});
```

**Step 3d: Add listRulesets() and listLabels() test helpers**

In `test/integration/test-helpers.ts`, add API query helpers (following the existing `exec()` pattern):

```typescript
/**
 * List all rulesets on a repo via GitHub API.
 */
export function listRulesets(
  repo: string,
  envOptions?: { env: Record<string, string | undefined> }
): Array<{ id: number; name: string }> {
  try {
    const json = exec(`gh api repos/${repo}/rulesets`, envOptions);
    return JSON.parse(json) as Array<{ id: number; name: string }>;
  } catch {
    return [];
  }
}

/**
 * List all labels on a repo via GitHub API.
 */
export function listLabels(
  repo: string,
  envOptions?: { env: Record<string, string | undefined> }
): Array<{ name: string; color: string }> {
  try {
    const json = exec(`gh api repos/${repo}/labels --paginate`, envOptions);
    return JSON.parse(json) as Array<{ name: string; color: string }>;
  } catch {
    return [];
  }
}
```

**Step 3e: Remove waitForManifestLabels imports and helpers**

In test files that imported `waitForManifestLabels` from `./test-helpers.js`, remove those imports.

In `test/integration/test-helpers.ts`, remove the `waitForManifestLabels()` function entirely — it polls the `.xfg.json` manifest for tracked labels, which V4 no longer supports.

> **Note:** Only `waitForManifestLabels` exists in `test-helpers.ts`. There is no `waitForManifestRulesets` function — do not attempt to remove it.

**Step 3f: Update resetTestRepo() to always reset labels**

In `test/integration/test-helpers.ts`, `resetTestRepo()` already supports label deletion but only when `options?.deleteLabels` is `true`. Since v4 desired-state orphan detection tests need a clean label state, update the function to always delete labels by default (or update all callers to pass `{ deleteLabels: true }`):

```typescript
// Option A: Change default to always delete labels
export function resetTestRepo(
  repo: string,
  options?: { deleteLabels?: boolean }
): void {
  // ... existing code ...
  // Change: delete labels unconditionally (remove the if guard)
  try {
    const labels = exec(`gh api repos/${repo}/labels --jq '.[].name'`);
    for (const label of labels.split("\n").filter(Boolean)) {
      try {
        exec(
          `gh api --method DELETE repos/${repo}/labels/${encodeURIComponent(label)}`
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no labels */
  }
}
```

**Step 4: Remove obsolete npm scripts**

In `package.json`, the separate settings test scripts may need updating:

- `test:integration:github-rulesets` → update to use sync command
- `test:integration:github-repo-settings` → update to use sync command
- `test:integration:github-labels` → update to use sync command

Or keep them as separate test files that test settings-via-sync behavior.

**Step 5: Commit**

```bash
git add .github/workflows/ test/integration/ package.json
git commit -m "ci!: update integration tests for unified sync command"
```

---

## Phase 5: Final Cleanup

### Task 10: Clean up remaining imports and dead code

**Files:**

- Various files with stale imports

**Step 1: Build and fix all compilation errors**

Run: `npm run build`

Fix any remaining import errors:

- Files importing `validateForSettings` from validator.ts
- Files importing `runSettings` or `SettingsOptions`
- Files importing removed manifest functions
- Files importing `ManifestStrategy` or `ManifestUpdateParams`

**Step 2: Run full test suite**

Run: `npm test`

Fix any remaining test failures.

**Step 3: Run linter**

Run: `./lint.sh`

Fix any lint errors.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: clean up imports and dead code after v4 unification"
```

---

### Task 11: Update JSON schema

**Files:**

- Modify: `config-schema.json` (if needed)

**Step 1: Review schema**

The config YAML schema itself doesn't change (settings block stays the same, just processed by sync now). But verify:

- The `anyOf` constraint at root still allows settings-only configs
- No references to the `settings` CLI command in schema descriptions

**Step 2: Update descriptions if needed**

Review the following `description` fields in `config-schema.json` that reference "settings" and verify none reference `xfg settings` as a CLI command. The current descriptions use "settings" as a noun (config section name), not as a CLI command, so most likely no changes are needed. Specific descriptions to check:

- Line 46: groups description — mentions "settings" as a config section (OK)
- Line 82: root `settings` description — "Global repository settings including GitHub Rulesets" (OK, no CLI reference)
- Line 228: per-repo `settings` description — "Per-repo settings including GitHub Rulesets" (OK)
- Line 407: group `settings` description — "Settings for repos using this group" (OK)
- Line 413: `rootSettings` definition — "Global repository settings..." (OK)
- Line 466: `repoSettings` definition — "Repository settings..." (OK)
- Line 495/501: inherit descriptions (OK)

If any description does reference `xfg settings` as a command, update it to reference `xfg sync`.

**Step 3: Commit (if changes)**

```bash
git add config-schema.json
git commit -m "docs: update schema descriptions for unified sync command"
```

---

### Task 12: Set up versioned docs with mike

**Files:**

- Modify: `mkdocs.yml`
- Modify: `.github/workflows/docs.yaml`

**Step 1: Add mike version provider to mkdocs.yml**

Add to `mkdocs.yml` under the `extra` key (create it if it doesn't exist):

```yaml
extra:
  version:
    provider: mike
    alias: true
```

**Step 2: Install mike in docs workflow**

In `.github/workflows/docs.yaml`, update the Install step to also install `mike`:

```yaml
- name: Install MkDocs Material
  run: pip install 'mkdocs<2' mkdocs-material mike
```

**Step 3: Replace mkdocs build/deploy with mike deploy**

The current workflow builds with `mkdocs build` and uploads as a static artifact to GitHub Pages. Replace the build step and deployment approach to use `mike deploy`:

```yaml
- name: Configure git for mike
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"

- name: Deploy docs with mike
  run: mike deploy --push --update-aliases 4.x latest
```

Remove the `upload-pages-artifact` step and the separate `deploy` job since `mike deploy --push` pushes directly to the `gh-pages` branch.

**Important:** The current workflow uses artifact-based GitHub Pages deployment (`actions/upload-pages-artifact` + `actions/deploy-pages` with `pages: write` and `id-token: write` permissions). Switching to `mike deploy --push` requires:

1. Change workflow permissions from `pages: write` + `id-token: write` to `contents: write` (mike pushes to `gh-pages` branch)
2. In GitHub repo settings, change Pages source from "GitHub Actions" to "Deploy from a branch" → `gh-pages`
3. Remove the `deploy` job entirely (mike handles deployment via git push)
4. Remove the `environment` block from the workflow

**Step 4: Freeze v3 docs**

Before the first v4 deploy, run a one-time command to freeze the current docs as `3.x`:

```bash
mike deploy --push 3.x
```

This can be done manually or as part of the first v4 release. After this, the `latest` alias moves from `3.x` to `4.x`.

**Step 5: Commit**

```bash
git add mkdocs.yml .github/workflows/docs.yaml
git commit -m "ci: add mike versioning for v3/v4 docs"
```

---

### Task 13: Update documentation content

**Files:**

- Modify: `docs/` — various pages
- Modify: `README.md` — if it references `xfg settings`

**Step 1: Find all docs referencing settings command**

Search for references to:

- `xfg settings`
- `settings command`
- `command: settings`
- `chore/sync-rulesets`
- `chore/sync-labels`

Note: `docs/index.md` contains Mermaid diagrams referencing `chore/sync-rulesets` and `chore/sync-labels` branch names — these must be removed or updated.

**Step 2: Update docs pages**

- Replace `xfg settings` references with `xfg sync`
- Remove docs pages specific to the settings command (or redirect)
- Update the getting started / quickstart guides
- Update the action usage examples
- Document the breaking changes
- In `docs/index.md`, remove the entire manifest-tracking branch from each Mermaid flowchart: the `MANIFEST_CHECK` decision node, the `MANIFEST` action node, and the `APPLY --> MANIFEST_CHECK` edge. The `APPLY` node should go directly to `DONE` (i.e., `APPLY --> DONE`). Affected diagrams: Rulesets Processing (lines ~377-380) and Labels Processing (lines ~445-449)
- Update `CLAUDE.md` module descriptions (line 58): change `config-validator.ts` description from `validateForSync`/`validateForSettings` per-command`to reflect that`validateForSettings` no longer exists

**Step 3: Add migration guide**

Add a v3→v4 migration section in the docs covering:

- `xfg settings && xfg sync` → just `xfg sync`
- `deleteOrphaned` behavior change for rulesets/labels
- Manifest auto-migration (V3 → V4)
- `command: settings` removed from action.yml

**Step 4: Commit**

```bash
git add docs/ README.md
git commit -m "docs: update for v4 unified sync command"
```

---

### Task 14: Version bump preparation

**Files:**

- No direct edits — version bump is handled by release workflow

**Step 1: Verify all tests pass**

```bash
npm run build
npm test
./lint.sh
```

**Step 2: Verify integration tests locally (if possible)**

```bash
npm run test:integration:github
```

**Step 3: Create PR**

Create a PR targeting `main` with:

- Title: `feat!: v4 unified command — merge settings into sync`
- Body: Summary of all breaking changes
- Reference the design doc

**Step 4: After PR merge, run release workflow**

Once PR is merged to `main`, trigger the release workflow to bump version and publish:

```bash
gh workflow run release.yaml -f version=major
```

This workflow handles the actual `package.json` version bump and npm publication. Do NOT manually edit `package.json` — the workflow will update it automatically.

---

## Dependency Graph

```
Task 1 (Manifest V4)
  └── Task 2 (Remove ManifestStrategy)
       └── Task 3 (Rulesets desired-state)
            └── Task 4 (Labels desired-state)
                 └── Task 5 (Settings in sync)
                      ├── Task 6 (Validator update)
                      │    └── Task 7 (Remove settings command)
                      │         ├── Task 8 (action.yml)
                      │         ├── Task 9 (CI tests)
                      │         └── Task 10 (Cleanup)
                      │              ├── Task 11 (Schema)
                      │              ├── Task 12 (Versioned docs - mike)
                      │              └── Task 13 (Docs content)
                      └── Task 14 (Version bump) ← depends on Tasks 10-13
```

## Key Risks

1. **Integration test updates (Task 9)** are the highest-risk task — they test against real GitHub repos and the exact test patterns need careful adaptation.
2. **The rulesets/labels desired-state change (Tasks 3-4)** is a behavior change that affects real repos. Users with `deleteOrphaned: true` who have unmanaged rulesets/labels on their repos will see those deleted on the first v4 run. This MUST be documented clearly.
3. **ResultsCollector reuse** — verify `ResultsCollector` from the old settings path works correctly when called from `sync-command.ts`.

## Testing Strategy

- **Unit tests:** Updated in each task (TDD)
- **Integration tests:** Updated in Task 9 — test unified sync with settings
- **Manual verification:** Run `xfg sync` with a settings-only config against a test repo before merging
