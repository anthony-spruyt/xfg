# Inheritance Opt-Out Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow repos to opt out of inherited files and rulesets using `itemName: false` for single items or `inherit: false` for all items.

**Architecture:** Extend the existing file exclusion pattern (`fileName: false`) to rulesets, and add a new `inherit: boolean` property to both `files` and `rulesets` at the repo level. The normalizer will check these flags before merging inherited content.

**Tech Stack:** TypeScript, Node.js test runner, JSON Schema

---

## Task 1: Update Types in config.ts

**Files:**

- Modify: `src/config.ts:377-390`

**Step 1: Write the failing test**

```typescript
// In test/unit/config-normalizer.test.ts - add at end of file
describe("inheritance opt-out", () => {
  describe("files inherit: false", () => {
    test("inherit: false skips all root files", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "eslint.json": { content: { extends: ["base"] } },
          "prettier.json": { content: { semi: true } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              inherit: false,
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files.length, 0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="inherit: false skips all root files"`
Expected: FAIL with type error (inherit not valid property)

**Step 3: Update RawRepoSettings type**

In `src/config.ts`, update the `RawRepoSettings` interface:

```typescript
// Raw settings (before normalization)
export interface RawRepoSettings {
  rulesets?: Record<string, Ruleset | false> & { inherit?: boolean };
  deleteOrphaned?: boolean;
}
```

**Step 4: Update RawRepoConfig type**

In `src/config.ts`, update the `RawRepoConfig` interface:

```typescript
// Repo configuration
// files can map to false to exclude, or an object to override
// inherit: false skips all root files
export interface RawRepoConfig {
  git: string | string[];
  files?: Record<string, RawRepoFileOverride | false> & { inherit?: boolean };
  prOptions?: PRMergeOptions;
  settings?: RawRepoSettings;
}
```

**Step 5: Run TypeScript compilation**

Run: `npm run build`
Expected: PASS (types are valid)

**Step 6: Commit**

```bash
git add src/config.ts
git commit -m "feat(types): add inherit and false support for files and rulesets"
```

---

## Task 2: Add Validation for Reserved Key at Root Level

**Files:**

- Modify: `src/config-validator.ts:80-86`
- Test: `test/unit/config-validator.test.ts`

**Step 1: Write the failing test for root files**

```typescript
// In test/unit/config-validator.test.ts - add in "files validation" describe block
test("throws when 'inherit' is used as a filename at root level", () => {
  const config = createValidConfig({
    files: {
      inherit: { content: { key: "value" } },
    },
  });

  assert.throws(
    () => validateRawConfig(config),
    /'inherit' is a reserved key and cannot be used as a filename/
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="throws when 'inherit' is used as a filename"`
Expected: FAIL (no validation exists)

**Step 3: Add validation for reserved key in files**

In `src/config-validator.ts`, after line 78 (inside the files validation section):

```typescript
// Check for reserved key 'inherit' at root files level
if (hasFiles && "inherit" in config.files!) {
  throw new Error(
    "'inherit' is a reserved key and cannot be used as a filename"
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="throws when 'inherit' is used as a filename"`
Expected: PASS

**Step 5: Write the failing test for root rulesets**

```typescript
// In test/unit/config-validator.test.ts - add in "settings.rulesets validation" describe block
test("throws when 'inherit' is used as a ruleset name at root level", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        inherit: { target: "branch" },
      },
    },
  });

  assert.throws(
    () => validateRawConfig(config),
    /'inherit' is a reserved key and cannot be used as a ruleset name/
  );
});
```

**Step 6: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="throws when 'inherit' is used as a ruleset name"`
Expected: FAIL

**Step 7: Add validation for reserved key in rulesets**

In `src/config-validator.ts`, inside `validateSettings` function, after line 722:

```typescript
// Check for reserved key 'inherit' at root rulesets level
if ("inherit" in rulesets) {
  throw new Error(
    `${context}: 'inherit' is a reserved key and cannot be used as a ruleset name`
  );
}
```

**Step 8: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="throws when 'inherit' is used as a ruleset name"`
Expected: PASS

