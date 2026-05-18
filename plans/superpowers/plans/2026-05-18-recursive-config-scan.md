# Recursive Config Directory Scanning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `loadRawConfigFromDirectory` recurse into subdirectories so users can organize multi-file config fragments into nested folders.

**Architecture:** Extract a `collectYamlFiles` helper that walks the directory tree depth-first, alphabetically per level, returning `{ relativePath, absolutePath }` tuples. `loadRawConfigFromDirectory` calls it instead of the flat `readdirSync` scan, then iterates over results to build `ConfigFragment[]` using relative paths as `fileName`. No changes to `ConfigFragment`, `mergeConfigFragments`,
schema, or validator.

**Tech Stack:** Node.js `fs.readdirSync` with `withFileTypes`, `path.relative`/`path.join`

**Spec:** `plans/superpowers/specs/2026-05-18-recursive-config-scan-design.md`

______________________________________________________________________

## File Map

| File                                     | Action | Responsibility                                                                                                   |
| ---------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `src/config/loader.ts`                   | Modify | Add `collectYamlFiles` helper, refactor `loadRawConfigFromDirectory` to use it                                   |
| `test/unit/config/loader.test.ts`        | Modify | Add recursive scanning tests (ordering, depth limit, hidden files, symlinks, empty subdirs, file ref resolution) |
| `test/unit/config/config-merger.test.ts` | Modify | Add one test: path-style `fileName` in error messages                                                            |

______________________________________________________________________

### Task 1: Add `collectYamlFiles` helper with flat-dir equivalence test

Establish the helper function and verify it produces identical results to the current flat scan for a single-level directory.

**Files:**

- Modify: `test/unit/config/loader.test.ts`

- Modify: `src/config/loader.ts`

- [ ] **Step 1: Write the failing test — flat directory produces same results via recursive scan**

Add this test inside the existing `describe("directory loading", ...)` block in `test/unit/config/loader.test.ts`, after the last existing test (line 346):

```typescript
    test("flat directory: recursive scan produces same results as before", () => {
      const configDir = join(tempDir, "flat-recursive");
      mkdirSync(configDir);
      writeFileSync(
        join(configDir, "01-base.yaml"),
        `id: flat-test\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      writeFileSync(
        join(configDir, "02-repos.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-a.git\n  - git: git@github.com:owner/repo-b.git\n`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "flat-test");
      assert.equal(result.repos.length, 2);
      assert.equal(result.repos[0].git, "git@github.com:owner/repo-a.git");
      assert.equal(result.repos[1].git, "git@github.com:owner/repo-b.git");
    });
```

- [ ] **Step 2: Run test to verify it passes (baseline — flat behavior already works)**

Run: `npm test -- --test-name-pattern "flat directory: recursive scan" 2>&1 | tail -20` Expected: PASS (existing code already handles flat dirs)

- [ ] **Step 3: Implement `collectYamlFiles` and refactor `loadRawConfigFromDirectory`**

In `src/config/loader.ts`, add `relative` to the `path` import, add `symlinkSync` is not needed — add `lstatSync` is not needed. Just add `relative` to imports and the new helper. Replace the body of `loadRawConfigFromDirectory`:

```typescript
import { readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, extname, relative } from "node:path";
```

Add the constant and helper function before `loadRawConfigFromDirectory`:

```typescript
const MAX_CONFIG_DEPTH = 10;

