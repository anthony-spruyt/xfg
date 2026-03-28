# Multi-File Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `-c` to accept a directory, loading and merging all `.yaml`/`.yml` files in it into a single config.

**Architecture:** A new `mergeConfigFragments()` pure function in a new `src/config/config-merger.ts` file handles fragment merging. The existing `loadConfig()`/`loadRawConfig()` in `loader.ts` gains directory detection that scans, loads each file individually, merges, then returns the merged `RawConfig`. Everything downstream (normalizer, validator, processor) is untouched.

**Tech Stack:** TypeScript, Node.js `fs`/`path`, existing `yaml` parser, existing `ValidationError`

**Issue:** Closes #671

---

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `src/config/config-merger.ts` | Create | `mergeConfigFragments()` pure function + types |
| `src/config/loader.ts` | Modify | Directory detection, scan, load-each, merge, return |
| `src/config/types.ts` | Modify | Make `id` and `repos` optional on `RawConfig` |
| `src/config/validator.ts` | Modify | Handle optional `id`/`repos` for fragment validation |
| `src/config/index.ts` | Modify | Re-export `loadConfigFromDirectory` |
| `src/cli/sync-command.ts` | Modify | Accept directory path (update existence check) |
| `config-schema.json` | Modify | Remove `id` and `repos` from `required` |
| `test/unit/config-merger.test.ts` | Create | Unit tests for `mergeConfigFragments()` |
| `test/unit/config.test.ts` | Modify | Integration tests for directory loading |

---

### Task 1: Create `mergeConfigFragments()` with basic repos concatenation

**Files:**
- Create: `test/unit/config-merger.test.ts`
- Create: `src/config/config-merger.ts`

- [ ] **Step 1: Write the failing test — two fragments with repos concatenate**

```typescript
// test/unit/config-merger.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { mergeConfigFragments } from "../../src/config/config-merger.js";
import type { RawConfig } from "../../src/config/types.js";

describe("mergeConfigFragments", () => {
  test("concatenates repos from multiple fragments in order", () => {
    const fragments: Array<{ fileName: string; config: Partial<RawConfig> }> = [
      {
        fileName: "a.yaml",
        config: {
          id: "test",
          files: { "test.json": { content: {} } },
          repos: [{ git: "git@github.com:org/repo-a.git" }],
        },
      },
      {
        fileName: "b.yaml",
        config: {
          repos: [{ git: "git@github.com:org/repo-b.git" }],
        },
      },
    ];

    const result = mergeConfigFragments(fragments);

    assert.equal(result.id, "test");
    assert.equal(result.repos.length, 2);
    assert.equal(result.repos[0].git, "git@github.com:org/repo-a.git");
    assert.equal(result.repos[1].git, "git@github.com:org/repo-b.git");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/config-merger.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/config/config-merger.ts
import type { RawConfig } from "./types.js";
import { ValidationError } from "../shared/errors.js";

export interface ConfigFragment {
  fileName: string;
  config: Partial<RawConfig>;
}

/**
 * Merge multiple config fragments into a single RawConfig.
 * Rules:
 * - groups, conditionalGroups, repos can span multiple files
 * - group names must be unique across files
 * - all other keys must appear in at most one file
 * - exactly one file must define 'id'
 */
export function mergeConfigFragments(fragments: ConfigFragment[]): RawConfig {
  if (fragments.length === 0) {
    throw new ValidationError("No config fragments to merge");
  }

  const merged: Partial<RawConfig> = {};
  const repos: RawConfig["repos"] = [];

  for (const { fileName, config } of fragments) {
    if (config.repos) {
      repos.push(...config.repos);
    }

    if (config.id !== undefined) {
      if (merged.id !== undefined) {
        throw new ValidationError(
          `'id' is defined in multiple files — this key can only appear in one file`
        );
      }
      merged.id = config.id;
    }

    if (config.files !== undefined) {
      if (merged.files !== undefined) {
        throw new ValidationError(
          `'files' is defined in multiple files — this key can only appear in one file`
        );
      }
      merged.files = config.files;
    }
  }

  if (!merged.id) {
    throw new ValidationError(
      "No 'id' found in any config file — exactly one file must define 'id'"
    );
  }

  return {
    ...merged,
    id: merged.id,
    repos,
  } as RawConfig;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/config-merger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/config-merger.ts test/unit/config-merger.test.ts
git commit -m "feat(config): add mergeConfigFragments with repos concatenation (#671)"
```

