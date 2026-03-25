# Conditional Group Inclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `conditionalGroups` support so groups activate based on which other groups
a repo has, enabling intersection-based config (e.g., `renovate/terraform` label only
when both groups are present).

**Architecture:** New top-level `conditionalGroups` array on `RawConfig`. Each entry has
a `when` clause (`allOf`/`anyOf`) and the same `files`/`prOptions`/`settings` as regular
groups. The normalizer resolves them in a new Phase 3 between explicit groups and repo
overrides. A new `mergeConditionalGroups` function evaluates conditions and delegates to
existing merge primitives. Validation reuses existing group validation functions.

**Tech Stack:** TypeScript, Node.js test runner, node:assert

**Spec:**
[plans/superpowers/specs/2026-03-25-conditional-group-inclusion-design.md](../specs/2026-03-25-conditional-group-inclusion-design.md)

---

## File Map

| Action | File | Responsibility |
| ------ | ---- | ------------- |
| Modify | `src/config/types.ts` | Add `RawConditionalGroupWhen`, `RawConditionalGroupConfig`, add `conditionalGroups` to `RawConfig` |
| Modify | `src/config/index.ts` | Re-export new types |
| Modify | `src/config/normalizer.ts` | Add `evaluateWhenClause`, `mergeConditionalGroups`, wire into `normalizeConfig` |
| Modify | `src/config/validator.ts` | Add `validateConditionalGroups`, update `validateRepoFiles`, `validateRepoSettingsEntry`, `validateRawConfig`, `validateForSync` |
| Modify | `test/unit/config-normalizer.test.ts` | Add conditional group normalizer tests |
| Modify | `test/unit/config-validator.test.ts` | Add conditional group validator tests |
| Modify | `docs/configuration/groups.md` | Add "Conditional Groups" documentation section |

---

### Task 1: Add type definitions

**Files:**
- Modify: `src/config/types.ts:413-463`
- Modify: `src/config/index.ts:2-35`

- [ ] **Step 1: Add `RawConditionalGroupWhen` and `RawConditionalGroupConfig`
  interfaces to `src/config/types.ts`**

Add after the `RawGroupConfig` interface (after line 419):

```typescript
/** Condition for conditional group activation */
export interface RawConditionalGroupWhen {
  /** All listed groups must be present in the repo's effective group set */
  allOf?: string[];
  /** At least one listed group must be present */
  anyOf?: string[];
}

/** Conditional group: activates based on which groups a repo has */
export interface RawConditionalGroupConfig {
  /** Condition that determines when this group activates */
  when: RawConditionalGroupWhen;
  /** File definitions or overrides (same capabilities as regular groups) */
  files?: Record<string, RawFileConfig | RawRepoFileOverride | false> & {
    inherit?: boolean;
  };
  /** PR merge options */
  prOptions?: PRMergeOptions;
  /** Repository settings (rulesets, labels, repo settings) */
  settings?: RawRepoSettings;
}
```

- [ ] **Step 2: Add `conditionalGroups` field to `RawConfig` interface**

In `RawConfig` (line 453), add after the `groups` field:

```typescript
conditionalGroups?: RawConditionalGroupConfig[];
```

- [ ] **Step 3: Re-export new types from `src/config/index.ts`**

Add to the type re-exports block:

```typescript
RawConditionalGroupWhen,
RawConditionalGroupConfig,
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/config/types.ts src/config/index.ts
git commit -m "feat(config): add conditional group type definitions (#651)"
```

---

### Task 2: Add condition evaluation and merge function to normalizer (TDD)

**Files:**
- Test: `test/unit/config-normalizer.test.ts`
- Modify: `src/config/normalizer.ts`

- [ ] **Step 1: Write failing tests for conditional group normalization**

Add a new `describe("conditional group configuration")` block after the existing
`describe("group configuration")` block in the normalizer test file. Add these tests:

```typescript
describe("conditional group configuration", () => {
  test("conditional group with allOf matches when all groups present", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "base.json": { content: { base: true } },
      },
      groups: {
        terraform: {
          files: { "tf.json": { content: { tf: true } } },
        },
        renovate: {
          files: { "renovate.json": { content: { renovate: true } } },
        },
      },
      conditionalGroups: [
        {
          when: { allOf: ["terraform", "renovate"] },
          settings: {
            labels: {
              "renovate/terraform": { color: "ededed", description: "" },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["terraform", "renovate"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.ok(result.repos[0].settings?.labels?.["renovate/terraform"]);
  });

  test("conditional group with allOf does not match when group missing", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "base.json": { content: { base: true } },
      },
      groups: {
        terraform: {
          files: { "tf.json": { content: { tf: true } } },
        },
        renovate: {
          files: { "renovate.json": { content: { renovate: true } } },
        },
      },
      conditionalGroups: [
        {
          when: { allOf: ["terraform", "renovate"] },
          settings: {
            labels: {
              "renovate/terraform": { color: "ededed", description: "" },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["terraform"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].settings?.labels?.["renovate/terraform"], undefined);
  });

  test("conditional group with anyOf matches when one group present", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "base.json": { content: { base: true } },
      },
      groups: {
        "github-ci": { files: {} },
        "github-trivy": { files: {} },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["github-ci", "github-trivy"] },
          files: {
            "actionlint.yaml": { content: { key: "value" } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["github-ci"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("actionlint.yaml"));
  });

  test("conditional group with anyOf does not match when no groups present", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "base.json": { content: { base: true } },
      },
      groups: {
        "github-ci": { files: {} },
        "github-trivy": { files: {} },
        unrelated: { files: {} },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["github-ci", "github-trivy"] },
          files: {
            "actionlint.yaml": { content: { key: "value" } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["unrelated"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(!fileNames.includes("actionlint.yaml"));
  });

  test("combined allOf + anyOf requires both conditions", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "base.json": { content: { base: true } },
      },
      groups: {
        renovate: { files: {} },
        go: { files: {} },
        terraform: { files: {} },
      },
      conditionalGroups: [
        {
          when: { allOf: ["renovate"], anyOf: ["go", "terraform"] },
          settings: {
            labels: {
              "renovate/lang": { color: "ededed" },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/with-both.git",
          groups: ["renovate", "go"],
        },
        {
          git: "git@github.com:org/allof-only.git",
          groups: ["renovate"],
        },
        {
          git: "git@github.com:org/anyof-only.git",
          groups: ["go"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    // Has both renovate + go: matches
    assert.ok(result.repos[0].settings?.labels?.["renovate/lang"]);
    // Has renovate only: anyOf not satisfied
    assert.equal(result.repos[1].settings?.labels?.["renovate/lang"], undefined);
    // Has go only: allOf not satisfied
    assert.equal(result.repos[2].settings?.labels?.["renovate/lang"], undefined);
  });

  test("multiple conditional groups merge in array order", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "base.json": { content: { base: true } },
      },
      groups: {
        a: { files: {} },
        b: { files: {} },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          files: {
            "shared.json": { content: { source: "first" } },
          },
        },
        {
          when: { anyOf: ["a"] },
          files: {
            "shared.json": { content: { source: "second" } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["a", "b"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const shared = result.repos[0].files.find(
      (f) => f.fileName === "shared.json"
    );
    assert.deepStrictEqual(shared?.content, { source: "second" });
  });

  test("conditional groups merge after explicit groups", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { root: true } },
      },
      groups: {
        explicit: {
          files: {
            "config.json": { content: { fromGroup: true } },
          },
        },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["explicit"] },
          files: {
            "config.json": { content: { fromConditional: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["explicit"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files.find(
      (f) => f.fileName === "config.json"
    );
    // Should have all three: root + explicit group + conditional group
    assert.deepStrictEqual(config?.content, {
      root: true,
      fromGroup: true,
      fromConditional: true,
    });
  });

  test("repo overrides win over conditional group values", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { base: true } },
      },
      groups: {
        mygroup: { files: {} },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          files: {
            "config.json": { content: { conditional: true, shared: "cond" } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          files: {
            "config.json": { content: { shared: "repo" } },
          },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files.find(
      (f) => f.fileName === "config.json"
    );
    assert.deepStrictEqual(config?.content, {
      base: true,
      conditional: true,
      shared: "repo",
    });
  });

  test("no conditional groups defined preserves existing behavior", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos.length, 1);
    assert.deepStrictEqual(result.repos[0].files[0].content, { key: "value" });
  });

  test("conditional group prOptions merge correctly", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "base.json": { content: { base: true } },
      },
      prOptions: { merge: "auto" },
      groups: {
        a: { files: {} },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          prOptions: { labels: ["conditional-label"] },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["a"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.merge, "auto");
    assert.deepStrictEqual(result.repos[0].prOptions?.labels, [
      "conditional-label",
    ]);
  });

  test("conditional group with inherit:false on files discards accumulated", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "root.json": { content: { root: true } },
      },
      groups: {
        mygroup: {
          files: { "group.json": { content: { group: true } } },
        },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          files: {
            inherit: false,
            "conditional-only.json": { content: { conditional: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(!fileNames.includes("root.json"));
    assert.ok(!fileNames.includes("group.json"));
    assert.ok(fileNames.includes("conditional-only.json"));
  });

  test("conditional group file:false removes file from accumulated set", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "keep.json": { content: { keep: true } },
        "remove.json": { content: { remove: true } },
      },
      groups: {
        mygroup: { files: {} },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          files: {
            "remove.json": false,
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("keep.json"));
    assert.ok(!fileNames.includes("remove.json"));
  });

  test("conditional group override:true replaces content instead of merging", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { fromRoot: true, shared: "root" } },
      },
      groups: {
        mygroup: { files: {} },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          files: {
            "config.json": {
              override: true,
              content: { fromConditional: true },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files.find(
      (f) => f.fileName === "config.json"
    );
    // override:true replaces — root content is gone
    assert.deepStrictEqual(config?.content, { fromConditional: true });
  });

  test("repo with empty groups does not match any conditional", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "base.json": { content: { base: true } },
      },
      groups: {
        mygroup: { files: {} },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          files: {
            "extra.json": { content: { extra: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(!fileNames.includes("extra.json"));
  });

  test("conditional group rulesets merge correctly", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "base.json": { content: { base: true } },
      },
      settings: {
        rulesets: {
          "root-ruleset": {
            target: "branch" as const,
            enforcement: "active" as const,
          },
        },
      },
      groups: {
        a: { files: {} },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          settings: {
            rulesets: {
              "cond-ruleset": {
                target: "branch" as const,
                enforcement: "active" as const,
              },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["a"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.ok(result.repos[0].settings?.rulesets?.["root-ruleset"]);
    assert.ok(result.repos[0].settings?.rulesets?.["cond-ruleset"]);
  });

  test("conditional group repo settings merge correctly", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "base.json": { content: { base: true } },
      },
      settings: {
        repo: { hasIssues: true },
      },
      groups: {
        a: { files: {} },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          settings: {
            repo: { hasWiki: false },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["a"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].settings?.repo?.hasIssues, true);
    assert.equal(result.repos[0].settings?.repo?.hasWiki, false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "conditional group"`