**Step 9: Commit**

```bash
git add src/config-validator.ts test/unit/config-validator.test.ts
git commit -m "feat(validation): reject 'inherit' as reserved key at root level"
```

---

## Task 3: Add Validation for Opt-Out of Non-Existent Rulesets

**Files:**

- Modify: `src/config-validator.ts:372-376`
- Test: `test/unit/config-validator.test.ts`

**Step 1: Write the failing test**

```typescript
// In test/unit/config-validator.test.ts - add in "settings.rulesets validation" describe block
test("throws when opting out of non-existent ruleset", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        "main-protection": { target: "branch" },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            "nonexistent-ruleset": false,
          },
        },
      },
    ],
  });

  assert.throws(
    () => validateRawConfig(config),
    /Cannot opt out of 'nonexistent-ruleset' - not defined in root settings\.rulesets/
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="throws when opting out of non-existent ruleset"`
Expected: FAIL

**Step 3: Add validation in validateSettings for repo-level rulesets**

In `src/config-validator.ts`, modify the repo settings validation section (around line 373). We need to pass root rulesets to validate against:

First, update the `validateSettings` function signature to accept an optional `rootRulesetNames` parameter:

```typescript
export function validateSettings(
  settings: unknown,
  context: string,
  rootRulesetNames?: string[]
): void {
```

Then, inside the rulesets validation loop, add:

```typescript
for (const [name, ruleset] of Object.entries(rulesets)) {
  // Skip reserved key
  if (name === "inherit") continue;

  // Check for opt-out of non-existent root ruleset
  if (ruleset === false) {
    if (rootRulesetNames && !rootRulesetNames.includes(name)) {
      throw new Error(
        `${context}: Cannot opt out of '${name}' - not defined in root settings.rulesets`
      );
    }
    continue; // Skip further validation for false entries
  }

  validateRuleset(ruleset, name, context);
}
```

Update the call sites:

- Root level: `validateSettings(config.settings, "Root")` (no rootRulesetNames)
- Repo level: `validateSettings(repo.settings, context, rootRulesetNames)` where `rootRulesetNames = Object.keys(config.settings?.rulesets ?? {})`

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="throws when opting out of non-existent ruleset"`
Expected: PASS

**Step 5: Write test for valid ruleset opt-out**

```typescript
test("allows opting out of existing ruleset with false", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        "main-protection": { target: "branch" },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            "main-protection": false,
          },
        },
      },
    ],
  });

  assert.doesNotThrow(() => validateRawConfig(config));
});
```

**Step 6: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="allows opting out of existing ruleset"`
Expected: PASS

**Step 7: Commit**

```bash
git add src/config-validator.ts test/unit/config-validator.test.ts
git commit -m "feat(validation): validate ruleset opt-out references existing ruleset"
```

---

## Task 4: Implement Files inherit: false in Normalizer

**Files:**

- Modify: `src/config-normalizer.ts:121-255`
- Test: `test/unit/config-normalizer.test.ts`

**Step 1: Write failing tests for files inherit**

```typescript
// In test/unit/config-normalizer.test.ts - add to "inheritance opt-out" describe block
describe("files inherit: false", () => {
  test("inherit: false skips all root files", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "eslint.json": { content: { extends: ["base"] } },
        "prettier.json": { content: { semi: true } },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          files: {
            inherit: false,
          },
        },
      ],
    };

    const result = normalizeConfig(raw);
    assert.equal(result.repos[0].files.length, 0);
  });

  test("inherit: false with custom file includes only custom", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "eslint.json": { content: { extends: ["base"] } },
        "custom.json": { content: {} },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          files: {
            inherit: false,
            "custom.json": { content: { custom: true } },
          },
        },
      ],
    };

    const result = normalizeConfig(raw);
    assert.equal(result.repos[0].files.length, 1);
    assert.equal(result.repos[0].files[0].fileName, "custom.json");
    assert.deepEqual(result.repos[0].files[0].content, { custom: true });
  });

  test("inherit: true is same as not specifying", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "eslint.json": { content: { extends: ["base"] } },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          files: {
            inherit: true,
          },
        },
      ],
    };

    const result = normalizeConfig(raw);
    assert.equal(result.repos[0].files.length, 1);
    assert.equal(result.repos[0].files[0].fileName, "eslint.json");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="files inherit"`
