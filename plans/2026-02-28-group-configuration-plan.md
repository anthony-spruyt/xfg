# Group Configuration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add support for named config groups that repos reference via `groups: [...]`, creating a merge chain of `root → group1 → group2 → repo overrides`.

**Architecture:** Groups are resolved inside `normalizeConfig()`. Existing root→repo merge logic is extracted into reusable layer-merge functions. Normalized output types are unchanged — groups dissolve during normalization.

**Tech Stack:** TypeScript, node:test, node:assert

---

### Task 1: Add types

**Files:**

- Modify: `src/config/types.ts:441-506`
- Modify: `src/config/index.ts:68-80`

**Step 1: Write failing test**

In `test/unit/config-normalizer.test.ts`, add a new top-level `describe("group configuration")` block at the end of the file (after the existing top-level `describe("normalizeConfig")` block, not nested inside it):

```typescript
describe("group configuration", () => {
  test("single group merges files onto root", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "root.json": { content: { fromRoot: true } },
      },
      groups: {
        mygroup: {
          files: {
            "group.json": { content: { fromGroup: true } },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw);
    assert.equal(result.repos.length, 1);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("root.json"));
    assert.ok(fileNames.includes("group.json"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="single group merges files onto root" 2>&1 | tail -20`
Expected: TypeScript compilation error — `groups` does not exist on `RawConfig`

**Step 3: Add types**

In `src/config/types.ts`, add `RawGroupConfig` after the `RawRepoFileOverride` interface (after line 464):

```typescript
// Group configuration (shared config layer between root and per-repo)
// Groups need the same file override capabilities as repos: file: false to remove,
// inherit: false to discard accumulated files. So files uses the repo-style type.
// Groups need inherit: false support on settings sub-sections (rulesets, labels),
// so settings uses RawRepoSettings (which has inherit on rulesets/labels).
export interface RawGroupConfig {
  files?: Record<string, RawFileConfig | RawRepoFileOverride | false> & {
    inherit?: boolean;
  };
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
}
```

Add `groups` to `RawConfig` (after the `files` field, line 499):

```typescript
  groups?: Record<string, RawGroupConfig>;
```

Add `groups` to `RawRepoConfig` (after the `prOptions` field, line 488):

```typescript
  groups?: string[];
```

In `src/config/index.ts`, add `RawGroupConfig` to the type re-exports (around line 75):

```typescript
  RawGroupConfig,
```

**Step 4: Run test to verify it still fails**