---

### Task 2: Add single-file key enforcement to merger

**Files:**
- Modify: `test/unit/config-merger.test.ts`
- Modify: `src/config/config-merger.ts`

- [ ] **Step 1: Write failing tests for all single-file keys**

Add to `test/unit/config-merger.test.ts`:

```typescript
  test("errors when id is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      { fileName: "a.yaml", config: { id: "one", repos: [] } },
      { fileName: "b.yaml", config: { id: "two", repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) => err.message.includes("'id' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when files is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      { fileName: "a.yaml", config: { id: "test", files: { "a.json": { content: {} } }, repos: [] } },
      { fileName: "b.yaml", config: { files: { "b.json": { content: {} } }, repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) => err.message.includes("'files' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when prOptions is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      { fileName: "a.yaml", config: { id: "test", prOptions: { merge: "auto" }, repos: [] } },
      { fileName: "b.yaml", config: { prOptions: { merge: "direct" }, repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) => err.message.includes("'prOptions' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when settings is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      { fileName: "a.yaml", config: { id: "test", settings: { labels: {} }, repos: [] } },
      { fileName: "b.yaml", config: { settings: { labels: {} }, repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) => err.message.includes("'settings' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when prTemplate is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      { fileName: "a.yaml", config: { id: "test", prTemplate: "a", repos: [] } },
      { fileName: "b.yaml", config: { prTemplate: "b", repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) => err.message.includes("'prTemplate' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when githubHosts is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      { fileName: "a.yaml", config: { id: "test", githubHosts: ["a.com"], repos: [] } },
      { fileName: "b.yaml", config: { githubHosts: ["b.com"], repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) => err.message.includes("'githubHosts' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when deleteOrphaned is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      { fileName: "a.yaml", config: { id: "test", deleteOrphaned: true, repos: [] } },
      { fileName: "b.yaml", config: { deleteOrphaned: false, repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) => err.message.includes("'deleteOrphaned' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when no file defines id", () => {
    const fragments: ConfigFragment[] = [
      { fileName: "a.yaml", config: { repos: [{ git: "git@github.com:org/a.git" }] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) => err.message.includes("No 'id' found in any config file")
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/config-merger.test.ts`
Expected: FAIL — error messages don't include filenames yet, and not all keys are checked

- [ ] **Step 3: Update implementation to enforce all single-file keys with filenames in errors**

Replace `src/config/config-merger.ts` with:

```typescript
// src/config/config-merger.ts
import type { RawConfig } from "./types.js";
import { ValidationError } from "../shared/errors.js";

export interface ConfigFragment {
  fileName: string;
  config: Partial<RawConfig>;
}

/** Keys that can only appear in one file across a config directory. */
const SINGLE_FILE_KEYS: ReadonlyArray<keyof RawConfig> = [
  "id",
  "files",
  "prOptions",
  "prTemplate",
  "settings",
  "githubHosts",
  "deleteOrphaned",
];

export function mergeConfigFragments(fragments: ConfigFragment[]): RawConfig {
  if (fragments.length === 0) {
    throw new ValidationError("No config fragments to merge");
  }

  const merged: Record<string, unknown> = {};
  const singleKeySource: Partial<Record<keyof RawConfig, string>> = {};
  const allRepos: RawConfig["repos"][number][] = [];
  const allGroups: Record<string, unknown> = {};
  const allConditionalGroups: RawConfig["conditionalGroups"] = [];

  for (const { fileName, config } of fragments) {
    // Enforce single-file keys
    for (const key of SINGLE_FILE_KEYS) {
      if (config[key] !== undefined) {
        if (singleKeySource[key] !== undefined) {
          throw new ValidationError(
            `'${key}' is defined in both ${singleKeySource[key]} and ${fileName} — this key can only appear in one file`
          );
        }
        singleKeySource[key] = fileName;
        merged[key] = config[key];
      }
    }

    // Concatenate repos
    if (config.repos) {
      allRepos.push(...config.repos);
    }

    // Merge groups (unique names only)
    if (config.groups) {
      for (const [groupName, groupConfig] of Object.entries(config.groups)) {
        if (groupName in allGroups) {
          const existingFile = findGroupSource(fragments, groupName, fileName);
          throw new ValidationError(
            `group '${groupName}' is defined in both ${existingFile} and ${fileName} — group names must be unique across files`
          );
        }
        allGroups[groupName] = groupConfig;
      }
    }

    // Concatenate conditional groups
    if (config.conditionalGroups) {
      allConditionalGroups.push(...config.conditionalGroups);
    }
  }

  if (!merged.id) {
    throw new ValidationError(
      "No 'id' found in any config file — exactly one file must define 'id'"
    );
  }

  return {
    ...merged,
    repos: allRepos,
    ...(Object.keys(allGroups).length > 0 ? { groups: allGroups } : {}),
    ...(allConditionalGroups.length > 0
      ? { conditionalGroups: allConditionalGroups }
      : {}),
  } as RawConfig;
}

function findGroupSource(
  fragments: ConfigFragment[],
  groupName: string,
  currentFile: string
): string {
  for (const { fileName, config } of fragments) {
    if (fileName !== currentFile && config.groups && groupName in config.groups) {
      return fileName;
    }
  }
  return "unknown";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/config-merger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/config-merger.ts test/unit/config-merger.test.ts
git commit -m "feat(config): enforce single-file keys and filename error attribution (#671)"
```