Expected: All tests FAIL (normalizeConfig doesn't handle conditionalGroups yet)

- [ ] **Step 3: Add `evaluateWhenClause` function to `src/config/normalizer.ts`**

Add after `mergeGroupSettings` (after line 478):

```typescript
/**
 * Evaluates a conditional group's when clause against the effective group set.
 * Returns true if the condition is satisfied.
 */
function evaluateWhenClause(
  when: RawConditionalGroupWhen,
  effectiveGroups: ReadonlySet<string>
): boolean {
  const allOfSatisfied =
    !when.allOf || when.allOf.every((g) => effectiveGroups.has(g));
  const anyOfSatisfied =
    !when.anyOf || when.anyOf.some((g) => effectiveGroups.has(g));
  return allOfSatisfied && anyOfSatisfied;
}
```

Add the import for `RawConditionalGroupWhen` and `RawConditionalGroupConfig` to the
import block at the top of the file:

```typescript
import type {
  // ... existing imports ...
  RawConditionalGroupWhen,
  RawConditionalGroupConfig,
} from "./types.js";
```

- [ ] **Step 4: Add `mergeConditionalGroups` function**

Add after `evaluateWhenClause`:

```typescript
/**
 * Evaluates and merges conditional groups onto accumulated state.
 * Processes conditional groups in array order. Only groups whose when clause
 * is satisfied against the effective group set are merged.
 * Does not modify the effective group set (no chaining).
 */
function mergeConditionalGroups(
  accumulatedFiles: Record<string, RawFileConfig>,
  accumulatedPR: PRMergeOptions | undefined,
  accumulatedSettings: RawRootSettings | undefined,
  effectiveGroups: ReadonlySet<string>,
  conditionalGroups: RawConditionalGroupConfig[]
): {
  files: Record<string, RawFileConfig>;
  prOptions: PRMergeOptions | undefined;
  settings: RawRootSettings | undefined;
} {
  let files = structuredClone(accumulatedFiles);
  let prOptions = accumulatedPR;
  let settings = accumulatedSettings;

  for (const cg of conditionalGroups) {
    if (!evaluateWhenClause(cg.when, effectiveGroups)) continue;

    // Merge files using same logic as mergeGroupFiles but for a single group
    if (cg.files) {
      const inheritFiles = shouldInherit(cg.files);
      if (!inheritFiles) {
        files = {};
      }

      for (const [fileName, fileConfig] of Object.entries(cg.files)) {
        if (fileName === "inherit") continue;

        if (fileConfig === false) {
          delete files[fileName];
          continue;
        }

        if (fileConfig === undefined) continue;

        const existing = files[fileName];
        if (existing) {
          const overlay = fileConfig as RawRepoFileOverride;
          let mergedContent: ContentValue | undefined;

          if (overlay.override || !existing.content || !overlay.content) {
            mergedContent = overlay.content ?? existing.content;
          } else {
            mergedContent = mergeContentPair(
              existing.content,
              overlay.content,
              existing.mergeStrategy ?? "replace"
            );
          }

          const { override: _override, ...restFileConfig } =
            fileConfig as Record<string, unknown>;
          files[fileName] = {
            ...existing,
            ...restFileConfig,
            content: mergedContent,
          } as RawFileConfig;
        } else {
          files[fileName] = structuredClone(fileConfig) as RawFileConfig;
        }
      }
    }

    // Merge PR options
    if (cg.prOptions) {
      prOptions = mergePROptions(prOptions, cg.prOptions);
    }

    // Merge settings
    if (cg.settings) {
      settings = mergeRawSettings(settings, cg.settings);
    }
  }

  return { files, prOptions, settings };
}
```

- [ ] **Step 5: Wire `mergeConditionalGroups` into `normalizeConfig`**

In `normalizeConfig` (around line 540-550), after the existing group resolution and
before repo processing, add the conditional group phase. Replace:

```typescript
    // Resolve groups: build effective root files/prOptions/settings by merging group layers
    const effectiveRootFiles = rawRepo.groups?.length
      ? mergeGroupFiles(raw.files ?? {}, rawRepo.groups, raw.groups ?? {})
      : (raw.files ?? {});

    const effectivePROptions = rawRepo.groups?.length
      ? mergeGroupPROptions(raw.prOptions, rawRepo.groups, raw.groups ?? {})
      : raw.prOptions;

    const effectiveSettings = rawRepo.groups?.length
      ? mergeGroupSettings(raw.settings, rawRepo.groups, raw.groups ?? {})
      : raw.settings;
```

With:

```typescript
    // Phase 1: Resolve explicit groups
    let effectiveRootFiles = rawRepo.groups?.length
      ? mergeGroupFiles(raw.files ?? {}, rawRepo.groups, raw.groups ?? {})
      : (raw.files ?? {});

    let effectivePROptions = rawRepo.groups?.length
      ? mergeGroupPROptions(raw.prOptions, rawRepo.groups, raw.groups ?? {})
      : raw.prOptions;

    let effectiveSettings: RawRootSettings | undefined = rawRepo.groups?.length
      ? mergeGroupSettings(raw.settings, rawRepo.groups, raw.groups ?? {})
      : raw.settings;

    // Phase 2 + 3: Evaluate and merge conditional groups
    if (raw.conditionalGroups?.length) {
      const effectiveGroups = new Set(rawRepo.groups ?? []);
      const merged = mergeConditionalGroups(
        effectiveRootFiles,
        effectivePROptions,
        effectiveSettings,
        effectiveGroups,
        raw.conditionalGroups
      );
      effectiveRootFiles = merged.files;
      effectivePROptions = merged.prOptions;
      effectiveSettings = merged.settings;
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "conditional group"`
Expected: ALL PASS

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: ALL PASS (no regressions)

- [ ] **Step 8: Commit**

```bash
git add src/config/normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat(config): add conditional group evaluation and merging (#651)"
```

---

### Task 3: Add conditional group validation (TDD)

**Files:**
- Test: `test/unit/config-validator.test.ts`
- Modify: `src/config/validator.ts`

- [ ] **Step 1: Write failing tests for conditional group validation**

Add a new `describe("conditional group validation")` block in the validator test file,
inside the top-level `describe("validateRawConfig")`, after the existing group tests:

```typescript
describe("conditional group validation", () => {
  test("valid conditional group passes", () => {
    const config = createValidConfig({
      groups: {
        terraform: { files: {} },
        renovate: { files: {} },
      },
      conditionalGroups: [
        {
          when: { allOf: ["terraform", "renovate"] },
          settings: {
            labels: {
              "renovate/terraform": { color: "ededed", description: "" },
            },
          },
        },
      ],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("throws when conditionalGroups is not an array", () => {
    const config = createValidConfig({
      conditionalGroups: "not-array" as unknown as RawConfig["conditionalGroups"],
    });
    assert.throws(
      () => validateRawConfig(config),
      /conditionalGroups must be an array/
    );
  });

  test("throws when when clause is missing", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        { settings: { labels: { x: { color: "000000" } } } },
      ] as unknown as RawConfig["conditionalGroups"],
    });
    assert.throws(
      () => validateRawConfig(config),
      /when.*required/i
    );
  });

  test("throws when when clause has neither allOf nor anyOf", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: {},
          settings: { labels: { x: { color: "000000" } } },
        },
      ] as unknown as RawConfig["conditionalGroups"],
    });
    assert.throws(
      () => validateRawConfig(config),
      /at least one of.*allOf.*anyOf/i
    );
  });

  test("throws when allOf is empty array", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { allOf: [] },
          files: { "x.json": { content: {} } },
        },
      ],
    });
    assert.throws(
      () => validateRawConfig(config),
      /allOf.*non-empty/i
    );
  });

  test("throws when anyOf is empty array", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: [] },
          files: { "x.json": { content: {} } },
        },
      ],
    });
    assert.throws(
      () => validateRawConfig(config),
      /anyOf.*non-empty/i
    );
  });

  test("throws for non-existent group in allOf", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { allOf: ["a", "nonexistent"] },
          files: { "x.json": { content: {} } },
        },
      ],
    });
    assert.throws(
      () => validateRawConfig(config),
      /nonexistent.*not defined/i
    );
  });

  test("throws for non-existent group in anyOf", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: ["nonexistent"] },
          files: { "x.json": { content: {} } },
        },
      ],
    });
    assert.throws(
      () => validateRawConfig(config),
      /nonexistent.*not defined/i
    );
  });

  test("throws for duplicate group in allOf", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { allOf: ["a", "a"] },
          files: { "x.json": { content: {} } },
        },
      ],
    });
    assert.throws(
      () => validateRawConfig(config),
      /duplicate.*allOf/i
    );
  });

  test("throws for duplicate group in anyOf", () => {
    const config = createValidConfig({
      groups: { a: { files: {} }, b: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: ["a", "a"] },
          files: { "x.json": { content: {} } },
        },
      ],
    });
    assert.throws(
      () => validateRawConfig(config),
      /duplicate.*anyOf/i
    );
  });

  test("allows same group in both allOf and anyOf", () => {
    const config = createValidConfig({
      groups: {
        a: { files: {} },
        b: { files: {} },
      },
      conditionalGroups: [
        {
          when: { allOf: ["a"], anyOf: ["a", "b"] },
          files: { "x.json": { content: {} } },
        },
      ],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("validates conditional group file configs", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          files: {
            "config.json": { content: 123 } as unknown as RawFileConfig,
          },
        },
      ],
    });
    assert.throws(() => validateRawConfig(config), /content must be/);
  });

  test("validates conditional group settings", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          settings: {
            rulesets: "not-an-object",
          } as unknown as RawRepoSettings,
        },
      ],
    });
    assert.throws(
      () => validateRawConfig(config),
      /rulesets must be an object/
    );
  });

  test("config with only conditionalGroups content is valid", () => {
    const config: RawConfig = {
      id: "test-config",
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          settings: {
            labels: { "my-label": { color: "000000" } },
          },
        },
      ],
      repos: [{ git: "git@github.com:org/repo.git", groups: ["a"] }],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("conditional group with only prOptions is valid", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          prOptions: { labels: ["my-label"] },
        },
      ],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("repo can override file from conditional group (knownFiles expanded)", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          files: {
            "cond-only.json": { content: { key: "value" } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["a"],
          files: {
            "cond-only.json": { content: { override: true } },
          },
        },
      ],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("repo can opt out of ruleset from conditional group (rootCtx expanded)", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          settings: {
            rulesets: {
              "cond-ruleset": {
                target: "branch",
                enforcement: "active",
              },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["a"],
          settings: {
            rulesets: {
              "cond-ruleset": false,
            },
          },
        },
      ],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("repo can opt out of label from conditional group (rootCtx expanded)", () => {
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          settings: {
            labels: {
              "cond-label": { color: "000000" },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["a"],
          settings: {
            labels: {
              "cond-label": false,
            },
          },
        },
      ],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("repo can opt out of repo settings from conditional group (no root repo settings)", () => {
    // No root settings.repo — repo settings come ONLY from conditional group.
    // This exercises the rootCtx.hasRepoSettings expansion from conditional groups.
    const config = createValidConfig({
      groups: { a: { files: {} } },
      conditionalGroups: [
        {
          when: { anyOf: ["a"] },
          settings: {
            repo: { hasWiki: false },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["a"],
          settings: {
            repo: false,
          },
        },
      ],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });
});
```

Also add a test in the `validateForSync` describe block:

```typescript
test("config with only conditionalGroups content passes sync validation", () => {
  const config: RawConfig = {
    id: "test-config",
    groups: { a: { files: {} } },
    conditionalGroups: [
      {
        when: { anyOf: ["a"] },
        settings: {
          labels: { "my-label": { color: "000000" } },
        },
      },
    ],
    repos: [{ git: "git@github.com:org/repo.git", groups: ["a"] }],
  };
  assert.doesNotThrow(() => validateForSync(config));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "conditional group"`
Expected: Most tests FAIL

- [ ] **Step 3: Add `validateConditionalGroups` function to `src/config/validator.ts`**

Add after `validateGroups` function (after line 429):

```typescript
function validateConditionalGroups(config: RawConfig): void {
  if (config.conditionalGroups === undefined) return;

  if (!Array.isArray(config.conditionalGroups)) {
    throw new ValidationError("conditionalGroups must be an array");
  }

  const rootCtx = buildRootSettingsContext(config);
  const groupNames = config.groups ? Object.keys(config.groups) : [];

  for (let i = 0; i < config.conditionalGroups.length; i++) {
    const cg = config.conditionalGroups[i];
    const context = `conditionalGroups[${i}]`;

    // Validate when clause
    if (!cg.when || !isPlainObject(cg.when)) {
      throw new ValidationError(
        `${context}: 'when' is required and must be an object`
      );
    }

    const { allOf, anyOf } = cg.when;

    if (!allOf && !anyOf) {
      throw new ValidationError(
        `${context}: 'when' must have at least one of 'allOf' or 'anyOf'`
      );
    }

    if (allOf !== undefined) {
      if (!Array.isArray(allOf) || allOf.length === 0) {
        throw new ValidationError(
          `${context}: 'allOf' must be a non-empty array of strings`
        );
      }
      const seen = new Set<string>();
      for (const name of allOf) {
        if (typeof name !== "string") {
          throw new ValidationError(
            `${context}: 'allOf' entries must be strings`
          );
        }
        if (!groupNames.includes(name)) {
          throw new ValidationError(
            `${context}: group '${name}' in allOf is not defined in root 'groups'`
          );
        }
        if (seen.has(name)) {
          throw new ValidationError(
            `${context}: duplicate group '${name}' in allOf`
          );
        }
        seen.add(name);
      }
    }

    if (anyOf !== undefined) {
      if (!Array.isArray(anyOf) || anyOf.length === 0) {
        throw new ValidationError(
          `${context}: 'anyOf' must be a non-empty array of strings`
        );
      }
      const seen = new Set<string>();
      for (const name of anyOf) {
        if (typeof name !== "string") {
          throw new ValidationError(
            `${context}: 'anyOf' entries must be strings`
          );
        }
        if (!groupNames.includes(name)) {
          throw new ValidationError(
            `${context}: group '${name}' in anyOf is not defined in root 'groups'`
          );
        }
        if (seen.has(name)) {
          throw new ValidationError(
            `${context}: duplicate group '${name}' in anyOf`
          );
        }
        seen.add(name);
      }
    }

    // Validate files
    if (cg.files) {
      for (const [fileName, fileConfig] of Object.entries(cg.files)) {
        if (fileName === "inherit") continue;
        if (fileConfig === false) continue;
        if (fileConfig === undefined) continue;

        validateFileConfigFields(
          fileConfig as Record<string, unknown>,
          fileName,
          `${context}:`
        );
      }
    }

    // Validate settings
    if (cg.settings !== undefined) {
      validateSettings(cg.settings, context, rootCtx);
    }
  }
}
```

- [ ] **Step 4: Wire `validateConditionalGroups` into `validateRawConfig`**

In `validateRawConfig`, add the call after `validateGroups(config)` (line 683):

```typescript
validateConditionalGroups(config);
```

- [ ] **Step 5: Update `validateRawConfig` "has content" guard**

Update the guard at lines 648-663 to include conditional groups. Add these variables:

```typescript
const hasCondGrpFiles =
  Array.isArray(config.conditionalGroups) &&
  config.conditionalGroups.some(
    (cg) =>
      cg.files &&
      Object.keys(cg.files).filter(
        (k) => k !== "inherit" && cg.files![k] !== false
      ).length > 0
  );
const hasCondGrpSettings =
  Array.isArray(config.conditionalGroups) &&
  config.conditionalGroups.some(
    (cg) => cg.settings && isPlainObject(cg.settings)
  );
const hasCondGrpPR =
  Array.isArray(config.conditionalGroups) &&
  config.conditionalGroups.some((cg) => cg.prOptions && isPlainObject(cg.prOptions));
```

And add them to the guard condition:

```typescript
if (
  !hasFiles &&
  !hasSettings &&
  !hasGrpFiles &&
  !hasGrpSettings &&
  !hasCondGrpFiles &&
  !hasCondGrpSettings &&
  !hasCondGrpPR
) {
```

- [ ] **Step 6: Update `validateForSync` "has content" guard**

Similarly update `validateForSync` to include conditional groups. Add:

```typescript
const hasCondGrpFiles =
  Array.isArray(config.conditionalGroups) &&
  config.conditionalGroups.some(
    (cg) =>
      cg.files &&
      Object.keys(cg.files).filter(
        (k) => k !== "inherit" && cg.files![k] !== false
      ).length > 0
  );
const hasCondGrpSettings =
  Array.isArray(config.conditionalGroups) &&
  config.conditionalGroups.some(
    (cg) => cg.settings && hasActionableSettings(cg.settings)
  );
const hasCondGrpPR =
  Array.isArray(config.conditionalGroups) &&
  config.conditionalGroups.some((cg) => cg.prOptions && isPlainObject(cg.prOptions));
```

And add to the guard:

```typescript
if (
  !hasRootFiles &&
  !hasGrpFiles &&
  !hasSettings &&
  !hasRepoSettings &&
  !hasGroupSettings &&
  !hasCondGrpFiles &&
  !hasCondGrpSettings &&
  !hasCondGrpPR
) {
```

- [ ] **Step 7: Update `validateRepoFiles` to include conditional group files
  in `knownFiles`**

In `validateRepoFiles` (line 536-548), after the group files loop, add:

```typescript
if (config.conditionalGroups) {
  for (const cg of config.conditionalGroups) {
    if (cg.files) {
      for (const fn of Object.keys(cg.files)) {
        if (fn !== "inherit") knownFiles.add(fn);
      }
    }
  }
}
```

- [ ] **Step 8: Update `validateRepoSettingsEntry` to include conditional group
  settings in `rootCtx`**

In `validateRepoSettingsEntry` (line 597-611), after the group settings loop, add:

```typescript
if (config.conditionalGroups) {
  for (const cg of config.conditionalGroups) {
    if (cg.settings?.rulesets) {
      for (const name of Object.keys(cg.settings.rulesets)) {
        if (name !== "inherit") rootCtx.rulesetNames.push(name);
      }
    }
    if (cg.settings?.labels) {
      for (const name of Object.keys(cg.settings.labels)) {
        if (name !== "inherit") rootCtx.labelNames.push(name);
      }
    }
    if (
      cg.settings?.repo !== undefined &&
      cg.settings.repo !== false
    ) {
      rootCtx.hasRepoSettings = true;
    }
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "conditional group"`
Expected: ALL PASS

- [ ] **Step 10: Run full test suite**

Run: `npm test`
Expected: ALL PASS (no regressions)

- [ ] **Step 11: Commit**

```bash
git add src/config/validator.ts test/unit/config-validator.test.ts
git commit -m "feat(config): add conditional group validation (#651)"
```

---

### Task 4: Type-check tests and lint

**Files:**
- All modified files

- [ ] **Step 1: Run test type checking**

Run: `npm run test:typecheck`
Expected: PASS — all test imports resolve correctly

- [ ] **Step 2: Run linter**

Run: `./lint.sh`
Expected: PASS

- [ ] **Step 3: Fix any issues found and commit**

If any issues, fix and commit:

```bash
git commit -m "fix: resolve lint/typecheck issues for conditional groups (#651)"
```

---

### Task 5: Update documentation

**Files:**
- Modify: `docs/configuration/groups.md`

- [ ] **Step 1: Add "Conditional Groups" section to `docs/configuration/groups.md`**

Append to the end of the file:

````markdown
## Conditional Groups

Conditional groups activate automatically based on which groups a repo has.
They are defined in a top-level `conditionalGroups` array, separate from
regular groups.

### `allOf` — Intersection

Include config only when **all** listed groups are present:

```yaml
conditionalGroups:
  - when:
      allOf: [terraform, renovate]
    settings:
      labels:
        "renovate/terraform":
          color: "#ededed"
          description: ""
```

The `renovate/terraform` label is only added to repos that have both
`terraform` and `renovate` in their `groups` array.

### `anyOf` — Union

Include config when **any** listed group is present:

```yaml
conditionalGroups:
  - when:
      anyOf: [github-ci, github-trivy]
    files:
      .github/actionlint.yaml:
        content: "@templates/.github/actionlint.yaml"
```

### Combined Conditions

Both `allOf` and `anyOf` can be used together — both must be satisfied:

```yaml
conditionalGroups:
  - when:
      allOf: [renovate]
      anyOf: [go, terraform, typescript]
    settings:
      labels:
        "renovate/language":
          color: "#ededed"
```

This matches repos that have `renovate` **and** at least one of `go`,
`terraform`, or `typescript`.

### Merge Order

Conditional groups merge **after** explicit groups and **before** repo overrides:

1. **Root files/settings** — base layer
2. **Explicit group layers** — applied left-to-right
3. **Conditional group layers** — applied in array order
4. **Repo overrides** — final layer

Later conditional groups override earlier ones when they conflict.

### Full Parity with Regular Groups

Conditional groups support the same capabilities as regular groups:

- `files` with `inherit: false`, `override: true`, `file: false`
- `prOptions` for PR merge settings
- `settings` for rulesets, labels, and repo settings
- `inherit: false` on settings sub-sections

### Restrictions

- Group names in `allOf`/`anyOf` must reference groups defined in
  the `groups` map
- Conditional groups cannot be listed in a repo's `groups` array
- Conditional groups cannot reference other conditional groups
````

- [ ] **Step 2: Run linter on docs**

Run: `./lint.sh`
Expected: PASS (markdownlint passes)

- [ ] **Step 3: Commit**

```bash
git add docs/configuration/groups.md
git commit -m "docs: add conditional groups documentation (#651)"
```

---

### Task 6: Integration testing

**Files:**
- Modify: `test/integration/github.test.ts`

- [ ] **Step 1: Add a new test case to `test/integration/github.test.ts`**

Add a new test within the existing `describe("GitHub Integration Test")` block.
This test defines two groups (`group-a` and `group-b`) and a conditional group
that activates when both are present. The repo has both groups so the conditional
content should appear in the merged output.

Follow the existing test pattern in `github.test.ts`. Add this test inside the
existing `describe("GitHub Integration Test")` block, after the last test:

```typescript
test("conditional group applies only when condition is met", async () => {
  const configPath = writeConfig(
    tmpDir,
    `id: integration-test-github
files:
  ${TARGET_FILE}:
    content:
      base: true
groups:
  group-a:
    files:
      ${TARGET_FILE}:
        content:
          groupA: true
  group-b:
    files:
      ${TARGET_FILE}:
        content:
          groupB: true
conditionalGroups:
  - when:
      allOf: [group-a, group-b]
    files:
      ${TARGET_FILE}:
        content:
          fromConditional: true
repos:
  - git: https://github.com/${testRepo}.git
    groups: [group-a, group-b]
    files:
      ${TARGET_FILE}:
        content:
          repoOverride: true
`
  );

  await exec(\`node dist/cli.js sync --config \${configPath}\`, {
    cwd: projectRoot,
  });

  const pr = await waitForPrVisible(testRepo, BRANCH_NAME);
  assert.ok(pr.number);

  const raw = await waitForFileVisible(TARGET_FILE);
  const json = JSON.parse(raw);
  assert.equal(json.base, true, "root content");
  assert.equal(json.groupA, true, "explicit group-a content");
  assert.equal(json.groupB, true, "explicit group-b content");
  assert.equal(json.fromConditional, true, "conditional group content");
  assert.equal(json.repoOverride, true, "repo override content");
});
```

Note: uses `TARGET_FILE`, `testRepo`, `BRANCH_NAME`, `waitForFileVisible`, and
`waitForPrVisible` which are already defined in the test file's outer scope.

- [ ] **Step 2: Run GitHub integration tests**

Run: `npm run test:integration:github`
Expected: PASS -- conditional group file content appears in merged output

- [ ] **Step 3: Commit**

```bash
git add test/integration/github.test.ts
git commit -m "test: add conditional group integration test (#651)"
```