Run: `npm test -- --test-name-pattern="single group merges files onto root" 2>&1 | tail -20`
Expected: Types compile, but test fails — group files not included in output (normalizer doesn't process groups yet)

**Step 5: Commit**

```bash
git add src/config/types.ts src/config/index.ts test/unit/config-normalizer.test.ts
git commit -m "feat(groups): add RawGroupConfig type and group fields to RawConfig/RawRepoConfig"
```

---

### Task 2: Extract `mergeFileLayer()` from normalizer

**Files:**

- Modify: `src/config/normalizer.ts:216-365`

The current normalizer has file merging logic inline (lines 232-348). Extract it into a reusable function that merges one layer of file overrides onto an accumulated file map.

**Step 1: Write failing test**

Add to the `describe("group configuration")` block:

```typescript
test("repo with no groups behaves identically to before", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        files: {
          "config.json": { content: { extra: true } },
        },
      },
    ],
  };

  const result = normalizeConfig(raw);
  assert.equal(result.repos.length, 1);
  assert.equal(result.repos[0].files.length, 1);
  assert.deepStrictEqual(result.repos[0].files[0].content, {
    key: "value",
    extra: true,
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="repo with no groups behaves identically" 2>&1 | tail -20`
Expected: PASS — this is a regression guard for the extraction refactor

**Step 3: Extract and refactor**

Extract from `normalizeConfig()` the following functions:

1. `mergeGroupFiles(rootFiles, groupNames, groupDefs)` — iterates through groups in order, building an effective root file map (`Record<string, RawFileConfig>`). Each group layer is processed as follows:
   - If `inherit: false`, clear the accumulated map entirely before processing the group's files. This is intentional: `inherit: false` means "discard everything above me in the chain" per the design. This differs from the existing normalizer's skip-filter pattern (used at the repo layer in `buildFileContents`), because groups build a new effective root, while repos filter from it.
   - `file: false` removes the named file from the accumulated map (use `delete accumulated[fileName]`).
   - For files that exist in the accumulated map, deep-merge content using the same `deepMerge()` + `createMergeContext()` utilities the normalizer already uses for root-to-repo merging. Non-content properties (`createOnly`, `executable`, `header`, `schemaUrl`, `template`, `vars`, `deleteOrphaned`, `mergeStrategy`) use per-field override (later wins). If the group file has `override: true`, replace content entirely instead of deep-merging.
   - New files (not in accumulated map) are added directly.

   Returns the effective root files. The existing per-file loop in `normalizeConfig()` then processes repo overrides against this effective root.

   ```typescript
   function mergeGroupFiles(
     rootFiles: Record<string, RawFileConfig>,
     groupNames: string[],
     groupDefs: Record<string, RawGroupConfig>
   ): Record<string, RawFileConfig> {
     let accumulated: Record<string, RawFileConfig> = { ...rootFiles };

     for (const groupName of groupNames) {
       const group = groupDefs[groupName];
       if (!group?.files) continue;

       const inheritFiles =
         (group.files as Record<string, unknown>)?.inherit !== false;

       if (!inheritFiles) {
         // Intentionally clear: "discard everything above me"
         accumulated = {};
       }

       for (const [fileName, fileConfig] of Object.entries(group.files)) {
         if (fileName === "inherit") continue;

         // file: false removes from accumulated set
         if (fileConfig === false) {
           delete accumulated[fileName];
           continue;
         }

         if (fileConfig === undefined) continue;

         const existing = accumulated[fileName];
         if (existing) {
           // Deep-merge content if both sides have object content
           const overlay = fileConfig as RawRepoFileOverride;
           let mergedContent: ContentValue | undefined;

           if (overlay.override || !existing.content || !overlay.content) {
             // override:true or one side missing content — use overlay content
             mergedContent = overlay.content ?? existing.content;
           } else if (
             isTextContent(existing.content) &&
             isTextContent(overlay.content)
           ) {
             mergedContent = mergeTextContent(
               existing.content,
               overlay.content,
               existing.mergeStrategy ?? "replace"
             );
           } else if (
             !isTextContent(existing.content) &&
             !isTextContent(overlay.content)
           ) {
             const ctx = createMergeContext(
               existing.mergeStrategy ?? "replace"
             );
             mergedContent = deepMerge(
               structuredClone(existing.content as Record<string, unknown>),
               overlay.content as Record<string, unknown>,
               ctx
             );
             mergedContent = stripMergeDirectives(mergedContent);
           } else {
             // Type mismatch — overlay wins
             mergedContent = overlay.content;
           }

           accumulated[fileName] = {
             ...existing,
             ...fileConfig,
             content: mergedContent,
           };
         } else {
           // New file introduced by group
           accumulated[fileName] = fileConfig as RawFileConfig;
         }
       }
     }

     return accumulated;
   }
   ```

2. `mergeGroupPROptions(rootPR, groupNames, groupDefs)` — iterates through groups, calling `mergePROptions()` at each step. Returns accumulated PR options.

3. `mergeGroupSettings(rootSettings, groupNames, groupDefs)` — iterates through groups, calling `mergeRawSettings()` (new function, see Task 5) at each step to chain raw settings layers. Returns accumulated `RawRootSettings`.

Then in `normalizeConfig()`, for each repo:

- If `rawRepo.groups` exists, call the three merge functions to get effective root files/prOptions/settings
- Use these effective values in the existing per-file and per-repo merge logic

**Step 4: Run ALL existing normalizer tests**

Run: `npm test -- --test-name-pattern="normalizeConfig" 2>&1 | tail -40`
Expected: ALL PASS — extraction is a pure refactor

**Step 5: Commit**

```bash
git add src/config/normalizer.ts
git commit -m "refactor(groups): extract group merge functions from normalizeConfig"
```

---

### Task 3: Implement group file merging in normalizer

**Files:**

- Modify: `src/config/normalizer.ts`
- Modify: `test/unit/config-normalizer.test.ts`

**Step 1: Run the failing test from Task 1**

Run: `npm test -- --test-name-pattern="single group merges files onto root" 2>&1 | tail -20`
Expected: FAIL — group files not yet wired into normalization

**Step 2: Wire group file merging into `normalizeConfig()`**

In the `normalizeConfig()` function, after git array expansion and before the per-file loop, add:

```typescript
// Resolve groups: build effective root files by merging group layers
const effectiveRootFiles = rawRepo.groups?.length
  ? mergeGroupFiles(raw.files ?? {}, rawRepo.groups, raw.groups ?? {})
  : (raw.files ?? {});
```

Then use `effectiveRootFiles` instead of `raw.files` in the per-file loop. Critically, the `fileNames` variable (currently computed as `Object.keys(raw.files)` at line 218 of `normalizer.ts`) must be recomputed per-repo as `Object.keys(effectiveRootFiles)` so that files introduced by groups are included in the iteration. Move the `fileNames` computation inside the per-repo loop:

```typescript
const fileNames = Object.keys(effectiveRootFiles);
```

**Step 3: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="single group merges files onto root" 2>&1 | tail -20`
Expected: PASS

**Step 4: Run all normalizer tests for regression**

Run: `npm test -- --test-name-pattern="normalizeConfig" 2>&1 | tail -40`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/config/normalizer.ts
git commit -m "feat(groups): wire group file merging into normalizeConfig"
```

---

### Task 4: Add normalizer tests for group file scenarios

**Files:**

- Modify: `test/unit/config-normalizer.test.ts`

**Step 1: Write tests**

Add these tests to the `describe("group configuration")` block:

```typescript
test("multiple groups merge left-to-right, later wins", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "root.json": { content: { fromRoot: true } },
    },
    groups: {
      groupA: {
        files: { "shared.json": { content: { source: "A" } } },
      },
      groupB: {
        files: { "shared.json": { content: { source: "B" } } },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["groupA", "groupB"],
      },
    ],
  };

  const result = normalizeConfig(raw);
  const shared = result.repos[0].files.find(
    (f) => f.fileName === "shared.json"
  );
  assert.deepStrictEqual(shared?.content, { source: "B" });
});

test("repo overrides group file", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "config.json": { content: { base: true } },
    },
    groups: {
      mygroup: {
        files: {
          "config.json": { content: { fromGroup: true } },
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
        files: {
          "config.json": { content: { fromRepo: true } },
        },
      },
    ],
  };

  const result = normalizeConfig(raw);
  const config = result.repos[0].files.find(
    (f) => f.fileName === "config.json"
  );
  // Deep merge: root → group → repo
  assert.equal((config?.content as Record<string, unknown>).base, true);
  assert.equal((config?.content as Record<string, unknown>).fromGroup, true);
  assert.equal((config?.content as Record<string, unknown>).fromRepo, true);
});

test("group inherit:false discards root files", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "root.json": { content: { fromRoot: true } },
    },
    groups: {
      mygroup: {
        files: {
          inherit: false,
          "group.json": { content: { fromGroup: true } },
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
      },
    ],
  };

  const result = normalizeConfig(raw);
  const fileNames = result.repos[0].files.map((f) => f.fileName);
  assert.ok(!fileNames.includes("root.json"));
  assert.ok(fileNames.includes("group.json"));
});

test("repo inherit:false discards root and group files", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "root.json": { content: { fromRoot: true } },
    },
    groups: {
      mygroup: {
        files: {
          "group.json": { content: { fromGroup: true } },
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
        files: {
          inherit: false,
          "repo.json": { content: { fromRepo: true } },
        } as Record<string, any>,
      },
    ],
  };

  const result = normalizeConfig(raw);
  // With inherit:false on repo and no root definition of repo.json,
  // the repo file won't appear (it needs a root definition to be processed).
  // This test verifies root and group files are excluded.
  const fileNames = result.repos[0].files.map((f) => f.fileName);
  assert.ok(!fileNames.includes("root.json"));
  assert.ok(!fileNames.includes("group.json"));
});

test("group file:false excludes a root file", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "keep.json": { content: { keep: true } },
      "remove.json": { content: { remove: true } },
    },
    groups: {
      mygroup: {
        files: {
          "remove.json": false,
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
      },
    ],
  };

  const result = normalizeConfig(raw);
  const fileNames = result.repos[0].files.map((f) => f.fileName);
  assert.ok(fileNames.includes("keep.json"));
  assert.ok(!fileNames.includes("remove.json"));
});

test("repo file:false excludes a group file", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {},
    groups: {
      mygroup: {
        files: {
          "group.json": { content: { fromGroup: true } },
          "other.json": { content: { other: true } },
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
        files: {
          "group.json": false,
        },
      },
    ],
  };

  const result = normalizeConfig(raw);
  const fileNames = result.repos[0].files.map((f) => f.fileName);
  assert.ok(!fileNames.includes("group.json"));
  assert.ok(fileNames.includes("other.json"));
});

test("git array expansion with groups", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {},
    groups: {
      mygroup: {
        files: {
          "group.json": { content: { fromGroup: true } },
        },
      },
    },
    repos: [
      {
        git: ["git@github.com:org/repo1.git", "git@github.com:org/repo2.git"],
        groups: ["mygroup"],
      },
    ],
  };

  const result = normalizeConfig(raw);
  assert.equal(result.repos.length, 2);
  assert.equal(result.repos[0].files.length, 1);
  assert.equal(result.repos[1].files.length, 1);
  assert.equal(result.repos[0].files[0].fileName, "group.json");
  assert.equal(result.repos[1].files[0].fileName, "group.json");
});

test("no groups field on repo behaves identically", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    repos: [{ git: "git@github.com:org/repo.git" }],
  };

  const result = normalizeConfig(raw);
  assert.equal(result.repos.length, 1);
  assert.equal(result.repos[0].files.length, 1);
  assert.deepStrictEqual(result.repos[0].files[0].content, { key: "value" });
});

test("empty groups array behaves identically", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: [],
      },
    ],
  };

  const result = normalizeConfig(raw);
  assert.equal(result.repos[0].files.length, 1);
  assert.deepStrictEqual(result.repos[0].files[0].content, { key: "value" });
});

test("override:true at group level replaces root file content", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "config.json": { content: { fromRoot: true, shared: "root" } },
    },
    groups: {
      mygroup: {
        files: {
          "config.json": {
            content: { fromGroup: true },
            override: true,
          },
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
      },
    ],
  };

  const result = normalizeConfig(raw);
  const config = result.repos[0].files[0];
  assert.deepStrictEqual(config.content, { fromGroup: true });
});

test("override:true at repo level replaces group file content", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "config.json": { content: { fromRoot: true } },
    },
    groups: {
      mygroup: {
        files: {
          "config.json": {
            content: { fromGroup: true, shared: "group" },
          },
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
        files: {
          "config.json": {
            content: { fromRepo: true },
            override: true,
          },
        },
      },
    ],
  };

  const result = normalizeConfig(raw);
  const config = result.repos[0].files[0];
  // override:true at repo level replaces all accumulated content (root + group)
  assert.deepStrictEqual(config.content, { fromRepo: true });
});
```

**Step 2: Run tests**

Run: `npm test -- --test-name-pattern="group configuration" 2>&1 | tail -40`
Expected: ALL PASS (implementation was done in Task 3)

**Step 3: Commit**

```bash
git add test/unit/config-normalizer.test.ts
git commit -m "test(groups): add normalizer tests for group file scenarios"
```

---

### Task 5: Implement group prOptions and settings merging

**Files:**

- Modify: `src/config/normalizer.ts`
- Modify: `test/unit/config-normalizer.test.ts`

**Step 1: Write failing tests**

Add to the `describe("group configuration")` block:

```typescript
test("group prOptions merge into chain", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    prOptions: { merge: "auto" },
    groups: {
      mygroup: {
        prOptions: { labels: ["from-group"] },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
      },
    ],
  };

  const result = normalizeConfig(raw);
  assert.equal(result.repos[0].prOptions?.merge, "auto");
  assert.deepStrictEqual(result.repos[0].prOptions?.labels, ["from-group"]);
});

test("group settings merge into chain", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    settings: {
      rulesets: {
        "base-protection": {
          target: "branch",
          enforcement: "active",
        },
      },
    },
    groups: {
      mygroup: {
        settings: {
          rulesets: {
            "group-protection": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
      },
    ],
  };

  const result = normalizeConfig(raw);
  assert.ok(result.repos[0].settings?.rulesets?.["base-protection"]);
  assert.ok(result.repos[0].settings?.rulesets?.["group-protection"]);
});

test("group settings.rulesets.inherit:false discards accumulated rulesets", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    settings: {
      rulesets: {
        "root-protection": {
          target: "branch",
          enforcement: "active",
        },
      },
    },
    groups: {
      mygroup: {
        settings: {
          rulesets: {
            inherit: false,
            "group-only-protection": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
      },
    ],
  };

  const result = normalizeConfig(raw);
  // Group's inherit:false discards root rulesets
  assert.ok(!result.repos[0].settings?.rulesets?.["root-protection"]);
  assert.ok(result.repos[0].settings?.rulesets?.["group-only-protection"]);
});

test("repo prOptions override group prOptions", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    groups: {
      mygroup: {
        prOptions: { merge: "auto", labels: ["from-group"] },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["mygroup"],
        prOptions: { merge: "force" },
      },
    ],
  };

  const result = normalizeConfig(raw);
  assert.equal(result.repos[0].prOptions?.merge, "force");
  assert.deepStrictEqual(result.repos[0].prOptions?.labels, ["from-group"]);
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="group prOptions|group settings" 2>&1 | tail -20`
Expected: FAIL — group prOptions/settings not wired yet

**Step 3: Implement group prOptions and settings merging**

In `normalizeConfig()`, after computing `effectiveRootFiles`, also compute:

```typescript
const effectivePROptions = rawRepo.groups?.length
  ? mergeGroupPROptions(raw.prOptions, rawRepo.groups, raw.groups ?? {})
  : raw.prOptions;

const effectiveSettings = rawRepo.groups?.length
  ? mergeGroupSettings(raw.settings, rawRepo.groups, raw.groups ?? {})
  : raw.settings;
```

Then use `effectivePROptions` and `effectiveSettings` instead of `raw.prOptions` and `raw.settings` in the existing `mergePROptions()` and `mergeSettings()` calls.

The helper functions:

```typescript
function mergeGroupPROptions(
  rootPR: PRMergeOptions | undefined,
  groupNames: string[],
  groupDefs: Record<string, RawGroupConfig>
): PRMergeOptions | undefined {
  let accumulated = rootPR;
  for (const name of groupNames) {
    const group = groupDefs[name];
    if (group?.prOptions) {
      accumulated = mergePROptions(accumulated, group.prOptions);
    }
  }
  return accumulated;
}

function mergeGroupSettings(
  rootSettings: RawRootSettings | undefined,
  groupNames: string[],
  groupDefs: Record<string, RawGroupConfig>
): RawRootSettings | undefined {
  let accumulated = rootSettings;
  for (const name of groupNames) {
    const group = groupDefs[name];
    if (group?.settings) {
      // group.settings is RawRepoSettings (supports inherit: false on sub-sections)
      // mergeRawSettings preserves raw types for chaining
      accumulated = mergeRawSettings(accumulated, group.settings);
    }
  }
  return accumulated;
}
```

**Designing `mergeRawSettings()`:** The existing `mergeSettings(root: RawRootSettings, perRepo: RawRepoSettings): RepoSettings` cannot be used for group-to-group chaining because (a) it returns the normalized `RepoSettings` type (no `false` values, no `inherit` keys), and (b) its second parameter is `RawRepoSettings` while we need to merge two raw layers.

Create a new `mergeRawSettings()` function that merges two raw settings layers and returns a raw settings result, preserving the `false` and `inherit` semantics for downstream layers:

```typescript
/**
 * Merges two raw settings layers (root/group into accumulated).
 * Unlike mergeSettings(), this operates on raw types and returns raw types,
 * preserving false values and inherit keys for downstream processing.
 * The final accumulated result feeds into the existing mergeSettings(accumulated, repoSettings).
 */
function mergeRawSettings(
  base: RawRootSettings | undefined,
  overlay: RawRepoSettings | undefined
): RawRootSettings | undefined {
  if (!base && !overlay) return undefined;
  if (!base) return overlayToRoot(overlay!);
  if (!overlay) return structuredClone(base);

  const result: RawRootSettings = structuredClone(base);

  // Merge rulesets
  if (overlay.rulesets) {
    const inheritRulesets =
      (overlay.rulesets as Record<string, unknown>)?.inherit !== false;
    if (!inheritRulesets) {
      // Discard accumulated rulesets, start fresh with overlay's own
      result.rulesets = {};
    }
    if (!result.rulesets) result.rulesets = {};
    for (const [name, ruleset] of Object.entries(overlay.rulesets)) {
      if (name === "inherit") continue;
      if (ruleset === false) {
        result.rulesets[name] = false;
      } else {
        const existing = result.rulesets[name];
        result.rulesets[name] =
          existing && existing !== false
            ? (mergeRuleset(existing, ruleset) as Ruleset)
            : structuredClone(ruleset);
      }
    }
  }

  // Merge repo settings: overlay replaces base (shallow merge, same as mergeSettings)
  if (overlay.repo !== undefined) {
    if (overlay.repo === false) {
      result.repo = false;
    } else {
      result.repo = {
        ...(result.repo === false ? {} : result.repo),
        ...overlay.repo,
      } as GitHubRepoSettings;
    }
  }

  // Merge labels
  if (overlay.labels) {
    const inheritLabels =
      (overlay.labels as Record<string, unknown>)?.inherit !== false;
    if (!inheritLabels) {
      result.labels = {};
    }
    if (!result.labels) result.labels = {};
    for (const [name, label] of Object.entries(overlay.labels)) {
      if (name === "inherit") continue;
      if (label === false) {
        result.labels[name] = false;
      } else {
        const existing = result.labels[name];
        result.labels[name] = {
          ...(existing && existing !== false ? existing : {}),
          ...label,
        };
      }
    }
  }

  // deleteOrphaned: overlay wins
  if (overlay.deleteOrphaned !== undefined) {
    result.deleteOrphaned = overlay.deleteOrphaned;
  }

  return result;
}

/**
 * Converts a RawRepoSettings to RawRootSettings by stripping inherit keys.
 * Used when there's no base to merge with.
 */
function overlayToRoot(overlay: RawRepoSettings): RawRootSettings {
  const result: RawRootSettings = {};
  if (overlay.rulesets) {
    result.rulesets = {};
    for (const [name, ruleset] of Object.entries(overlay.rulesets)) {
      if (name === "inherit") continue;
      result.rulesets[name] = structuredClone(ruleset);
    }
  }
  if (overlay.repo !== undefined)
    result.repo = structuredClone(overlay.repo) as GitHubRepoSettings | false;
  if (overlay.labels) {
    result.labels = {};
    for (const [name, label] of Object.entries(overlay.labels)) {
      if (name === "inherit") continue;
      result.labels[name] = structuredClone(label);
    }
  }
  if (overlay.deleteOrphaned !== undefined)
    result.deleteOrphaned = overlay.deleteOrphaned;
  return result;
}
```

Then `mergeGroupSettings()` uses `mergeRawSettings()` for group-to-group chaining, and the final accumulated `RawRootSettings` feeds into the existing `mergeSettings(accumulated, rawRepo.settings)` for the repo layer.

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="group prOptions|group settings|repo prOptions override" 2>&1 | tail -20`
Expected: PASS

**Step 5: Run all normalizer tests for regression**

Run: `npm test -- --test-name-pattern="normalizeConfig" 2>&1 | tail -40`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/config/normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat(groups): implement group prOptions and settings merging"
```

---

### Task 6: Add group validation

**Files:**

- Modify: `src/config/validator.ts:195-628`
- Modify: `test/unit/config-validator.test.ts`

**Step 1: Write failing tests**

Add a new `describe("group validation")` block inside the existing `describe("validateRawConfig")` block in `test/unit/config-validator.test.ts`:

```typescript
describe("group validation", () => {
  const createValidConfig = (overrides?: Partial<RawConfig>): RawConfig => ({
    id: "test-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    repos: [{ git: "git@github.com:org/repo.git" }],
    ...overrides,
  });

  test("valid group config passes", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: { "extra.json": { content: { key: "value" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("throws for unknown group reference", () => {
    const config = createValidConfig({
      groups: {
        mygroup: { files: {} },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["nonexistent"] }],
    });
    assert.throws(
      () => validateRawConfig(config),
      /group 'nonexistent' is not defined/
    );
  });

  test("throws for duplicate group in repo list", () => {
    const config = createValidConfig({
      groups: {
        mygroup: { files: {} },
      },
      repos: [
        { git: "git@github.com:org/repo.git", groups: ["mygroup", "mygroup"] },
      ],
    });
    assert.throws(() => validateRawConfig(config), /duplicate group 'mygroup'/);
  });

  test("throws for reserved group name 'inherit'", () => {
    const config = createValidConfig({
      groups: {
        inherit: { files: {} },
      } as any,
    });
    assert.throws(() => validateRawConfig(config), /reserved/i);
  });

  test("throws when groups is not an object", () => {
    const config = createValidConfig({
      groups: ["not-an-object"] as any,
    });
    assert.throws(() => validateRawConfig(config), /groups must be an object/);
  });

  test("throws when repo groups is not an array of strings", () => {
    const config = createValidConfig({
      groups: { mygroup: { files: {} } },
      repos: [{ git: "git@github.com:org/repo.git", groups: [123] } as any],
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups must be an array of strings/
    );
  });

  test("validates group file configs", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: {
            "config.json": { content: 123 } as any,
          },
        },
      },
    });
    assert.throws(() => validateRawConfig(config), /content must be/);
  });

  test("validates group settings", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          settings: {
            rulesets: "not-an-object",
          } as any,
        },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /rulesets must be an object/
    );
  });

  test("repo can reference file defined only in group", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: { "group-only.json": { content: { key: "value" } } },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          files: {
            "group-only.json": { content: { override: true } },
          },
        },
      ],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="group validation" 2>&1 | tail -20`
Expected: FAIL — no group validation in `validateRawConfig` yet

**Step 3: Implement validation**

In `validateRawConfig()` in `src/config/validator.ts`, add group validation after the root settings validation block and before the repo loop:

1. Validate `config.groups` structure (if present, must be an object)
2. For each group: validate name not reserved, validate files (reuse existing file validation logic), validate settings (reuse `validateSettings()`), validate prOptions
3. In the repo loop: validate `repo.groups` is array of strings, each references a defined group, no duplicates
4. When validating per-repo file overrides, also check group-defined files (not just root files). The existing check at line 486 of `validator.ts`:
   ```typescript
   if (!config.files || !config.files[fileName]) {
     throw new Error(
       `Repo at index ${i} references undefined file '${fileName}'. ...`
     );
   }
   ```
   Must be expanded to also consider files defined in the repo's referenced groups. Build a set of known file names from root files + all groups the repo references:
   ```typescript
   // Collect known file names from root + repo's groups
   const knownFiles = new Set<string>(
     config.files ? Object.keys(config.files) : []
   );
   if (repo.groups && config.groups) {
     for (const groupName of repo.groups) {
       const group = config.groups[groupName];
       if (group?.files) {
         for (const fn of Object.keys(group.files)) {
           if (fn !== "inherit") knownFiles.add(fn);
         }
       }
     }
   }
   // Then check: if (!knownFiles.has(fileName)) { throw ... }
   ```
   This ensures a repo can override a file introduced by one of its groups without the validator rejecting it

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="group validation" 2>&1 | tail -20`
Expected: ALL PASS

**Step 5: Run all validator tests for regression**

Run: `npm test -- --test-name-pattern="validateRawConfig" 2>&1 | tail -40`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/config/validator.ts test/unit/config-validator.test.ts
git commit -m "feat(groups): add group validation to validateRawConfig"
```

---

### Task 7: Add `@file` reference resolution for groups

**Files:**

- Modify: `src/config/file-reference-resolver.ts:122-186`
- Modify: `test/unit/file-reference-resolver.test.ts`

**Step 1: Write failing test**

Add to `test/unit/file-reference-resolver.test.ts`:

```typescript
describe("group file references", () => {
  test("resolves @file refs in group file content", () => {
    const jsonPath = join(testDir, "templates", "group-config.json");
    writeFileSync(jsonPath, '{"fromGroup": true}', "utf-8");

    const raw: RawConfig = {
      id: "test",
      files: {},
      groups: {
        mygroup: {
          files: {
            "config.json": { content: "@templates/group-config.json" },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    };

    const result = resolveFileReferencesInConfig(raw, { configDir: testDir });
    const groupFile = result.groups!.mygroup.files!["config.json"];
    assert.deepStrictEqual(groupFile.content, { fromGroup: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="resolves @file refs in group" 2>&1 | tail -20`
Expected: FAIL — `resolveFileReferencesInConfig` doesn't walk groups

**Step 3: Implement**

In `resolveFileReferencesInConfig()` in `src/config/file-reference-resolver.ts`, add a block after the root-level file resolution (after line 156) and before the per-repo resolution:

```typescript
// Resolve group-level file content
if (result.groups) {
  for (const [groupName, group] of Object.entries(result.groups)) {
    if (group.files) {
      for (const [fileName, fileConfig] of Object.entries(group.files)) {
        if (
          fileConfig &&
          typeof fileConfig === "object" &&
          "content" in fileConfig
        ) {
          const resolved = resolveContentValue(fileConfig.content, configDir);
          if (resolved !== undefined) {
            result.groups[groupName].files![fileName] = {
              ...fileConfig,
              content: resolved,
            };
          }
        }
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="resolves @file refs in group" 2>&1 | tail -20`
Expected: PASS

**Step 5: Run all file-reference tests for regression**

Run: `npm test -- --test-name-pattern="File Reference" 2>&1 | tail -20`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/config/file-reference-resolver.ts test/unit/file-reference-resolver.test.ts
git commit -m "feat(groups): resolve @file references in group file content"
```

---

### Task 8: Loosen `validateForSync()` gate

**Files:**

- Modify: `src/config/validator.ts:638-653`
- Modify: `test/unit/config-validator.test.ts`

**Step 1: Write failing test**

Add to `test/unit/config-validator.test.ts` in the `validateForSync` describe block:

```typescript
test("passes when groups define files but root files is empty", () => {
  const config: RawConfig = {
    id: "test-config",
    files: {},
    groups: {
      mygroup: {
        files: { "config.json": { content: { key: "value" } } },
      },
    },
    repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
  };
  assert.doesNotThrow(() => validateForSync(config));
});

test("passes when groups define files and no root files field", () => {
  const config = {
    id: "test-config",
    groups: {
      mygroup: {
        files: { "config.json": { content: { key: "value" } } },
      },
    },
    repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
  } as RawConfig;
  assert.doesNotThrow(() => validateForSync(config));
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="passes when groups define files" 2>&1 | tail -20`
Expected: FAIL — `validateForSync` requires root `files`

**Step 3: Implement**

Update `validateForSync()` to also check groups for file definitions:

```typescript
export function validateForSync(config: RawConfig): void {
  const hasRootFiles = config.files && Object.keys(config.files).length > 0;
  const hasGroupFiles =
    config.groups &&
    Object.values(config.groups).some(
      (g) => g.files && Object.keys(g.files).length > 0
    );

  if (!hasRootFiles && !hasGroupFiles) {
    throw new Error(
      "The 'sync' command requires files defined in root 'files' or in at least one group. " +
        "To manage repository settings instead, use 'xfg settings'."
    );
  }
}
```

Also update the `validateRawConfig` gate that checks for `hasFiles || hasSettings` to also consider groups:

```typescript
const hasGroupFiles =
  config.groups &&
  Object.values(config.groups).some(
    (g) => g.files && Object.keys(g.files).length > 0
  );
const hasGroupSettings =
  config.groups &&
  Object.values(config.groups).some(
    (g) => g.settings && typeof g.settings === "object"
  );

if (!hasFiles && !hasSettings && !hasGroupFiles && !hasGroupSettings) {
  throw new Error(/* ... */);
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="passes when groups define files" 2>&1 | tail -20`
Expected: PASS

**Step 5: Run all validator tests for regression**

Run: `npm test -- --test-name-pattern="validateForSync|validateRawConfig" 2>&1 | tail -40`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/config/validator.ts test/unit/config-validator.test.ts
git commit -m "feat(groups): loosen validateForSync to accept group-defined files"
```

---

### Task 9: Update integration test fixture to use groups

**Files:**

- Modify: `test/integration/github.test.ts`

**Step 1: Modify the first integration test to use a group**

Update the `"sync creates a PR in the test repository"` test to define a group and reference it from the repo. The test should produce identical sync results but exercise the full pipeline with groups.

Change the config from:

```yaml
id: integration-test-github
files:
  my.config.json:
    content:
      prop1: base-value
      prop2:
        prop3: MyService
      prop4:
        prop5:
          - prop6: platform
          - prop7: engineering
      baseOnly: inherited-from-root
repos:
  - git: https://github.com/${testRepo}.git
    files:
      my.config.json:
        content:
          prop1: main
          addedByOverlay: true
```

To:

```yaml
id: integration-test-github
files:
  my.config.json:
    content:
      prop1: base-value
      baseOnly: inherited-from-root
groups:
  service-config:
    files:
      my.config.json:
        content:
          prop2:
            prop3: MyService
          prop4:
            prop5:
              - prop6: platform
              - prop7: engineering
repos:
  - git: https://github.com/${testRepo}.git
    groups: [service-config]
    files:
      my.config.json:
        content:
          prop1: main
          addedByOverlay: true
```

The assertions stay the same — the merged result should be identical.

**Step 2: Run the integration test locally (if credentials available)**

Run: `npm run test:integration:github 2>&1 | tail -40`
Expected: PASS — same merged output, groups are transparent

**Step 3: Commit**

```bash
git add test/integration/github.test.ts
git commit -m "test(groups): update GitHub integration test to use group configuration"
```

---

### Task 10: Update docs

**Files:**

- Modify: `docs/` (relevant documentation pages)

**Step 1: Check existing docs structure**

Run: `ls docs/` to identify which pages need updating.

**Step 2: Update documentation**

Add a "Groups" section to the configuration documentation covering:

- Syntax (groups map + repo `groups` field)
- Merge chain explanation
- `inherit: false` and `file: false` at each layer
- Example configurations
- Multiple groups per repo

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs(groups): add group configuration documentation"
```

---

### Task 11: Run full test suite and lint

**Step 1: Run all unit tests**

Run: `npm test 2>&1 | tail -40`
Expected: ALL PASS

**Step 2: Run lint**

Run: `./lint.sh 2>&1 | tail -20`
Expected: PASS

**Step 3: Fix any issues and commit**

If lint or tests fail, fix and commit fixes.