---

### Task 3: Add group uniqueness enforcement to merger

**Files:**
- Modify: `test/unit/config-merger.test.ts`
- Modify: `src/config/config-merger.ts` (already has the logic from Task 2, this task adds tests)

- [ ] **Step 1: Write failing tests for group merging**

Add to `test/unit/config-merger.test.ts`:

```typescript
  test("merges unique groups from multiple files", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: {
          id: "test",
          groups: {
            "group-a": { files: { "a.json": { content: {} } } },
          },
          repos: [{ git: "git@github.com:org/a.git", groups: ["group-a"] }],
        },
      },
      {
        fileName: "b.yaml",
        config: {
          groups: {
            "group-b": { files: { "b.json": { content: {} } } },
          },
          repos: [{ git: "git@github.com:org/b.git", groups: ["group-b"] }],
        },
      },
    ];

    const result = mergeConfigFragments(fragments);

    assert.ok(result.groups);
    assert.ok("group-a" in result.groups);
    assert.ok("group-b" in result.groups);
    assert.equal(Object.keys(result.groups).length, 2);
  });

  test("errors when same group name appears in multiple files", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: {
          id: "test",
          groups: { shared: { files: { "a.json": { content: {} } } } },
          repos: [],
        },
      },
      {
        fileName: "b.yaml",
        config: {
          groups: { shared: { files: { "b.json": { content: {} } } } },
          repos: [],
        },
      },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) =>
        err.message.includes("group 'shared' is defined in both a.yaml and b.yaml")
    );
  });

  test("concatenates conditionalGroups from multiple files", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: {
          id: "test",
          files: { "base.json": { content: {} } },
          conditionalGroups: [
            { when: { allOf: ["g1"] }, files: { "cond-a.json": { content: {} } } },
          ],
          repos: [],
        },
      },
      {
        fileName: "b.yaml",
        config: {
          conditionalGroups: [
            { when: { anyOf: ["g2"] }, files: { "cond-b.json": { content: {} } } },
          ],
          repos: [],
        },
      },
    ];

    const result = mergeConfigFragments(fragments);

    assert.ok(result.conditionalGroups);
    assert.equal(result.conditionalGroups.length, 2);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx tsx --test test/unit/config-merger.test.ts`
Expected: PASS (logic already implemented in Task 2)

- [ ] **Step 3: Commit**

```bash
git add test/unit/config-merger.test.ts
git commit -m "test(config): add group merge and conditionalGroups tests (#671)"
```

---

### Task 4: Add directory loading to `loader.ts`

**Files:**
- Modify: `test/unit/config.test.ts`
- Modify: `src/config/loader.ts`
- Modify: `src/config/index.ts`

- [ ] **Step 1: Write failing test for loading a config directory**

Add to `test/unit/config.test.ts` at the end of the `"Config"` describe block:

```typescript
  describe("directory loading", () => {
    test("loads and merges all yaml files from a directory", () => {
      const configDir = join(testDir, "config-dir-" + Date.now());
      mkdirSync(configDir, { recursive: true });

      writeFileSync(
        join(configDir, "base.yaml"),
        `