function collectYamlFiles(
  rootDir: string,
  currentDir: string,
  depth: number
): Array<{ relativePath: string; absolutePath: string }> {
  if (depth > MAX_CONFIG_DEPTH) {
    const rel = relative(rootDir, currentDir) || ".";
    throw new ValidationError(
      `Config directory nesting exceeds maximum depth of ${MAX_CONFIG_DEPTH} at ${rel}`
    );
  }

  let entries;
  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch (error) {
    throw new ValidationError(
      `Failed to read config directory ${currentDir}: ${toErrorMessage(error)}`,
      { cause: error }
    );
  }

  const files: Array<{ relativePath: string; absolutePath: string }> = [];
  const subdirs: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const ext = extname(entry.name).toLowerCase();
    const isYaml = ext === ".yaml" || ext === ".yml";

    if (entry.isFile() && isYaml) {
      files.push({
        relativePath: relative(rootDir, join(currentDir, entry.name)),
        absolutePath: join(currentDir, entry.name),
      });
    } else if (entry.isSymbolicLink() && isYaml) {
      files.push({
        relativePath: relative(rootDir, join(currentDir, entry.name)),
        absolutePath: join(currentDir, entry.name),
      });
    } else if (entry.isDirectory()) {
      subdirs.push(entry.name);
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  subdirs.sort();

  const result = [...files];
  for (const subdir of subdirs) {
    result.push(
      ...collectYamlFiles(rootDir, join(currentDir, subdir), depth + 1)
    );
  }

  return result;
}
```

Replace the body of `loadRawConfigFromDirectory`:

```typescript
function loadRawConfigFromDirectory(dirPath: string): RawConfig {
  const yamlFiles = collectYamlFiles(dirPath, dirPath, 0);

  if (yamlFiles.length === 0) {
    throw new ValidationError(
      `No .yaml or .yml files found in directory: ${dirPath}`
    );
  }

  const fragments: ConfigFragment[] = yamlFiles.map(
    ({ relativePath, absolutePath }) => {
      let content: string;
      try {
        content = readFileSync(absolutePath, "utf-8");
      } catch (error) {
        throw new ValidationError(
          `Failed to read config file ${absolutePath}: ${toErrorMessage(error)}`,
          { cause: error }
        );
      }
      const configDir = dirname(absolutePath);

      let config: Partial<RawConfig>;
      try {
        config = parse(content) as Partial<RawConfig>;
      } catch (error) {
        const message = toErrorMessage(error);
        throw new ValidationError(
          `Failed to parse YAML config at ${absolutePath}: ${message}`,
          { cause: error }
        );
      }

      if (!config || typeof config !== "object") {
        throw new ValidationError(
          `Config file ${relativePath} is empty or invalid — expected a YAML mapping`
        );
      }

      config = resolveFileReferencesInConfig(config as RawConfig, {
        configDir,
      });

      return { fileName: relativePath, config };
    }
  );

  const merged = mergeConfigFragments(fragments);

  validateRawConfig(merged);

  return merged;
}
```

- [ ] **Step 4: Run test to verify flat-dir equivalence still passes**

Run: `npm test -- --test-name-pattern "flat directory: recursive scan" 2>&1 | tail -20` Expected: PASS

- [ ] **Step 5: Run all existing loader tests to verify no regressions**

Run: `npm test -- --test-name-pattern "loadRawConfig|loadConfig" 2>&1 | tail -30` Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/config/loader.ts test/unit/config/loader.test.ts
git commit -m "feat: add collectYamlFiles helper for recursive directory scanning"
```

______________________________________________________________________

### Task 2: Recursive discovery and depth-first alphabetical ordering

Test that nested subdirectories are scanned and files appear in the correct depth-first, alphabetical-per-level order matching the spec example.

**Files:**

- Modify: `test/unit/config/loader.test.ts`

- [ ] **Step 1: Write the failing test — recursive discovery with correct ordering**

Add inside `describe("directory loading", ...)`:

```typescript
    test("recursive: discovers nested YAML files in depth-first alphabetical order", () => {
      const configDir = join(tempDir, "recursive-order");
      mkdirSync(configDir);
      mkdirSync(join(configDir, "infra"));
      mkdirSync(join(configDir, "teams"));
      mkdirSync(join(configDir, "teams", "beta"));

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: recursive-test\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      writeFileSync(
        join(configDir, "shared.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-1.git\n`
      );
      writeFileSync(
        join(configDir, "infra", "shared.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-2.git\n`
      );
      writeFileSync(
        join(configDir, "teams", "alpha.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-3.git\n`
      );
      writeFileSync(
        join(configDir, "teams", "beta.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-4.git\n`
      );
      writeFileSync(
        join(configDir, "teams", "beta", "overrides.yaml"),
        `repos:\n  - git: git@github.com:owner/repo-5.git\n`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "recursive-test");
      assert.equal(result.repos.length, 5);
      assert.equal(result.repos[0].git, "git@github.com:owner/repo-1.git");
      assert.equal(result.repos[1].git, "git@github.com:owner/repo-2.git");
      assert.equal(result.repos[2].git, "git@github.com:owner/repo-3.git");
      assert.equal(result.repos[3].git, "git@github.com:owner/repo-4.git");
      assert.equal(result.repos[4].git, "git@github.com:owner/repo-5.git");
    });
```

- [ ] **Step 2: Run test to verify it fails (before implementation this would have passed since we implemented in Task 1 — but this validates correct ordering)**

Run: `npm test -- --test-name-pattern "recursive: discovers nested" 2>&1 | tail -20` Expected: PASS (implementation from Task 1 already handles this)

- [ ] **Step 3: Commit**

```bash
git add test/unit/config/loader.test.ts
git commit -m "test: verify recursive directory scanning with depth-first ordering"
```

______________________________________________________________________

### Task 3: Max depth exceeded error

Test that recursion deeper than 10 levels throws a `ValidationError`.

**Files:**

- Modify: `test/unit/config/loader.test.ts`

- [ ] **Step 1: Write the test — depth exceeds MAX_CONFIG_DEPTH**

Add inside `describe("directory loading", ...)`:

```typescript
    test("throws ValidationError when directory nesting exceeds maximum depth", () => {
      const configDir = join(tempDir, "deep-nest");
      mkdirSync(configDir);

      let current = configDir;
      for (let i = 0; i < 12; i++) {
        current = join(current, `level-${i}`);
        mkdirSync(current);
      }
      writeFileSync(
        join(configDir, "base.yaml"),
        `id: deep-test\nfiles:\n  .gitkeep:\n    content: ""\nrepos:\n  - git: git@github.com:owner/repo.git\n`
      );
      writeFileSync(join(current, "deep.yaml"), `repos:\n  - git: git@github.com:owner/deep.git\n`);

      assert.throws(
        () => loadRawConfig(configDir),
        (err: unknown) => {
          assert.ok(
            err instanceof ValidationError,
            `Expected ValidationError, got ${String(err)}`
          );
          assert.ok(
            err.message.includes("exceeds maximum depth of 10"),
            `Expected depth error, got: ${err.message}`
          );
          return true;
        }
      );
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "exceeds maximum depth" 2>&1 | tail -20` Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/config/loader.test.ts
git commit -m "test: verify max depth validation for recursive config scanning"
```

______________________________________________________________________

### Task 4: Hidden files and directories are skipped

Test that dotfiles and dotdirs are ignored during scanning.

**Files:**

- Modify: `test/unit/config/loader.test.ts`

- [ ] **Step 1: Write the test — hidden entries skipped**

Add inside `describe("directory loading", ...)`:

```typescript
    test("skips hidden files and directories (names starting with dot)", () => {
      const configDir = join(tempDir, "hidden-test");
      mkdirSync(configDir);
      mkdirSync(join(configDir, ".git"));
      mkdirSync(join(configDir, "visible"));

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: hidden-test\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      writeFileSync(
        join(configDir, "visible", "repos.yaml"),
        `repos:\n  - git: git@github.com:owner/visible.git\n`
      );
      writeFileSync(
        join(configDir, ".hidden.yaml"),
        `repos:\n  - git: git@github.com:owner/hidden-file.git\n`
      );
      writeFileSync(
        join(configDir, ".git", "config.yaml"),
        `repos:\n  - git: git@github.com:owner/hidden-dir.git\n`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "hidden-test");
      assert.equal(result.repos.length, 1);
      assert.equal(result.repos[0].git, "git@github.com:owner/visible.git");
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "skips hidden files" 2>&1 | tail -20` Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/config/loader.test.ts
git commit -m "test: verify hidden files and directories are skipped in recursive scan"
```

______________________________________________________________________

### Task 5: Empty subdirectories and subdirs without YAML files

Test that empty subdirs or subdirs with non-YAML files don't cause errors — they're simply skipped.

**Files:**

- Modify: `test/unit/config/loader.test.ts`

- [ ] **Step 1: Write the test — empty and non-YAML subdirs skipped**

Add inside `describe("directory loading", ...)`:

```typescript
    test("empty subdirectories and subdirs with no YAML files are skipped without error", () => {
      const configDir = join(tempDir, "empty-subdirs");
      mkdirSync(configDir);
      mkdirSync(join(configDir, "empty"));
      mkdirSync(join(configDir, "no-yaml"));

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: empty-sub-test\nfiles:\n  .gitkeep:\n    content: ""\nrepos:\n  - git: git@github.com:owner/repo.git\n`
      );
      writeFileSync(join(configDir, "no-yaml", "readme.txt"), "not yaml");

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "empty-sub-test");
      assert.equal(result.repos.length, 1);
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "empty subdirectories" 2>&1 | tail -20` Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/config/loader.test.ts
git commit -m "test: verify empty subdirectories are skipped gracefully"
```

______________________________________________________________________

### Task 6: Symlinked directories are skipped

Test that symlinked directories are not followed (avoids cycles).

**Files:**

- Modify: `test/unit/config/loader.test.ts`

- [ ] **Step 1: Write the test — symlinked directory skipped**

Add `symlinkSync` to the `fs` import at the top of the test file:

```typescript
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
```

Add inside `describe("directory loading", ...)`:

```typescript
    test("skips symlinked directories", () => {
      const configDir = join(tempDir, "symlink-dir-test");
      mkdirSync(configDir);
      const realDir = join(tempDir, "real-target");
      mkdirSync(realDir);

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: symlink-dir-test\nfiles:\n  .gitkeep:\n    content: ""\nrepos:\n  - git: git@github.com:owner/repo.git\n`
      );
      writeFileSync(
        join(realDir, "extra.yaml"),
        `repos:\n  - git: git@github.com:owner/symlinked.git\n`
      );
      symlinkSync(realDir, join(configDir, "linked-dir"));

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "symlink-dir-test");
      assert.equal(result.repos.length, 1);
      assert.equal(result.repos[0].git, "git@github.com:owner/repo.git");
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "skips symlinked directories" 2>&1 | tail -20` Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/config/loader.test.ts
git commit -m "test: verify symlinked directories are skipped"
```

______________________________________________________________________

### Task 7: Symlinked YAML files are followed

Test that symlinked `.yaml`/`.yml` files are included (since `isFile()` returns `false` for symlinks with `withFileTypes`, the `isSymbolicLink()` fallback is needed).

**Files:**

- Modify: `test/unit/config/loader.test.ts`

- [ ] **Step 1: Write the test — symlinked YAML file followed**

Add inside `describe("directory loading", ...)`:

```typescript
    test("follows symlinked YAML files via isSymbolicLink fallback", () => {
      const configDir = join(tempDir, "symlink-file-test");
      mkdirSync(configDir);

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: symlink-file-test\nfiles:\n  .gitkeep:\n    content: ""\n`
      );
      const realFile = join(tempDir, "real-repos.yaml");
      writeFileSync(
        realFile,
        `repos:\n  - git: git@github.com:owner/symlinked-file.git\n`
      );
      symlinkSync(realFile, join(configDir, "linked.yaml"));

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "symlink-file-test");
      assert.equal(result.repos.length, 1);
      assert.equal(
        result.repos[0].git,
        "git@github.com:owner/symlinked-file.git"
      );
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "follows symlinked YAML" 2>&1 | tail -20` Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/config/loader.test.ts
git commit -m "test: verify symlinked YAML files are followed"
```

______________________________________________________________________

### Task 8: File reference resolution relative to fragment directory

Test that `!file` / `@` references in nested fragments resolve relative to the fragment's own directory, not the config root.

**Files:**

- Modify: `test/unit/config/loader.test.ts`

- [ ] **Step 1: Write the test — file ref resolves relative to fragment dir**

Add inside `describe("directory loading", ...)`:

```typescript
    test("file references in nested fragments resolve relative to fragment directory", () => {
      const configDir = join(tempDir, "fileref-test");
      mkdirSync(configDir);
      mkdirSync(join(configDir, "teams"));

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: fileref-test\nrepos:\n  - git: git@github.com:owner/repo.git\n`
      );
      writeFileSync(
        join(configDir, "teams", "fragment.yaml"),
        `files:\n  config.json:\n    content: "@config-data.json"\n`
      );
      writeFileSync(
        join(configDir, "teams", "config-data.json"),
        `{"key": "value"}`
      );

      const result = loadRawConfig(configDir);

      assert.equal(result.id, "fileref-test");
      assert.ok(result.files);
      assert.deepEqual(result.files["config.json"].content, { key: "value" });
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "file references in nested" 2>&1 | tail -20` Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/config/loader.test.ts
git commit -m "test: verify file reference resolution in nested config fragments"
```

______________________________________________________________________

### Task 9: Relative path in fragment fileName for error messages

Test that merger error messages use relative paths (e.g., `teams/alpha.yaml`) when fragments from subdirectories conflict.

**Files:**

- Modify: `test/unit/config/config-merger.test.ts`

- [ ] **Step 1: Write the test — path-style fileName in error message**

Add inside `describe("mergeConfigFragments", ...)`:

```typescript
  test("error messages include path-style fileName for nested fragments", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "base.yaml",
        config: {
          id: "test",
          files: { "a.json": { content: {} } },
          repos: [],
        },
      },
      {
        fileName: "teams/alpha.yaml",
        config: {
          files: { "b.json": { content: {} } },
          repos: [],
        },
      },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) => {
        assert.ok(
          err.message.includes("base.yaml"),
          `Expected 'base.yaml' in message, got: ${err.message}`
        );
        assert.ok(
          err.message.includes("teams/alpha.yaml"),
          `Expected 'teams/alpha.yaml' in message, got: ${err.message}`
        );
        return true;
      }
    );
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "path-style fileName" 2>&1 | tail -20` Expected: PASS (merger already uses fileName as-is in error strings)

- [ ] **Step 3: Commit**

```bash
git add test/unit/config/config-merger.test.ts
git commit -m "test: verify path-style fileName in merger error messages"
```

______________________________________________________________________

### Task 10: Unreadable subdirectory fails entire load

Test that a permission-denied subdirectory throws `ValidationError` and fails the entire load (not silently skipped).

**Files:**

- Modify: `test/unit/config/loader.test.ts`

- [ ] **Step 1: Write the test — unreadable subdirectory**

Add inside `describe("directory loading", ...)`:

```typescript
    test("throws ValidationError when a subdirectory cannot be read (permission denied)", () => {
      const configDir = join(tempDir, "unreadable-subdir");
      mkdirSync(configDir);
      mkdirSync(join(configDir, "blocked"));

      writeFileSync(
        join(configDir, "base.yaml"),
        `id: unreadable-sub-test\nfiles:\n  .gitkeep:\n    content: ""\nrepos:\n  - git: git@github.com:owner/repo.git\n`
      );
      writeFileSync(
        join(configDir, "blocked", "fragment.yaml"),
        `repos:\n  - git: git@github.com:owner/blocked.git\n`
      );
      chmodSync(join(configDir, "blocked"), 0o000);

      assert.throws(
        () => loadRawConfig(configDir),
        (err: unknown) => {
          assert.ok(
            err instanceof ValidationError,
            `Expected ValidationError, got ${String(err)}`
          );
          assert.ok(
            err.message.includes("Failed to read config directory"),
            `Expected 'Failed to read config directory', got: ${err.message}`
          );
          return true;
        }
      );

      chmodSync(join(configDir, "blocked"), 0o755);
    });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "subdirectory cannot be read" 2>&1 | tail -20` Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/config/loader.test.ts
git commit -m "test: verify unreadable subdirectory fails entire config load"
```

______________________________________________________________________

### Task 11: Full test suite, build, and lint verification

Run all checks to ensure no regressions and code quality.

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -40` Expected: All tests PASS

- [ ] **Step 2: Run typecheck on test files**

Run: `npm run test:typecheck 2>&1 | tail -20` Expected: No type errors

- [ ] **Step 3: Run build**

Run: `npm run build 2>&1 | tail -20` Expected: Clean build

- [ ] **Step 4: Run lint**

Run: `./lint.sh 2>&1 | tail -40` Expected: No lint errors

- [ ] **Step 5: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "fix: lint fixes for recursive config scanning"
```