Expected: FAIL

**Step 3: Implement files inherit: false logic**

In `src/config-normalizer.ts`, modify `normalizeConfig` function. Around line 130, after `const files: FileContent[] = [];`:

```typescript
// Check if repo opts out of all inherited files
const inheritFiles = (rawRepo.files as Record<string, unknown>)?.inherit !== false;

// Step 2: Process each file definition
for (const fileName of fileNames) {
  // Skip reserved key
  if (fileName === "inherit") continue;

  const repoOverride = rawRepo.files?.[fileName];

  // Skip excluded files (set to false)
  if (repoOverride === false) {
    continue;
  }

  // Skip if inherit: false and no repo-specific override
  if (!inheritFiles && !repoOverride) {
    continue;
  }

  // ... rest of existing merge logic stays the same
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="files inherit"`
Expected: PASS

**Step 5: Run all normalizer tests**

Run: `npm test -- --test-name-pattern="normalizeConfig"`
Expected: PASS (no regressions)

**Step 6: Commit**

```bash
git add src/config-normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat(normalizer): implement files inherit: false"
```

---

## Task 5: Implement Single Ruleset Opt-Out in Normalizer

**Files:**

- Modify: `src/config-normalizer.ts:82-115`
- Test: `test/unit/config-normalizer.test.ts`

**Step 1: Write failing test**

```typescript
// In test/unit/config-normalizer.test.ts - add to "inheritance opt-out" describe block
describe("rulesets opt-out", () => {
  test("rulesetName: false excludes single ruleset", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "config.json": { content: {} } },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          settings: {
            rulesets: {
              "main-protection": false,
            },
          },
        },
      ],
      settings: {
        rulesets: {
          "main-protection": { target: "branch", enforcement: "active" },
          "release-protection": { target: "branch", enforcement: "active" },
        },
      },
    };

    const result = normalizeConfig(raw);
    assert.ok(result.repos[0].settings?.rulesets);
    assert.equal(
      result.repos[0].settings?.rulesets?.["main-protection"],
      undefined
    );
    assert.ok(result.repos[0].settings?.rulesets?.["release-protection"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="rulesetName: false excludes single ruleset"`
Expected: FAIL

**Step 3: Implement single ruleset opt-out**

In `src/config-normalizer.ts`, modify `mergeSettings` function:

```typescript
export function mergeSettings(
  root: RawRepoSettings | undefined,
  perRepo: RawRepoSettings | undefined
): RepoSettings | undefined {
  if (!root && !perRepo) return undefined;

  const result: RepoSettings = {};

  // Merge rulesets by name - each ruleset is deep merged
  const rootRulesets = root?.rulesets ?? {};
  const repoRulesets = perRepo?.rulesets ?? {};

  // Check if repo opts out of all inherited rulesets
  const inheritRulesets =
    (repoRulesets as Record<string, unknown>)?.inherit !== false;

  const allRulesetNames = new Set([
    ...Object.keys(rootRulesets).filter((name) => name !== "inherit"),
    ...Object.keys(repoRulesets).filter((name) => name !== "inherit"),
  ]);

  if (allRulesetNames.size > 0) {
    result.rulesets = {};
    for (const name of allRulesetNames) {
      const rootRuleset = rootRulesets[name];
      const repoRuleset = repoRulesets[name];

      // Skip if repo explicitly opts out of this ruleset
      if (repoRuleset === false) {
        continue;
      }

      // Skip root rulesets if inherit: false (unless repo has override)
      if (!inheritRulesets && !repoRuleset && rootRuleset) {
        continue;
      }

      result.rulesets[name] = mergeRuleset(
        rootRuleset as Ruleset | undefined,
        repoRuleset as Ruleset | undefined
      );
    }

    // Clean up empty rulesets object
    if (Object.keys(result.rulesets).length === 0) {
      delete result.rulesets;
    }
  }

  // deleteOrphaned: per-repo overrides root
  const deleteOrphaned = perRepo?.deleteOrphaned ?? root?.deleteOrphaned;
  if (deleteOrphaned !== undefined) {
    result.deleteOrphaned = deleteOrphaned;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="rulesetName: false excludes single ruleset"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-normalizer.ts test/unit/config-normalizer.test.ts
git commit -m "feat(normalizer): implement single ruleset opt-out with false"
```