id: test-dir
files:
  base.json:
    content:
      key: value
repos:
  - git: git@github.com:org/repo-a.git
`,
        "utf-8"
      );

      writeFileSync(
        join(configDir, "teams.yaml"),
        `
repos:
  - git: git@github.com:org/repo-b.git
`,
        "utf-8"
      );

      const config = loadConfig(configDir, {});

      assert.equal(config.repos.length, 2);
      assert.equal(config.repos[0].git, "git@github.com:org/repo-a.git");
      assert.equal(config.repos[1].git, "git@github.com:org/repo-b.git");
    });

    test("sorts files alphabetically so merge order is deterministic", () => {
      const configDir = join(testDir, "config-sort-" + Date.now());
      mkdirSync(configDir, { recursive: true });

      writeFileSync(
        join(configDir, "b-teams.yaml"),
        `
repos:
  - git: git@github.com:org/repo-b.git
`,
        "utf-8"
      );

      writeFileSync(
        join(configDir, "a-base.yaml"),
        `
id: test-sort
files:
  base.json:
    content:
      key: value
repos:
  - git: git@github.com:org/repo-a.git
`,
        "utf-8"
      );

      const config = loadConfig(configDir, {});

      // a-base.yaml sorts before b-teams.yaml
      assert.equal(config.repos[0].git, "git@github.com:org/repo-a.git");
      assert.equal(config.repos[1].git, "git@github.com:org/repo-b.git");
    });

    test("errors when directory has no yaml files", () => {
      const configDir = join(testDir, "config-empty-" + Date.now());
      mkdirSync(configDir, { recursive: true });

      assert.throws(
        () => loadConfig(configDir, {}),
        (err: Error) => err.message.includes("No .yaml or .yml files found")
      );
    });

    test("loads both .yaml and .yml files", () => {
      const configDir = join(testDir, "config-ext-" + Date.now());
      mkdirSync(configDir, { recursive: true });

      writeFileSync(
        join(configDir, "base.yaml"),
        `
id: test-ext
files:
  base.json:
    content:
      key: value
repos:
  - git: git@github.com:org/repo-a.git
`,
        "utf-8"
      );

      writeFileSync(
        join(configDir, "extra.yml"),
        `
repos:
  - git: git@github.com:org/repo-b.git
`,
        "utf-8"
      );

      const config = loadConfig(configDir, {});
      assert.equal(config.repos.length, 2);
    });

    test("ignores non-yaml files in directory", () => {
      const configDir = join(testDir, "config-ignore-" + Date.now());
      mkdirSync(configDir, { recursive: true });

      writeFileSync(
        join(configDir, "base.yaml"),
        `
id: test-ignore
files:
  base.json:
    content:
      key: value
repos:
  - git: git@github.com:org/repo-a.git
`,
        "utf-8"
      );

      writeFileSync(join(configDir, "README.md"), "# Not a config", "utf-8");
      writeFileSync(join(configDir, "notes.txt"), "not yaml", "utf-8");

      const config = loadConfig(configDir, {});
      assert.equal(config.repos.length, 1);
    });

    test("does not recurse into subdirectories", () => {
      const configDir = join(testDir, "config-norecurse-" + Date.now());
      const subDir = join(configDir, "subdir");
      mkdirSync(subDir, { recursive: true });

      writeFileSync(
        join(configDir, "base.yaml"),
        `
id: test-norecurse
files:
  base.json:
    content:
      key: value
repos:
  - git: git@github.com:org/repo-a.git
`,
        "utf-8"
      );

      writeFileSync(
        join(subDir, "nested.yaml"),
        `
repos:
  - git: git@github.com:org/repo-nested.git
`,
        "utf-8"
      );

      const config = loadConfig(configDir, {});
      assert.equal(config.repos.length, 1);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/unit/config.test.ts`
Expected: FAIL — loadConfig doesn't accept directories

- [ ] **Step 3: Update loader.ts to support directory loading**

Replace `src/config/loader.ts` with:

