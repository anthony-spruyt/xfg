# Group Extends / Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `extends` field to group config so child groups automatically inherit files, settings, and PR options from parent groups.

**Architecture:** A new `resolveExtendsChain` function in `normalizer.ts` expands each group name into its full parent chain (depth-first, parents before child, deduplicated). This runs as Phase 0 before the existing merge pipeline. The validator gets cycle detection and `extends` field validation. The effective group set for conditional groups includes transitive parents.

**Tech Stack:** TypeScript, Node.js test runner, YAML config

**Spec:** `plans/superpowers/specs/2026-03-27-group-extends-design.md`

---

## Tasks

### Task 1: Add `extends` to `RawGroupConfig` type

**Files:**
- Modify: `src/config/types.ts:413-419`
- Modify: `src/config/index.ts:1-50` (barrel export — no change needed since `RawGroupConfig` is not exported, but verify)

- [ ] **Step 1: Add `extends` field to `RawGroupConfig`**

In `src/config/types.ts`, add the `extends` field to `RawGroupConfig`:

```typescript
export interface RawGroupConfig {
  extends?: string | string[];  // Parent group name(s) to inherit from
  files?: Record<string, RawFileConfig | RawRepoFileOverride | false> & {
    inherit?: boolean;
  };
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: No errors (the field is optional, so no consumers break)

- [ ] **Step 3: Commit**

```bash
git add src/config/types.ts
git commit -m "feat(config): add extends field to RawGroupConfig type (#649)"
```

---

### Task 2: Add extends resolution functions to normalizer

**Files:**
- Modify: `src/config/normalizer.ts` (add two new functions before `mergeGroupFiles` at line 363)
- Test: `test/unit/config-normalizer.test.ts`

- [ ] **Step 1: Write failing tests for extends resolution**

Add a new `describe("group extends", ...)` block in `test/unit/config-normalizer.test.ts` after the existing `describe("group configuration", ...)` block (after line ~4147). These tests call `normalizeConfig` and verify the expanded merge behavior.

```typescript
describe("group extends", () => {
  test("single parent: child inherits parent files", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        parent: {
          files: { "parent.json": { content: { from: "parent" } } },
        },
        child: {
          extends: "parent",
          files: { "child.json": { content: { from: "child" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("parent.json"), "should include parent file");
    assert.ok(fileNames.includes("child.json"), "should include child file");
  });

  test("single parent: child overrides parent file content", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        parent: {
          files: { "shared.json": { content: { source: "parent", kept: true } } },
        },
        child: {
          extends: "parent",
          files: { "shared.json": { content: { source: "child" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const shared = result.repos[0].files.find((f) => f.fileName === "shared.json");
    assert.deepStrictEqual(shared?.content, { source: "child", kept: true });
  });

  test("multi-parent: extends array merges parents left-to-right", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        parentA: {
          files: { "a.json": { content: { from: "A" } } },
        },
        parentB: {
          files: { "b.json": { content: { from: "B" } } },
        },
        child: {
          extends: ["parentA", "parentB"],
          files: { "child.json": { content: { from: "child" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("a.json"));
    assert.ok(fileNames.includes("b.json"));
    assert.ok(fileNames.includes("child.json"));
  });

  test("transitive: grandparent -> parent -> child", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        grandparent: {
          files: { "gp.json": { content: { from: "grandparent" } } },
        },
        parent: {
          extends: "grandparent",
          files: { "p.json": { content: { from: "parent" } } },
        },
        child: {
          extends: "parent",
          files: { "c.json": { content: { from: "child" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("gp.json"));
    assert.ok(fileNames.includes("p.json"));
    assert.ok(fileNames.includes("c.json"));
  });

  test("diamond: shared ancestor appears once, before both children", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        base: {
          files: { "base.json": { content: { from: "base" } } },
        },
        left: {
          extends: "base",
          files: { "left.json": { content: { from: "left" } } },
        },
        right: {
          extends: "base",
          files: { "right.json": { content: { from: "right" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["left", "right"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("base.json"), "base appears");
    assert.ok(fileNames.includes("left.json"), "left appears");
    assert.ok(fileNames.includes("right.json"), "right appears");
    // base.json should only appear once
    assert.equal(
      result.repos[0].files.filter((f) => f.fileName === "base.json").length,
      1,
      "base appears exactly once"
    );
  });

  test("no extends: group without extends unchanged", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "root.json": { content: { from: "root" } } },
      groups: {
        standalone: {
          files: { "standalone.json": { content: { from: "standalone" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["standalone"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("root.json"));
    assert.ok(fileNames.includes("standalone.json"));
    assert.equal(result.repos[0].files.length, 2);
  });

  test("mixed: repo with extending and non-extending groups", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        base: {
          files: { "base.json": { content: { from: "base" } } },
        },
        derived: {
          extends: "base",
          files: { "derived.json": { content: { from: "derived" } } },
        },
        standalone: {
          files: { "standalone.json": { content: { from: "standalone" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["derived", "standalone"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.deepStrictEqual(fileNames.sort(), ["base.json", "derived.json", "standalone.json"]);
  });

  test("child inherit:false discards parent files", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "root.json": { content: { from: "root" } } },
      groups: {
        parent: {
          files: { "parent.json": { content: { from: "parent" } } },
        },
        child: {
          extends: "parent",
          files: {
            inherit: false,
            "child.json": { content: { from: "child" } },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(!fileNames.includes("root.json"), "root discarded");
    assert.ok(!fileNames.includes("parent.json"), "parent discarded");
    assert.ok(fileNames.includes("child.json"), "child kept");
  });

  test("child file:false removes specific parent file", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        parent: {
          files: {
            "keep.json": { content: { keep: true } },
            "remove.json": { content: { remove: true } },
          },
        },
        child: {
          extends: "parent",
          files: {
            "remove.json": false,
            "child.json": { content: { from: "child" } },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("keep.json"), "keep.json stays");
    assert.ok(!fileNames.includes("remove.json"), "remove.json removed");
    assert.ok(fileNames.includes("child.json"), "child.json added");
  });

  test("parent prOptions merge into child", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      groups: {
        parent: {
          prOptions: { merge: "auto", labels: ["parent-label"] },
        },
        child: {
          extends: "parent",
          prOptions: { labels: ["child-label"] },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.merge, "auto");
    assert.deepStrictEqual(result.repos[0].prOptions?.labels, ["child-label"]);
  });

  test("parent settings merge into child", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      groups: {
        parent: {
          settings: {
            labels: {
              "parent-label": { color: "ff0000", description: "from parent" },
            },
          },
        },
        child: {
          extends: "parent",
          settings: {
            labels: {
              "child-label": { color: "00ff00", description: "from child" },
            },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const labels = result.repos[0].settings?.labels;
    assert.ok(labels?.["parent-label"], "parent label present");
    assert.ok(labels?.["child-label"], "child label present");
  });

  test("effective group set includes transitive parents for conditional groups", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        github: {
          files: { "github.json": { content: { from: "github" } } },
        },
        "github-ci": {
          extends: "github",
          files: { "ci.json": { content: { from: "ci" } } },
        },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["github"] },
          files: { "conditional.json": { content: { from: "conditional" } } },
        },
      ],
      repos: [{ git: "git@github.com:org/repo.git", groups: ["github-ci"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("github.json"), "parent file");
    assert.ok(fileNames.includes("ci.json"), "child file");
    assert.ok(
      fileNames.includes("conditional.json"),
      "conditional group matched via transitive parent"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="group extends" 2>&1 | tail -20`
Expected: All tests fail (normalizer doesn't expand extends yet)

- [ ] **Step 3: Implement `resolveExtendsChain` and `expandRepoGroups` in normalizer**

In `src/config/normalizer.ts`, add these two functions before the `mergeGroupFiles` function (before line 363):

```typescript
/**
 * Resolves a single group's extends chain into an ordered list of group names.
 * Parents appear before children (topological order). Detects circular extends.
 */
function resolveExtendsChain(
  groupName: string,
  groupDefs: Record<string, RawGroupConfig>,
  visited: Set<string>
): string[] {
  if (visited.has(groupName)) {
    const cycle = [...visited, groupName].join(" -> ");
    throw new Error(`Circular extends detected: ${cycle}`);
  }
  visited.add(groupName);

  const group = groupDefs[groupName];
  if (!group?.extends) {
    return [groupName];
  }

  const parents = Array.isArray(group.extends)
    ? group.extends
    : [group.extends];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const parent of parents) {
    const chain = resolveExtendsChain(parent, groupDefs, new Set(visited));
    for (const name of chain) {
      if (!seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
  }

  if (!seen.has(groupName)) {
    result.push(groupName);
  }

  return result;
}

/**
 * Expands a repo's group list by resolving extends chains for each group.
 * Returns the full ordered list with transitive parents, deduplicated.
 */
function expandRepoGroups(
  repoGroups: string[],
  groupDefs: Record<string, RawGroupConfig>
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const groupName of repoGroups) {
    const chain = resolveExtendsChain(groupName, groupDefs, new Set());
    for (const name of chain) {
      if (!seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Integrate extends expansion into `normalizeConfig`**

In `src/config/normalizer.ts`, modify the `normalizeConfig` function. Replace the section at lines 614-629 that reads:

```typescript
    // Phase 1: Resolve groups - build effective root files/prOptions/settings by merging group layers
    let effectiveRootFiles = rawRepo.groups?.length
      ? mergeGroupFiles(raw.files ?? {}, rawRepo.groups, raw.groups ?? {})
      : (raw.files ?? {});

    let effectivePROptions = rawRepo.groups?.length
      ? mergeGroupPROptions(raw.prOptions, rawRepo.groups, raw.groups ?? {})
      : raw.prOptions;

    let effectiveSettings = rawRepo.groups?.length
      ? mergeGroupSettings(raw.settings, rawRepo.groups, raw.groups ?? {})
      : raw.settings;

    // Phase 2 + 3: Evaluate and merge conditional groups
    if (raw.conditionalGroups?.length) {
      const effectiveGroups = new Set(rawRepo.groups ?? []);
```

With:

```typescript
    // Phase 0: Expand extends chains
    const expandedGroups = rawRepo.groups?.length
      ? expandRepoGroups(rawRepo.groups, raw.groups ?? {})
      : [];

    // Phase 1: Resolve groups - build effective root files/prOptions/settings by merging group layers
    let effectiveRootFiles = expandedGroups.length
      ? mergeGroupFiles(raw.files ?? {}, expandedGroups, raw.groups ?? {})
      : (raw.files ?? {});

    let effectivePROptions = expandedGroups.length
      ? mergeGroupPROptions(raw.prOptions, expandedGroups, raw.groups ?? {})
      : raw.prOptions;

    let effectiveSettings = expandedGroups.length
      ? mergeGroupSettings(raw.settings, expandedGroups, raw.groups ?? {})
      : raw.settings;

    // Phase 2 + 3: Evaluate and merge conditional groups
    if (raw.conditionalGroups?.length) {
      const effectiveGroups = new Set(expandedGroups);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="group extends" 2>&1 | tail -30`
Expected: All 12 tests pass

- [ ] **Step 6: Run full normalizer test suite to verify no regressions**

Run: `npm test -- --test-name-pattern="normalizeConfig|group configuration|conditional group" 2>&1 | tail -10`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add src/config/normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat(config): implement group extends resolution in normalizer (#649)"
```

---

### Task 3: Add extends validation to validator

**Files:**
- Modify: `src/config/validator.ts:395-429` (in `validateGroups`)
- Test: `test/unit/config-validator.test.ts`

- [ ] **Step 1: Write failing tests for extends validation**

Add a new `describe("group extends validation", ...)` block in `test/unit/config-validator.test.ts` after the existing `describe("group validation", ...)` block:

```typescript
describe("group extends validation", () => {
  const createValidConfig = (overrides?: Partial<RawConfig>): RawConfig => ({
    id: "test-config",
    files: { "config.json": { content: { key: "value" } } },
    repos: [{ git: "git@github.com:org/repo.git" }],
    ...overrides,
  });

  test("valid extends with string passes", () => {
    const config = createValidConfig({
      groups: {
        parent: { files: {} },
        child: { extends: "parent", files: {} },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("valid extends with array passes", () => {
    const config = createValidConfig({
      groups: {
        parentA: { files: {} },
        parentB: { files: {} },
        child: { extends: ["parentA", "parentB"], files: {} },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("throws for extends referencing non-existent group", () => {
    const config = createValidConfig({
      groups: {
        child: { extends: "nonexistent", files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: extends references undefined group 'nonexistent'/
    );
  });

  test("throws for extends array with non-existent group", () => {
    const config = createValidConfig({
      groups: {
        parent: { files: {} },
        child: { extends: ["parent", "missing"], files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: extends references undefined group 'missing'/
    );
  });

  test("throws for extends self-reference", () => {
    const config = createValidConfig({
      groups: {
        selfref: { extends: "selfref", files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.selfref: extends cannot reference itself/
    );
  });

  test("throws for circular extends (a -> b -> a)", () => {
    const config = createValidConfig({
      groups: {
        a: { extends: "b", files: {} },
        b: { extends: "a", files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /circular extends/
    );
  });

  test("throws for circular extends (a -> b -> c -> a)", () => {
    const config = createValidConfig({
      groups: {
        a: { extends: "b", files: {} },
        b: { extends: "c", files: {} },
        c: { extends: "a", files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /circular extends/
    );
  });

  test("throws for extends as empty array", () => {
    const config = createValidConfig({
      groups: {
        child: { extends: [] as string[], files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: 'extends' must be a non-empty string or array of strings/
    );
  });

  test("throws for extends with non-string value", () => {
    const config = createValidConfig({
      groups: {
        child: { extends: 123 as unknown as string, files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: 'extends' must be a non-empty string or array of strings/
    );
  });

  test("throws for extends array with non-string entry", () => {
    const config = createValidConfig({
      groups: {
        parent: { files: {} },
        child: { extends: ["parent", 42 as unknown as string], files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: 'extends' array entries must be strings/
    );
  });

  test("throws for extends as reserved group name", () => {
    const config = createValidConfig({
      groups: {
        extends: { files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /'extends' is a reserved key and cannot be used as a group name/
    );
  });

  test("transitive extends with valid chain passes", () => {
    const config = createValidConfig({
      groups: {
        grandparent: { files: {} },
        parent: { extends: "grandparent", files: {} },
        child: { extends: "parent", files: {} },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("diamond extends passes (no cycle)", () => {
    const config = createValidConfig({
      groups: {
        base: { files: {} },
        left: { extends: "base", files: {} },
        right: { extends: "base", files: {} },
        top: { extends: ["left", "right"], files: {} },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="group extends validation" 2>&1 | tail -20`
Expected: Tests for invalid configs fail (validation doesn't check extends yet); tests for valid configs pass (no validation = no error)

- [ ] **Step 3: Add extends validation to `validateGroups`**

In `src/config/validator.ts`, replace the entire `validateGroups` function (lines 395-429) with the following (adds `extends` reserved name check, extends field validation, `groupNames` extraction, and circular extends detection call):

```typescript
function validateGroups(config: RawConfig): void {
  if (config.groups === undefined) return;

  if (!isPlainObject(config.groups)) {
    throw new ValidationError("groups must be an object");
  }

  const rootCtx = buildRootSettingsContext(config);
  const groupNames = Object.keys(config.groups);

  for (const [groupName, group] of Object.entries(config.groups)) {
    if (groupName === "inherit") {
      throw new ValidationError(
        "'inherit' is a reserved key and cannot be used as a group name"
      );
    }

    if (groupName === "extends") {
      throw new ValidationError(
        "'extends' is a reserved key and cannot be used as a group name"
      );
    }

    // Validate extends field
    if (group.extends !== undefined) {
      validateGroupExtends(groupName, group.extends, groupNames);
    }

    if (group.files) {
      for (const [fileName, fileConfig] of Object.entries(group.files)) {
        if (fileName === "inherit") continue;
        if (fileConfig === false) continue;
        if (fileConfig === undefined) continue;

        validateFileConfigFields(
          fileConfig as Record<string, unknown>,
          fileName,
          `groups.${groupName}:`
        );
      }
    }

    if (group.settings !== undefined) {
      validateSettings(group.settings, `groups.${groupName}`, rootCtx);
    }
  }

  // Validate no circular extends after individual validation
  validateNoCircularExtends(config.groups);
}
```

- [ ] **Step 4: Implement `validateGroupExtends` helper**

Add this function above `validateGroups` in `src/config/validator.ts`:

```typescript
/**
 * Validates the extends field on a single group definition.
 * Checks type, self-reference, and that all referenced groups exist.
 */
function validateGroupExtends(
  groupName: string,
  extends_: string | string[],
  groupNames: string[]
): void {
  // Type check
  if (typeof extends_ === "string") {
    if (extends_.length === 0) {
      throw new ValidationError(
        `groups.${groupName}: 'extends' must be a non-empty string or array of strings`
      );
    }
    // Self-reference
    if (extends_ === groupName) {
      throw new ValidationError(
        `groups.${groupName}: extends cannot reference itself`
      );
    }
    // Existence
    if (!groupNames.includes(extends_)) {
      throw new ValidationError(
        `groups.${groupName}: extends references undefined group '${extends_}'`
      );
    }
  } else if (Array.isArray(extends_)) {
    if (extends_.length === 0) {
      throw new ValidationError(
        `groups.${groupName}: 'extends' must be a non-empty string or array of strings`
      );
    }
    for (const entry of extends_) {
      if (typeof entry !== "string") {
        throw new ValidationError(
          `groups.${groupName}: 'extends' array entries must be strings`
        );
      }
      if (entry === groupName) {
        throw new ValidationError(
          `groups.${groupName}: extends cannot reference itself`
        );
      }
      if (!groupNames.includes(entry)) {
        throw new ValidationError(
          `groups.${groupName}: extends references undefined group '${entry}'`
        );
      }
    }
  } else {
    throw new ValidationError(
      `groups.${groupName}: 'extends' must be a non-empty string or array of strings`
    );
  }
}
```

- [ ] **Step 5: Implement `validateNoCircularExtends` helper**

Add this function after `validateGroupExtends` in `src/config/validator.ts`:

```typescript
/**
 * Detects circular extends chains across all groups.
 * Uses depth-first traversal with cycle detection.
 */
function validateNoCircularExtends(
  groups: Record<string, RawGroupConfig>
): void {
  const validated = new Set<string>();

  function walk(name: string, path: string[]): void {
    if (path.includes(name)) {
      const cycleStart = path.indexOf(name);
      const cycle = [...path.slice(cycleStart), name].join(" -> ");
      throw new ValidationError(`circular extends detected: ${cycle}`);
    }
    if (validated.has(name)) return;

    const group = groups[name];
    if (!group?.extends) {
      validated.add(name);
      return;
    }

    const parents = Array.isArray(group.extends)
      ? group.extends
      : [group.extends];

    for (const parent of parents) {
      walk(parent, [...path, name]);
    }

    validated.add(name);
  }

  for (const name of Object.keys(groups)) {
    walk(name, []);
  }
}
```

- [ ] **Step 6: Add `RawGroupConfig` to the validator's type import**

In `src/config/validator.ts` line 1, add `RawGroupConfig` to the import:

```typescript
import type { RawConfig, RawRepoSettings, RawRootSettings, RawGroupConfig } from "./types.js";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="group extends validation" 2>&1 | tail -30`
Expected: All 13 tests pass

- [ ] **Step 8: Run full validator test suite to verify no regressions**

Run: `npm test -- --test-name-pattern="validateRawConfig|group validation" 2>&1 | tail -10`
Expected: All existing tests still pass

- [ ] **Step 9: Commit**

```bash
git add src/config/validator.ts test/unit/config-validator.test.ts
git commit -m "feat(config): add extends validation with cycle detection (#649)"
```

---

### Task 4: Expand `knownFiles` and `rootCtx` for transitive parents in validator

**Files:**
- Modify: `src/config/validator.ts:636-657` (in `validateRepoFiles`) and `src/config/validator.ts:706-726` (in `validateRepoSettingsEntry`)
- Test: `test/unit/config-validator.test.ts`

- [ ] **Step 1: Write failing tests for transitive parent file/settings visibility**

Add these tests to the `describe("group extends validation", ...)` block:

```typescript
test("repo can override file from transitive parent group", () => {
  const config: RawConfig = {
    id: "test-config",
    files: {},
    groups: {
      parent: {
        files: { "parent-file.json": { content: { from: "parent" } } },
      },
      child: {
        extends: "parent",
        files: { "child-file.json": { content: { from: "child" } } },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["child"],
        files: {
          "parent-file.json": { content: { override: true } },
        },
      },
    ],
  };
  assert.doesNotThrow(() => validateRawConfig(config));
});

test("repo can opt out of settings from transitive parent group", () => {
  const config: RawConfig = {
    id: "test-config",
    files: { "f.json": { content: {} } },
    groups: {
      parent: {
        settings: {
          labels: {
            "parent-label": { color: "ff0000", description: "" },
          },
        },
      },
      child: {
        extends: "parent",
        files: {},
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        groups: ["child"],
        settings: {
          labels: {
            "parent-label": false,
          },
        },
      },
    ],
  };
  assert.doesNotThrow(() => validateRawConfig(config));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="repo can override file from transitive|repo can opt out of settings from transitive" 2>&1 | tail -10`
Expected: Fails with "references undefined file 'parent-file.json'" or similar

- [ ] **Step 3: Add extends expansion helper for validator**

Add a helper function in `src/config/validator.ts` that the validator can use to expand a repo's groups. Place it near the other validation helpers (before `validateRepoFiles`):

```typescript
/**
 * Expands a repo's group list by following extends chains.
 * Returns the full list including transitive parents.
 * Used by validation to build complete knownFiles and rootCtx sets.
 *
 * Note: Parallels expandRepoGroups in normalizer.ts. Kept separate to avoid
 * coupling validator to normalizer — validator runs before normalization.
 */
function expandGroupsForValidation(
  repoGroups: string[],
  groups: Record<string, RawGroupConfig>
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  function expand(name: string, visited: Set<string>): void {
    if (seen.has(name)) return;
    if (visited.has(name)) return; // Circular — already caught by validateNoCircularExtends

    const group = groups[name];
    if (group?.extends) {
      const parents = Array.isArray(group.extends)
        ? group.extends
        : [group.extends];
      const nextVisited = new Set(visited);
      nextVisited.add(name);
      for (const parent of parents) {
        expand(parent, nextVisited);
      }
    }

    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  for (const name of repoGroups) {
    expand(name, new Set());
  }

  return result;
}
```

- [ ] **Step 4: Update `validateRepoFiles` to expand groups**

In `src/config/validator.ts`, modify the `validateRepoFiles` function. Replace the existing group-file collection block (lines 639-648):

```typescript
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
```

With:

```typescript
  if (repo.groups && config.groups) {
    const expandedGroups = expandGroupsForValidation(repo.groups, config.groups);
    for (const groupName of expandedGroups) {
      const group = config.groups[groupName];
      if (group?.files) {
        for (const fn of Object.keys(group.files)) {
          if (fn !== "inherit") knownFiles.add(fn);
        }
      }
    }
  }
```

- [ ] **Step 5: Update `validateRepoSettingsEntry` to expand groups**

In `src/config/validator.ts`, modify `validateRepoSettingsEntry`. Replace the existing group-settings collection block (lines 706-726):

```typescript
  if (repo.groups && config.groups) {
    for (const groupName of repo.groups) {
      const group = config.groups[groupName];
      if (group?.settings?.rulesets) {
        for (const name of Object.keys(group.settings.rulesets)) {
          if (name !== "inherit") rootCtx.rulesetNames.push(name);
        }
      }
      if (group?.settings?.labels) {
        for (const name of Object.keys(group.settings.labels)) {
          if (name !== "inherit") rootCtx.labelNames.push(name);
        }
      }
      if (
        group?.settings?.repo !== undefined &&
        group.settings.repo !== false
      ) {
        rootCtx.hasRepoSettings = true;
      }
    }
  }
```

With:

```typescript
  if (repo.groups && config.groups) {
    const expandedGroups = expandGroupsForValidation(repo.groups, config.groups);
    for (const groupName of expandedGroups) {
      const group = config.groups[groupName];
      if (group?.settings?.rulesets) {
        for (const name of Object.keys(group.settings.rulesets)) {
          if (name !== "inherit") rootCtx.rulesetNames.push(name);
        }
      }
      if (group?.settings?.labels) {
        for (const name of Object.keys(group.settings.labels)) {
          if (name !== "inherit") rootCtx.labelNames.push(name);
        }
      }
      if (
        group?.settings?.repo !== undefined &&
        group.settings.repo !== false
      ) {
        rootCtx.hasRepoSettings = true;
      }
    }
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="group extends" 2>&1 | tail -20`
Expected: All extends tests pass (both normalizer and validator)

- [ ] **Step 7: Run full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/config/validator.ts test/unit/config-validator.test.ts
git commit -m "feat(config): expand knownFiles and rootCtx for transitive parent groups (#649)"
```

---

### Task 5: Update documentation and config schema

**Files:**
- Modify: `docs/configuration/groups.md`
- Modify: `docs/reference/config-schema.md:70-78`
- Modify: `config-schema.json` (root `definitions.groupConfig`)

- [ ] **Step 1: Update "Group Fields" table to include extends**

In `docs/configuration/groups.md`, add the `extends` row to the existing "Group Fields" table (around line 42-50):

```markdown
| Field        | Description                                           |
| ------------ | ----------------------------------------------------- |
| `extends`    | Parent group name(s) to inherit files, settings, PR options |
| `files`      | File definitions or overrides (same syntax as repos)  |
| `prOptions`  | PR merge options (merged into chain)                  |
| `settings`   | Repository settings like rulesets, labels             |
```

- [ ] **Step 2: Add "Group Inheritance" section to groups.md**

In `docs/configuration/groups.md`, add a new section after "## Multiple Groups" (after line 85) and before "## File Exclusion in Groups":

````markdown
## Group Inheritance (`extends`)

Groups can inherit from parent groups using the `extends` field. When a repo references a child group, it automatically gets the parent group's files, settings, and PR options — no need to list parent groups explicitly.

### Single Parent

```yaml
groups:
  github:
    files:
      .github/actionlint.yaml:
        content: "@templates/.github/actionlint.yaml"

  github-ci:
    extends: github
    files:
      .github/workflows/ci.yaml:
        content: "@templates/.github/workflows/ci.yaml"

  github-trivy:
    extends: github
    files:
      .github/workflows/trivy-scan.yaml:
        content: "@templates/.github/workflows/trivy-scan.yaml"

repos:
  - git: git@github.com:org/myrepo.git
    groups: [github-ci]
    # Gets actionlint.yaml (from github) + ci.yaml (from github-ci)
```

### Multiple Parents

`extends` accepts an array for multi-parent inheritance. Parents are merged left-to-right:

```yaml
groups:
  base-labels:
    settings:
      labels:
        managed: { color: "ededed" }

  github:
    files:
      .github/actionlint.yaml:
        content: "@templates/.github/actionlint.yaml"

  github-ci:
    extends: [github, base-labels]
    files:
      .github/workflows/ci.yaml:
        content: "@templates/.github/workflows/ci.yaml"
```

### Transitive Inheritance

Inheritance is transitive — if `c extends b` and `b extends a`, a repo with `groups: [c]` gets files from all three:

```yaml
groups:
  base:
    files:
      base.json: { content: { base: true } }
  mid:
    extends: base
    files:
      mid.json: { content: { mid: true } }
  leaf:
    extends: mid
    files:
      leaf.json: { content: { leaf: true } }

repos:
  - git: git@github.com:org/repo.git
    groups: [leaf]
    # Gets base.json, mid.json, and leaf.json
```

### Merge Order

The expanded group chain merges in topological order — parents before children:

1. **Root files** — base layer
2. **Transitive parent groups** — in dependency order
3. **Child group** — overrides parents
4. **Conditional groups** — evaluated against expanded group set
5. **Repo overrides** — final layer

Child groups can use `inherit: false` to discard parent files, or `file: false` to remove specific parent files.

### Interaction with Conditional Groups

The effective group set used for conditional group evaluation includes transitive parents. This means a conditional group with `when: { anyOf: [github] }` will match a repo with `groups: [github-ci]` if `github-ci extends github`.

### Restrictions

- Circular extends chains are not allowed
- All referenced parent groups must exist in the `groups` map
- A group cannot extend itself
````

- [ ] **Step 3: Update config-schema.json**

In `config-schema.json`, add the `extends` property to the `definitions.groupConfig.properties` object:

```json
{
  "extends": {
    "description": "Parent group name(s) to inherit files, settings, and PR options from. Accepts a single group name or an array of group names. Parents are merged before the child group.",
    "oneOf": [
      {
        "type": "string",
        "minLength": 1,
        "description": "Single parent group name"
      },
      {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "minItems": 1,
        "description": "Array of parent group names, merged left-to-right"
      }
    ]
  }
}
```

- [ ] **Step 4: Update docs/reference/config-schema.md**

In `docs/reference/config-schema.md`, add the `extends` row to the Group Config table (around line 72-76):

```markdown
| Field       | Type                 | Required | Description                                                  |
| ----------- | -------------------- | -------- | ------------------------------------------------------------ |
| `extends`   | `string \| string[]` | No       | Parent group name(s) to inherit from                         |
| `files`     | `object`             | No       | Files defined or overridden by this group                    |
| `prOptions` | `PROptions`          | No       | PR options for repos using this group                        |
| `settings`  | `object`             | No       | Settings for repos using this group (supports `inherit`)     |
```

- [ ] **Step 5: Commit**

```bash
git add docs/configuration/groups.md docs/reference/config-schema.md config-schema.json
git commit -m "docs: add group inheritance documentation and update config schema (#649)"
```

---

### Task 6: Type-check, lint, and full test pass

**Files:** None (verification only)

- [ ] **Step 1: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run test type-check**

Run: `npm run test:typecheck`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Run lint**

Run: `./lint.sh`
Expected: No lint errors