---

## Task 6: Implement Rulesets inherit: false in Normalizer

**Files:**

- Modify: `src/config-normalizer.ts:82-115` (already modified in Task 5)
- Test: `test/unit/config-normalizer.test.ts`

**Step 1: Write failing tests**

```typescript
// In test/unit/config-normalizer.test.ts - add to "rulesets opt-out" describe block
test("rulesets inherit: false skips all root rulesets", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            inherit: false,
          },
        },
      },
    ],
    settings: {
      rulesets: {
        "main-protection": { target: "branch" },
        "release-protection": { target: "branch" },
      },
    },
  };

  const result = normalizeConfig(raw);
  assert.equal(result.repos[0].settings?.rulesets, undefined);
});

test("rulesets inherit: false with custom ruleset includes only custom", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            inherit: false,
            "custom-ruleset": { target: "tag", enforcement: "active" },
          },
        },
      },
    ],
    settings: {
      rulesets: {
        "main-protection": { target: "branch" },
      },
    },
  };

  const result = normalizeConfig(raw);
  assert.ok(result.repos[0].settings?.rulesets);
  assert.equal(
    result.repos[0].settings?.rulesets?.["main-protection"],
    undefined
  );
  assert.ok(result.repos[0].settings?.rulesets?.["custom-ruleset"]);
  assert.equal(
    result.repos[0].settings?.rulesets?.["custom-ruleset"]?.target,
    "tag"
  );
});

test("rulesets inherit: true is same as not specifying", () => {
  const raw: RawConfig = {
    id: "test-config",
    files: { "config.json": { content: {} } },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            inherit: true,
          },
        },
      },
    ],
    settings: {
      rulesets: {
        "main-protection": { target: "branch" },
      },
    },
  };

  const result = normalizeConfig(raw);
  assert.ok(result.repos[0].settings?.rulesets?.["main-protection"]);
});
```

**Step 2: Run tests to verify they pass (already implemented in Task 5)**

Run: `npm test -- --test-name-pattern="rulesets inherit"`
Expected: PASS (logic was implemented in Task 5)

**Step 3: Run all settings tests**

Run: `npm test -- --test-name-pattern="settings merging"`
Expected: PASS (no regressions)

**Step 4: Commit**

```bash
git add test/unit/config-normalizer.test.ts
git commit -m "test(normalizer): add tests for rulesets inherit: false"
```

---

## Task 7: Update JSON Schema

**Files:**

- Modify: `config-schema.json`

**Step 1: Update repo files schema to allow inherit**

In `config-schema.json`, find the `repo` definition (around line 170) and update the `files` property:

```json
"files": {
  "type": "object",
  "description": "Per-repo file overrides or exclusions. Keys must reference files defined in the root 'files' object. Set to false to exclude a file from this repo. Set inherit: false to skip all inherited files.",
  "properties": {
    "inherit": {
      "type": "boolean",
      "description": "Set to false to skip all inherited root files. Default: true"
    }
  },
  "additionalProperties": {
    "oneOf": [
      {
        "type": "boolean",
        "const": false,
        "description": "Set to false to exclude this file from this repo"
      },
      {
        "$ref": "#/definitions/repoFileOverride"
      }
    ]
  }
}
```

**Step 2: Update repoSettings schema to allow inherit and false for rulesets**

In `config-schema.json`, find the `repoSettings` definition (around line 307) and update:

```json
"repoSettings": {
  "type": "object",
  "description": "Repository settings including GitHub Rulesets",
  "properties": {
    "rulesets": {
      "type": "object",
      "description": "Map of ruleset names to configurations. Set a ruleset to false to opt out. Set inherit: false to skip all inherited rulesets.",
      "properties": {
        "inherit": {
          "type": "boolean",
          "description": "Set to false to skip all inherited root rulesets. Default: true"
        }
      },
      "additionalProperties": {
        "oneOf": [
          {
            "type": "boolean",
            "const": false,
            "description": "Set to false to opt out of this inherited ruleset"
          },
          {
            "$ref": "#/definitions/ruleset"
          }
        ]
      }
    },
    "deleteOrphaned": {
      "type": "boolean",
      "default": false,
      "description": "Track rulesets for orphan deletion. When true, if a ruleset is removed from the config, it will be deleted from the repo. Default: false"
    }
  }
}
```

**Step 3: Validate schema is well-formed**

Run: `node -e "require('./config-schema.json')"`
Expected: No errors

**Step 4: Commit**

```bash
git add config-schema.json
git commit -m "feat(schema): add inherit and false support to JSON schema"
```

---

## Task 8: Update Validation for inherit at Repo Level

**Files:**

- Modify: `src/config-validator.ts`
- Test: `test/unit/config-validator.test.ts`

**Step 1: Write test for valid inherit values**

```typescript
// In test/unit/config-validator.test.ts
test("allows inherit: false in repo files", () => {
  const config = createValidConfig({
    repos: [
      {
        git: "git@github.com:org/repo.git",
        files: {
          inherit: false,
        },
      },
    ],
  });
  assert.doesNotThrow(() => validateRawConfig(config));
});

test("allows inherit: true in repo files", () => {
  const config = createValidConfig({
    repos: [
      {
        git: "git@github.com:org/repo.git",
        files: {
          inherit: true,
        },
      },
    ],
  });
  assert.doesNotThrow(() => validateRawConfig(config));
});

test("allows inherit: false in repo rulesets", () => {
  const config = createValidConfig({
    settings: {
      rulesets: {
        "main-protection": { target: "branch" },
      },
    },
    repos: [
      {
        git: "git@github.com:org/repo.git",
        settings: {
          rulesets: {
            inherit: false,
          },
        },
      },
    ],
  });
  assert.doesNotThrow(() => validateRawConfig(config));
});
```

**Step 2: Run tests**

Run: `npm test -- --test-name-pattern="allows inherit"`
Expected: PASS (these should already work with type changes)

**Step 3: Update validation to skip 'inherit' key when validating file references**

In `src/config-validator.ts`, around line 247, update the repo files validation:

```typescript
// Validate per-repo file overrides
if (repo.files) {
  if (typeof repo.files !== "object" || Array.isArray(repo.files)) {
    throw new Error(`Repo at index ${i}: files must be an object`);
  }

  for (const fileName of Object.keys(repo.files)) {
    // Skip reserved key 'inherit'
    if (fileName === "inherit") {
      const inheritValue = (repo.files as Record<string, unknown>).inherit;
      if (typeof inheritValue !== "boolean") {
        throw new Error(
          `Repo at index ${i}: files.inherit must be a boolean`
        );
      }
      continue;
    }

    // Ensure the file is defined at root level
    if (!config.files || !config.files[fileName]) {
      throw new Error(
        `Repo at index ${i} references undefined file '${fileName}'. File must be defined in root 'files' object.`
      );
    }
    // ... rest of validation
```

**Step 4: Run all validation tests**

Run: `npm test -- --test-name-pattern="validateRawConfig"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-validator.ts test/unit/config-validator.test.ts
git commit -m "feat(validation): allow and validate inherit at repo level"
```

---

## Task 9: Update Documentation - inheritance.md

**Files:**

- Modify: `docs/configuration/inheritance.md`

**Step 1: Add section for inherit: false**

After the "File Exclusion" section (around line 93), add:

````markdown
## Skipping All Inherited Files

Use `inherit: false` to skip all root-level files for a specific repo. You can optionally add repo-specific files:

```yaml
files:
  .eslintrc.json:
    content:
      extends: ["@company/base"]
  .prettierrc.json:
    content:
      semi: true

repos:
  # Standard repo - gets all files
  - git: git@github.com:org/frontend.git

  # Settings-only repo - skip all files
  - git: git@github.com:org/settings-only.git
    files:
      inherit: false

  # Custom files repo - skip inherited, add custom
  - git: git@github.com:org/custom-repo.git
    files:
      inherit: false
      .custom-config.json:
        content:
          custom: true
```
````

When `inherit: false`:

- All files defined in root `files` are skipped
- Only files explicitly defined in the repo's `files` object are included
- `inherit: true` (or omitting `inherit`) means inherit all root files (default behavior)

````

**Step 2: Commit**

```bash
git add docs/configuration/inheritance.md
git commit -m "docs: add inherit: false documentation for files"
````

---

## Task 10: Update Documentation - rulesets.md

**Files:**

- Modify: `docs/configuration/rulesets.md`

**Step 1: Update the Inheritance section (around line 181)**

Replace the existing Inheritance section with:

````markdown
## Inheritance and Opt-Out

Like files, rulesets support inheritance with options to opt out.

### Default Inheritance

Define defaults at the root level and override per-repo:

```yaml
# Root-level defaults for all repos
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include: [refs/heads/main]
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1

repos:
  # Gets default ruleset
  - git: git@github.com:your-org/standard-repo.git

  # Overrides with stricter requirements
  - git: git@github.com:your-org/critical-repo.git
    settings:
      rulesets:
        main-protection:
          rules:
            - type: pull_request
              parameters:
                requiredApprovingReviewCount: 3 # Override
```
````

### Single Ruleset Opt-Out

Set a ruleset to `false` to exclude it from a specific repo:

```yaml
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
    release-protection:
      target: branch
      enforcement: active

repos:
  # Gets both rulesets
  - git: git@github.com:your-org/standard-repo.git

  # Skips release-protection only
  - git: git@github.com:your-org/no-releases.git
    settings:
      rulesets:
        release-protection: false
```

### Skipping All Inherited Rulesets

Use `inherit: false` to skip all root-level rulesets. You can optionally add repo-specific rulesets:

```yaml
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active

repos:
  # No rulesets at all
  - git: git@github.com:your-org/experimental.git
    settings:
      rulesets:
        inherit: false

  # Skip inherited, add custom
  - git: git@github.com:your-org/custom-rules.git
    settings:
      rulesets:
        inherit: false
        custom-ruleset:
          target: tag
          enforcement: active
          conditions:
            refName:
              include: [refs/tags/v*]
          rules:
            - type: required_signatures
```

````

**Step 2: Commit**

```bash
git add docs/configuration/rulesets.md
git commit -m "docs: add ruleset opt-out documentation"
````

---

## Task 11: Run Full Test Suite and Lint

**Files:**

- All modified files

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run linter**

Run: `./lint.sh`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "fix: lint and formatting fixes" --allow-empty
```

---

## Task 12: Final Review and Summary

**Step 1: Review all changes**

Run: `git log --oneline feature/inheritance-opt-out ^main`

**Step 2: Verify feature works end-to-end**

Create a test config file and run `npm run dev -- sync --config test-config.yaml --dry-run`

**Step 3: Summary of changes**

| File                                  | Changes                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`                       | Added `inherit?: boolean` to `RawRepoConfig.files` and `RawRepoSettings.rulesets`, allowed `false` for rulesets |
| `src/config-normalizer.ts`            | Implemented `inherit: false` logic for files and rulesets, single ruleset opt-out with `false`                  |
| `src/config-validator.ts`             | Reject `inherit` as reserved key at root, validate ruleset opt-out references exist, validate `inherit` type    |
| `config-schema.json`                  | Added `inherit` property and `false` support for files and rulesets                                             |
| `test/unit/config-normalizer.test.ts` | Added tests for all inheritance opt-out scenarios                                                               |
| `test/unit/config-validator.test.ts`  | Added tests for validation of reserved key and opt-out references                                               |
| `docs/configuration/inheritance.md`   | Added `inherit: false` documentation for files                                                                  |
| `docs/configuration/rulesets.md`      | Added single opt-out and `inherit: false` documentation for rulesets                                            |