```typescript
import { readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { parse } from "yaml";
import { validateRawConfig } from "./validator.js";
import { normalizeConfig as normalizeConfigInternal } from "./normalizer.js";
import { resolveFileReferencesInConfig } from "./file-reference-resolver.js";
import type { RawConfig, Config } from "./types.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { ValidationError } from "../shared/errors.js";
import { mergeConfigFragments, type ConfigFragment } from "./config-merger.js";

export { normalizeConfigInternal as normalizeConfig };

/**
 * Load and validate raw config without normalization.
 * Use this when you need to perform command-specific validation before normalizing.
 */
export function loadRawConfig(configPath: string): RawConfig {
  const stat = statSync(configPath);

  if (stat.isDirectory()) {
    return loadRawConfigFromDirectory(configPath);
  }

  return loadRawConfigFromFile(configPath);
}

export function loadConfig(
  configPath: string,
  env: Record<string, string | undefined>
): Config {
  const rawConfig = loadRawConfig(configPath);
  return normalizeConfigInternal(rawConfig, env);
}

function loadRawConfigFromFile(filePath: string): RawConfig {
  const content = readFileSync(filePath, "utf-8");
  const configDir = dirname(filePath);

  let rawConfig: RawConfig;
  try {
    rawConfig = parse(content) as RawConfig;
  } catch (error) {
    const message = toErrorMessage(error);
    throw new ValidationError(
      `Failed to parse YAML config at ${filePath}: ${message}`
    );
  }

  // Resolve file references before validation so content type checking works
  rawConfig = resolveFileReferencesInConfig(rawConfig, { configDir });

  validateRawConfig(rawConfig);

  return rawConfig;
}

function loadRawConfigFromDirectory(dirPath: string): RawConfig {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const yamlFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        [".yaml", ".yml"].includes(extname(entry.name).toLowerCase())
    )
    .map((entry) => entry.name)
    .sort();

  if (yamlFiles.length === 0) {
    throw new ValidationError(
      `No .yaml or .yml files found in directory: ${dirPath}`
    );
  }

  const fragments: ConfigFragment[] = yamlFiles.map((fileName) => {
    const filePath = join(dirPath, fileName);
    const content = readFileSync(filePath, "utf-8");
    const configDir = dirname(filePath);

    let config: Partial<RawConfig>;
    try {
      config = parse(content) as Partial<RawConfig>;
    } catch (error) {
      const message = toErrorMessage(error);
      throw new ValidationError(
        `Failed to parse YAML config at ${filePath}: ${message}`
      );
    }

    config = resolveFileReferencesInConfig(config as RawConfig, {
      configDir,
    });

    return { fileName, config };
  });

  const merged = mergeConfigFragments(fragments);

  validateRawConfig(merged);

  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/unit/config.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `npm test`
Expected: PASS — all existing single-file tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/config/loader.ts src/config/index.ts
git commit -m "feat(config): add directory-based config loading (#671)"
```

---

### Task 5: Update `RawConfig` type and validator for optional `id`/`repos`

**Files:**
- Modify: `src/config/types.ts`
- Modify: `src/config/validator.ts`

Note: The `RawConfig` type currently has `id: string` and `repos: RawRepoConfig[]` as required.
For fragments, these may be absent. However, `loadRawConfigFromDirectory` only calls
`validateRawConfig` on the **merged** result (which always has both), and
`loadRawConfigFromFile` always loads a complete config. So the type and validator can
remain strict — fragment configs use `Partial<RawConfig>` (already done in the
`ConfigFragment` interface). **This task may be a no-op** if the current approach works.
Verify by running tests:

- [ ] **Step 1: Run all tests to verify current approach works without type changes**

Run: `npm test && npx tsx --test test/unit/config-merger.test.ts`
Expected: PASS — `ConfigFragment` uses `Partial<RawConfig>`, merged result satisfies `RawConfig`

- [ ] **Step 2: If tests pass, skip type changes and commit a note**

If all tests pass, the type change is unnecessary — `Partial<RawConfig>` on fragments plus full `RawConfig` on merged output handles the optionality cleanly without weakening the core type. Move on to Task 6.

If tests fail due to type issues, make `id` and `repos` optional:

```typescript
// src/config/types.ts line 476-487
export interface RawConfig {
  id?: string;
  files?: Record<string, RawFileConfig>;
  groups?: Record<string, RawGroupConfig>;
  conditionalGroups?: RawConditionalGroupConfig[];
  repos?: RawRepoConfig[];
  prOptions?: PRMergeOptions;
  prTemplate?: string;
  githubHosts?: string[];
  deleteOrphaned?: boolean;
  settings?: RawRootSettings;
}
```

And update validator `validateRawConfig` accordingly. Only do this if needed.

---

### Task 6: Update `sync-command.ts` to accept directory paths

**Files:**
- Modify: `src/cli/sync-command.ts`

- [ ] **Step 1: Read current sync-command.ts existence check**

The current code at lines 620-624:
```typescript
const configPath = resolve(options.config);
if (!existsSync(configPath)) {
  throw new ValidationError(`Config file not found: ${configPath}`);
}
```

- [ ] **Step 2: Update the existence check and log message**

Change `src/cli/sync-command.ts` lines 620-626:

Old:
```typescript
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    throw new ValidationError(`Config file not found: ${configPath}`);
  }

  getLogger().log(`Loading config from: ${configPath}`);
```

New:
```typescript
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    throw new ValidationError(`Config path not found: ${configPath}`);
  }

  const stat = statSync(configPath);
  const isDirectory = stat.isDirectory();
  getLogger().log(
    `Loading config from ${isDirectory ? "directory" : "file"}: ${configPath}`
  );
```

Add `statSync` to the existing `node:fs` import at line 2:
```typescript
import { existsSync, statSync } from "node:fs";
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/sync-command.ts
git commit -m "feat(cli): update sync command to accept directory config path (#671)"
```

---

### Task 7: Update JSON schema

**Files:**
- Modify: `config-schema.json`

- [ ] **Step 1: Remove `id` and `repos` from required array**

Change `config-schema.json` lines 7-10:

Old:
```json
  "required": [
    "id",
    "repos"
  ],
```

New:
```json
  "required": [],
```

Note: The `anyOf` constraint (lines 11-32) remains — when used as a standalone file, the schema is more permissive, but `validateRawConfig()` in code enforces the actual constraints (id required, repos required). The schema is informational for editor autocompletion; code validation is authoritative.

- [ ] **Step 2: Remove `minItems: 1` from repos**

Change `config-schema.json` lines 63-70 — remove `minItems`:

Old:
```json
    "repos": {
      "type": "array",
      "description": "List of repository configurations",
      "minItems": 1,
      "items": {
        "$ref": "#/definitions/repo"
      }
    },
```

New:
```json
    "repos": {
      "type": "array",
      "description": "List of repository configurations. When using directory-based config, repos can be split across multiple files.",
      "items": {
        "$ref": "#/definitions/repo"
      }
    },
```

- [ ] **Step 3: Also relax the `anyOf` constraint**

The `anyOf` currently requires at least one of `files`, `settings`, `groups`, `conditionalGroups`. A fragment file with only `repos` is valid. Remove the `anyOf` entirely — code validation handles this:

Old (lines 11-32):
```json
  "anyOf": [
    {
      "required": [
        "files"
      ]
    },
    ...
  ],
```

Remove the entire `anyOf` block.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add config-schema.json
git commit -m "feat(schema): relax required fields for multi-file config fragments (#671)"
```

---

### Task 8: Add `@path` file reference resolution test for directory mode

**Files:**
- Modify: `test/unit/config.test.ts`

- [ ] **Step 1: Write test for file references resolving relative to each fragment**

Add to the `"directory loading"` describe block in `test/unit/config.test.ts`:

```typescript
    test("resolves @path file references relative to each fragment file", () => {
      const configDir = join(testDir, "config-refs-" + Date.now());
      const templatesDir = join(configDir, "templates");
      mkdirSync(templatesDir, { recursive: true });

      writeFileSync(
        join(templatesDir, "base-content.json"),
        JSON.stringify({ fromTemplate: true }),
        "utf-8"
      );

      writeFileSync(
        join(configDir, "base.yaml"),
        `
id: test-refs
files:
  base.json:
    content: "@templates/base-content.json"
repos:
  - git: git@github.com:org/repo-a.git
`,
        "utf-8"
      );

      const config = loadConfig(configDir, {});
      const baseFile = config.repos[0].files.find(
        (f) => f.fileName === "base.json"
      );
      assert.ok(baseFile);
      assert.deepEqual(baseFile.content, { fromTemplate: true });
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx tsx --test test/unit/config.test.ts`
Expected: PASS — file references already resolve per-fragment because each fragment goes through `resolveFileReferencesInConfig` with its own `configDir`

- [ ] **Step 3: Commit**

```bash
git add test/unit/config.test.ts
git commit -m "test(config): add file reference resolution test for directory mode (#671)"
```

---

### Task 9: Update documentation

**Files:**
- Modify: `docs/configuration.md` (or equivalent docs page — check for the right file)
- Modify: `README.md`

- [ ] **Step 1: Find the correct docs file**

Run: `ls docs/` to find the configuration documentation file.

- [ ] **Step 2: Add multi-file config section to docs**

Add a new section to the configuration docs:

```markdown
## Multi-File Configuration

For large configurations, you can split your config across multiple files in a directory. Pass the directory path to `-c` instead of a file:

```bash
xfg sync -c ./xfg-config
xfg sync -c ./xfg-config/   # trailing slash is optional
```

### Directory Structure

All `.yaml` and `.yml` files in the directory are loaded and merged. Files are processed in alphabetical order.

```text
xfg-config/
  base.yaml          # id, files, settings, prOptions (shared config)
  team-alpha.yaml     # team-specific groups and repos
  team-beta.yaml      # team-specific groups and repos
```

### Merge Rules

| Key | Behavior |
| --- | --- |
| `groups` | Merged by name — group names must be unique across files |
| `conditionalGroups` | Concatenated in alphabetical file order |
| `repos` | Concatenated in alphabetical file order |
| All other keys | Must appear in exactly one file |

### Example

```yaml
# base.yaml
id: my-org-config
files:
  .editorconfig:
    content: |
      root = true

groups:
  shared-ci:
    files:
      .github/workflows/ci.yml:
        content: { ... }

prOptions:
  merge: auto
  mergeStrategy: squash
```

```yaml
# team-alpha.yaml
groups:
  alpha-standard:
    extends: shared-ci
    files:
      .github/CODEOWNERS:
        content: "* @org/alpha"

repos:
  - git: git@github.com:org/alpha-api.git
    groups: [alpha-standard]
```

### Constraints

- Exactly one file must define `id`
- `files`, `settings`, `prOptions`, `prTemplate`, `githubHosts`, and `deleteOrphaned` can each only appear in one file
- Group names must be unique across files — use `extends` for group composition
- Only flat directory scanning (no subdirectories)
- `@path` file references resolve relative to the file that contains them
```text

- [ ] **Step 3: Add brief mention to README.md**

In the configuration section of README.md, add:

```markdown
Pass a directory to `-c` to split config across multiple files — see [Multi-File Configuration](https://anthony-spruyt.github.io/xfg/configuration/#multi-file-configuration).
```

- [ ] **Step 4: Commit**

```bash
git add docs/ README.md
git commit -m "docs: add multi-file configuration documentation (#671)"
```

---

### Task 10: Create enhancement issue for recursive directory scanning

- [ ] **Step 1: Create the GitHub issue**

```bash
gh issue create \
  --repo anthony-spruyt/xfg \
  --title "feat: support recursive subdirectory scanning for multi-file config" \
  --body "## Context

Follow-up to #671 (directory-based multi-file config).

Currently, directory mode only scans flat \`.yaml\`/\`.yml\` files in the specified directory. This enhancement would add recursive scanning into subdirectories, enabling organizational structures like:

\`\`\`
xfg-config/
  base.yaml
  teams/
    alpha.yaml
    beta.yaml
  infra/
    shared.yaml
\`\`\`

## Considerations

- Scan depth: unlimited vs one-level-deep
- File ordering: alphabetical within each level, depth-first vs breadth-first
- Potential for confusion about which files are included

## Depends on

- #671"
```

- [ ] **Step 2: Note the issue number in a comment**

Record the created issue number for reference.

- [ ] **Step 3: Commit (no code changes — issue only)**

No commit needed for this task.

---

### Task 11: Run pre-PR checklist

- [ ] **Step 1: Run unit tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Run test typecheck**

Run: `npm run test:typecheck`
Expected: PASS

- [ ] **Step 3: Run linting**

Run: `./lint.sh`
Expected: PASS

Note: If running from a worktree and lint.sh fails due to Docker issues, run from the main repo directory instead.

- [ ] **Step 4: Fix any issues found, re-run checks**

If any check fails, fix the issue and re-run all three checks.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address lint/type issues (#671)"
```
