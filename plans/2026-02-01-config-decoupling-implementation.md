# Config Decoupling & Documentation Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Decouple `files` and `settings` validation so configs can contain either or both, and align all documentation to "repository-as-code" messaging.

**Architecture:** Split `validateRawConfig()` into layered validators (base, files, settings) with command-specific validation in `runSync()` and `runSettings()`. Update all docs to consistent messaging.

**Tech Stack:** TypeScript, Node.js test runner, YAML configs

---

## Task 1: Make `files` Optional in Type Definition

**Files:**

- Modify: `src/config.ts:391-400`
- Test: `src/config-validator.test.ts`

**Step 1: Write the failing test**

Add to `src/config-validator.test.ts` in a new describe block after line 2060:

```typescript
describe("files/settings decoupling", () => {
  test("accepts config with only settings (no files)", () => {
    const config: RawConfig = {
      id: "settings-only",
      settings: {
        rulesets: {
          "main-protection": {
            target: "branch",
            enforcement: "active",
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "accepts config with only settings"`
Expected: FAIL with "Config missing required field: files"

**Step 3: Update type definition**

In `src/config.ts`, change line 393 from:

```typescript
files: Record<string, RawFileConfig>;
```

to:

```typescript
  files?: Record<string, RawFileConfig>;
```

**Step 4: Run test to verify it still fails**

Run: `npm test -- --test-name-pattern "accepts config with only settings"`
Expected: Still FAIL (validation logic not updated yet)

**Step 5: Commit type change only**

```bash
git add src/config.ts
git commit -m "$(cat <<'EOF'
refactor: make files optional in RawConfig type

Preparation for allowing settings-only configs.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Refactor Validation - Extract Base Config Validator

**Files:**

- Modify: `src/config-validator.ts:44-70`
- Test: `src/config-validator.test.ts`

**Step 1: Write failing tests for base validation**

Add to `src/config-validator.test.ts` in the "files/settings decoupling" describe block:

```typescript
test("throws when config has neither files nor settings", () => {
  const config = {
    id: "empty-config",
    repos: [{ git: "git@github.com:org/repo.git" }],
  } as RawConfig;

  assert.throws(
    () => validateRawConfig(config),
    /Config requires at least one of: 'files' or 'settings'/
  );
});

test("accepts config with only files (no settings)", () => {
  const config: RawConfig = {
    id: "files-only",
    files: {
      "config.json": { content: { key: "value" } },
    },
    repos: [{ git: "git@github.com:org/repo.git" }],
  };
  assert.doesNotThrow(() => validateRawConfig(config));
});

test("accepts config with both files and settings", () => {
  const config: RawConfig = {
    id: "full-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    settings: {
      rulesets: {
        "main-protection": {
          target: "branch",
          enforcement: "active",
        },
      },
    },
    repos: [{ git: "git@github.com:org/repo.git" }],
  };
  assert.doesNotThrow(() => validateRawConfig(config));
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "files/settings decoupling"`
Expected: FAIL - "neither files nor settings" test fails with wrong error, "only settings" fails

**Step 3: Refactor validateRawConfig**

In `src/config-validator.ts`, replace lines 64-70:

```typescript
// OLD:
if (!config.files || typeof config.files !== "object") {
  throw new Error("Config missing required field: files (must be an object)");
}

const fileNames = Object.keys(config.files);
if (fileNames.length === 0) {
  throw new Error("Config files object cannot be empty");
}
```

With:

```typescript
// NEW: Validate at least one of files or settings exists
const hasFiles =
  config.files &&
  typeof config.files === "object" &&
  Object.keys(config.files).length > 0;
const hasSettings = config.settings && typeof config.settings === "object";

if (!hasFiles && !hasSettings) {
  throw new Error(
    "Config requires at least one of: 'files' or 'settings'. " +
      "Use 'files' to sync configuration files, or 'settings' to manage repository settings."
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "files/settings decoupling"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-validator.ts src/config-validator.test.ts
git commit -m "$(cat <<'EOF'
refactor: allow files or settings (at least one required)

- Config no longer requires files to be present
- Config must have either files or settings (or both)
- Error message suggests alternatives when neither is present

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Conditionally Validate Files Section

**Files:**

- Modify: `src/config-validator.ts:74-179`
- Test: `src/config-validator.test.ts`

**Step 1: Write failing test for files validation when files present**

Add to "files/settings decoupling" describe block:

```typescript
test("validates files structure when files is present", () => {
  const config: RawConfig = {
    id: "bad-files",
    files: {
      "../escape.json": { content: {} }, // Invalid path
    },
    repos: [{ git: "git@github.com:org/repo.git" }],
  };

  assert.throws(
    () => validateRawConfig(config),
    /Invalid fileName.*must be a relative path/
  );
});

test("skips files validation when files is absent", () => {
  const config: RawConfig = {
    id: "settings-only",
    settings: {
      rulesets: {
        "main-protection": { target: "branch" },
      },
    },
    repos: [{ git: "git@github.com:org/repo.git" }],
  };
  // Should not throw about files
  assert.doesNotThrow(() => validateRawConfig(config));
});
```

**Step 2: Run tests**

Run: `npm test -- --test-name-pattern "files/settings decoupling"`
Expected: Should pass (the logic already conditionally validates)

**Step 3: Wrap files validation in conditional**

In `src/config-validator.ts`, after the "at least one" check, wrap the files validation loop:

```typescript
// Validate files if present
if (hasFiles) {
  const fileNames = Object.keys(config.files!);

  // Validate each file definition
  for (const fileName of fileNames) {
    validateFileName(fileName);
    // ... rest of existing file validation
  }
}
```

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass, coverage >= 95%

**Step 5: Commit**

```bash
git add src/config-validator.ts src/config-validator.test.ts
git commit -m "$(cat <<'EOF'
refactor: conditionally validate files section

Files validation only runs when files section is present.
Settings-only configs skip files validation entirely.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add Command-Specific Validation Functions

**Files:**

- Modify: `src/config-validator.ts` (add new exports)
- Test: `src/config-validator.test.ts`

**Step 1: Write failing tests for validateForSync**

Add new describe block in `src/config-validator.test.ts`:

```typescript
describe("validateForSync", () => {
  test("throws when files is missing", () => {
    const config: RawConfig = {
      id: "settings-only",
      settings: {
        rulesets: {
          "main-protection": { target: "branch" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSync(config),
      /The 'sync' command requires a 'files' section/
    );
  });

  test("throws when files is empty", () => {
    const config: RawConfig = {
      id: "empty-files",
      files: {},
      settings: {
        rulesets: {
          "main-protection": { target: "branch" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSync(config),
      /The 'sync' command requires a 'files' section with at least one file/
    );
  });

  test("passes when files has entries", () => {
    const config: RawConfig = {
      id: "has-files",
      files: {
        "config.json": { content: {} },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.doesNotThrow(() => validateForSync(config));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "validateForSync"`
Expected: FAIL - validateForSync is not defined

**Step 3: Implement validateForSync**

Add to `src/config-validator.ts` at the end of the file:

```typescript
/**
 * Validates that config is suitable for the sync command.
 * @throws Error if files section is missing or empty
 */
export function validateForSync(config: RawConfig): void {
  if (!config.files) {
    throw new Error(
      "The 'sync' command requires a 'files' section with at least one file defined. " +
        "To manage repository settings instead, use 'xfg settings'."
    );
  }

  const fileNames = Object.keys(config.files);
  if (fileNames.length === 0) {
    throw new Error(
      "The 'sync' command requires a 'files' section with at least one file defined. " +
        "To manage repository settings instead, use 'xfg settings'."
    );
  }
}
```

**Step 4: Update test imports**

At top of `src/config-validator.test.ts`, update import:

```typescript
import { validateRawConfig, validateForSync } from "./config-validator.js";
```

**Step 5: Run tests**

Run: `npm test -- --test-name-pattern "validateForSync"`
Expected: PASS

**Step 6: Commit**

```bash
git add src/config-validator.ts src/config-validator.test.ts
git commit -m "$(cat <<'EOF'
feat: add validateForSync command-specific validator

Validates that files section exists and is non-empty.
Error message suggests using 'xfg settings' as alternative.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add validateForSettings Function

**Files:**

- Modify: `src/config-validator.ts`
- Test: `src/config-validator.test.ts`

**Step 1: Write failing tests for validateForSettings**

Add new describe block in `src/config-validator.test.ts`:

```typescript
describe("validateForSettings", () => {
  test("throws when no settings anywhere", () => {
    const config: RawConfig = {
      id: "files-only",
      files: {
        "config.json": { content: {} },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSettings(config),
      /The 'settings' command requires a 'settings' section/
    );
  });

  test("passes when settings at root level", () => {
    const config: RawConfig = {
      id: "root-settings",
      files: {
        "config.json": { content: {} },
      },
      settings: {
        rulesets: {
          "main-protection": { target: "branch" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.doesNotThrow(() => validateForSettings(config));
  });

  test("passes when settings only in repo", () => {
    const config: RawConfig = {
      id: "repo-settings",
      files: {
        "config.json": { content: {} },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          settings: {
            rulesets: {
              "main-protection": { target: "branch" },
            },
          },
        },
      ],
    };

    assert.doesNotThrow(() => validateForSettings(config));
  });

  test("throws when settings exists but has no actionable config", () => {
    const config: RawConfig = {
      id: "empty-settings",
      settings: {},
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSettings(config),
      /No actionable settings configured/
    );
  });

  test("throws when settings has empty rulesets", () => {
    const config: RawConfig = {
      id: "empty-rulesets",
      settings: {
        rulesets: {},
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSettings(config),
      /No actionable settings configured/
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "validateForSettings"`
Expected: FAIL - validateForSettings is not defined

**Step 3: Implement validateForSettings and hasActionableSettings**

Add to `src/config-validator.ts`:

```typescript
import type { RawConfig, RawRepoSettings } from "./config.js";

/**
 * Checks if settings contain actionable configuration.
 * Currently only rulesets, but extensible for future settings features.
 */
export function hasActionableSettings(
  settings: RawRepoSettings | undefined
): boolean {
  if (!settings) return false;

  // Check for rulesets
  if (settings.rulesets && Object.keys(settings.rulesets).length > 0) {
    return true;
  }

  // Future: check for repoConfig, creation, etc.
  // if (settings.repoConfig) return true;

  return false;
}

/**
 * Validates that config is suitable for the settings command.
 * @throws Error if no settings are defined or no actionable settings exist
 */
export function validateForSettings(config: RawConfig): void {
  // Check if settings exist at root or in any repo
  const hasRootSettings = config.settings !== undefined;
  const hasRepoSettings = config.repos.some(
    (repo) => repo.settings !== undefined
  );

  if (!hasRootSettings && !hasRepoSettings) {
    throw new Error(
      "The 'settings' command requires a 'settings' section at root level or " +
        "in at least one repo. To sync files instead, use 'xfg sync'."
    );
  }

  // Check if there's at least one actionable setting
  const rootActionable = hasActionableSettings(config.settings);
  const repoActionable = config.repos.some((repo) =>
    hasActionableSettings(repo.settings)
  );

  if (!rootActionable && !repoActionable) {
    throw new Error(
      "No actionable settings configured. Currently supported: rulesets. " +
        "To sync files instead, use 'xfg sync'. " +
        "See docs: https://anthony-spruyt.github.io/xfg/settings"
    );
  }
}
```

**Step 4: Update test imports**

```typescript
import {
  validateRawConfig,
  validateForSync,
  validateForSettings,
  hasActionableSettings,
} from "./config-validator.js";
```

**Step 5: Run tests**

Run: `npm test -- --test-name-pattern "validateForSettings"`
Expected: PASS

**Step 6: Commit**

```bash
git add src/config-validator.ts src/config-validator.test.ts
git commit -m "$(cat <<'EOF'
feat: add validateForSettings command-specific validator

- Validates settings exist at root or in repos
- Checks for actionable config (currently: rulesets)
- Error messages suggest 'xfg sync' as alternative
- hasActionableSettings is extensible for future settings features

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add hasActionableSettings Tests

**Files:**

- Test: `src/config-validator.test.ts`

**Step 1: Write tests for hasActionableSettings**

Add describe block:

```typescript
describe("hasActionableSettings", () => {
  test("returns false for undefined", () => {
    assert.equal(hasActionableSettings(undefined), false);
  });

  test("returns false for empty object", () => {
    assert.equal(hasActionableSettings({}), false);
  });

  test("returns false for empty rulesets", () => {
    assert.equal(hasActionableSettings({ rulesets: {} }), false);
  });

  test("returns true when rulesets has entries", () => {
    assert.equal(
      hasActionableSettings({
        rulesets: {
          "main-protection": { target: "branch" },
        },
      }),
      true
    );
  });

  test("returns false for deleteOrphaned only", () => {
    assert.equal(hasActionableSettings({ deleteOrphaned: true }), false);
  });
});
```

**Step 2: Run tests**

Run: `npm test -- --test-name-pattern "hasActionableSettings"`
Expected: PASS

**Step 3: Commit**

```bash
git add src/config-validator.test.ts
git commit -m "$(cat <<'EOF'
test: add hasActionableSettings unit tests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Integrate validateForSync into runSync

**Files:**

- Modify: `src/index.ts:168-185`
- Test: `src/index.test.ts`

**Step 1: Write failing test**

Add to `src/index.test.ts` in the "argument parsing" describe block:

```typescript
test("sync command fails with settings-only config", () => {
  writeFileSync(
    testConfigPath,
    `
id: settings-only
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
repos:
  - git: git@github.com:test/repo.git
`
  );

  const result = runCLI(["sync", "-c", testConfigPath, "--dry-run"]);
  assert.equal(result.success, false);
  const output = result.stdout + result.stderr;
  assert.ok(
    output.includes("'sync' command requires a 'files' section") ||
      output.includes("requires a 'files' section"),
    `Expected files requirement error, got: ${output}`
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "sync command fails with settings-only"`
Expected: FAIL - currently throws "Config requires at least one of: 'files' or 'settings'"

**Step 3: Add validateForSync call to runSync**

In `src/index.ts`, add import at top:

```typescript
import { validateForSync } from "./config-validator.js";
```

In `runSync()` function, after `loadConfig()` call (around line 184), add:

```typescript
const config = loadConfig(configPath);

// Validate config is suitable for sync command
try {
  validateForSync(config);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

**Step 4: Run test**

Run: `npm test -- --test-name-pattern "sync command fails with settings-only"`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All pass

**Step 6: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "$(cat <<'EOF'
feat: validate files requirement in sync command

Sync command now validates that config has a non-empty files section.
Helpful error message suggests using 'xfg settings' as alternative.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Integrate validateForSettings into runSettings

**Files:**

- Modify: `src/index.ts:288-320`
- Test: `src/index.test.ts`

**Step 1: Write failing test**

Add to `src/index.test.ts`:

```typescript
test("settings command fails with files-only config", () => {
  writeFileSync(
    testConfigPath,
    `
id: files-only
files:
  config.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
  );

  const result = runCLI(["settings", "-c", testConfigPath, "--dry-run"]);
  assert.equal(result.success, false);
  const output = result.stdout + result.stderr;
  assert.ok(
    output.includes("'settings' command requires") ||
      output.includes("No rulesets configured"),
    `Expected settings requirement error, got: ${output}`
  );
});

test("settings command succeeds with settings-only config", () => {
  writeFileSync(
    testConfigPath,
    `
id: settings-only
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include: ["refs/heads/main"]
          exclude: []
repos:
  - git: git@github.com:test/invalid-repo.git
`
  );

  // Will fail on API call but should get past validation
  const result = runCLI([
    "settings",
    "-c",
    testConfigPath,
    "--dry-run",
    "-w",
    `${testDir}/work`,
  ]);
  const output = result.stdout + result.stderr;
  // Should show it's processing, not validation error
  assert.ok(
    output.includes("Loading config") ||
      output.includes("repositories with rulesets"),
    `Expected processing output, got: ${output}`
  );
});
```

**Step 2: Run tests**

Run: `npm test -- --test-name-pattern "settings command"`
Expected: "fails with files-only" may already pass (existing check), "succeeds" may fail

**Step 3: Add validateForSettings call to runSettings**

In `src/index.ts`, update import:

```typescript
import { validateForSync, validateForSettings } from "./config-validator.js";
```

In `runSettings()` function, after `loadConfig()` call, add:

```typescript
const config = loadConfig(configPath);

// Validate config is suitable for settings command
try {
  validateForSettings(config);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

**Step 4: Run tests**

Run: `npm test -- --test-name-pattern "settings command"`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All pass, coverage >= 95%

**Step 6: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "$(cat <<'EOF'
feat: validate settings requirement in settings command

Settings command now validates that config has actionable settings.
Helpful error message suggests using 'xfg sync' as alternative.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Update Existing Tests for New Behavior

**Files:**

- Modify: `src/config-validator.test.ts:117-137`

**Step 1: Update "files is missing" test**

The test at line 118 expects "Config missing required field: files" but now it should expect the new error. Update:

```typescript
test("throws when files is missing and no settings", () => {
  const config = {
    id: "test-config",
    repos: [{ git: "git@github.com:org/repo.git" }],
  } as RawConfig;

  assert.throws(
    () => validateRawConfig(config),
    /Config requires at least one of: 'files' or 'settings'/
  );
});

test("throws when files is empty and no settings", () => {
  const config = {
    id: "test-config",
    files: {},
    repos: [{ git: "git@github.com:org/repo.git" }],
  } as RawConfig;

  assert.throws(
    () => validateRawConfig(config),
    /Config requires at least one of: 'files' or 'settings'/
  );
});
```

**Step 2: Run tests**

Run: `npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/config-validator.test.ts
git commit -m "$(cat <<'EOF'
test: update existing tests for new validation behavior

- "files is missing" now expects "at least one of files or settings"
- "files is empty" now expects same error
- Tests reflect that files is optional when settings present

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Update docs/index.md

**Files:**

- Modify: `docs/index.md:1-10`

**Step 1: Read current content**

Run: `head -10 docs/index.md`

**Step 2: Update tagline**

Change line 3 from:

```markdown
A CLI tool for managing repositories as code. Sync configuration files and manage GitHub Rulesets across multiple GitHub, Azure DevOps, and GitLab repositories.
```

to:

```markdown
A CLI tool for repository-as-code. Sync files and manage settings across GitHub, Azure DevOps, and GitLab.
```

**Step 3: Verify docs build (if applicable)**

Run: `npm run docs:build` (if exists) or manual review

**Step 4: Commit**

```bash
git add docs/index.md
git commit -m "$(cat <<'EOF'
docs: update tagline to repository-as-code messaging

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update README.md

**Files:**

- Modify: `README.md:1-80`

**Step 1: Update tagline**

Change line 11 from:

```markdown
A CLI tool that syncs JSON, JSON5, YAML, or text configuration files across multiple GitHub, Azure DevOps, and GitLab repositories. By default, changes are made via pull requests, but you can also push directly to the default branch.
```

to:

```markdown
A CLI tool for repository-as-code. Sync files and manage settings across GitHub, Azure DevOps, and GitLab.
```

**Step 2: Update example config to include settings**

Replace the example config section (lines 54-70) with:

```yaml
# sync-config.yaml
id: my-org-config
files:
  .prettierrc.json:
    content:
      semi: false
      singleQuote: true
      tabWidth: 2

settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include: ["refs/heads/main"]
          exclude: []
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1

repos:
  - git:
      - git@github.com:your-org/frontend-app.git
      - git@github.com:your-org/backend-api.git
```

**Step 3: Update Quick Start CLI section to show both commands**

After the example config, update to show:

```bash
# Sync files across repos
xfg sync --config ./sync-config.yaml

# Apply repository settings
xfg settings --config ./sync-config.yaml
```

**Step 4: Update result text**

```markdown
**Result:** PRs are created with `.prettierrc.json` files, and repos get branch protection rules.
```

**Step 5: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: align README with repository-as-code messaging

- Updated tagline
- Added settings to example config
- Show both sync and settings commands
- Updated result description

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md:1-10`

**Step 1: Update Overview**

Change line 5 from:

```markdown
TypeScript CLI tool that syncs JSON, JSON5, YAML, or text config files across multiple Git repositories via PRs (or direct push with `merge: direct`). Supports GitHub, Azure DevOps, and GitLab (including self-hosted).
```

to:

```markdown
TypeScript CLI tool for repository-as-code: sync files and manage settings across GitHub, Azure DevOps, and GitLab (including self-hosted). Changes via PRs by default, or direct push with `merge: direct`.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: align CLAUDE.md with repository-as-code messaging

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Update package.json Description

**Files:**

- Modify: `package.json`

**Step 1: Update description field**

Change:

```json
"description": "CLI tool to sync JSON, JSON5, YAML, or text configuration files across multiple Git repositories via pull requests or direct push",
```

to:

```json
"description": "CLI tool for repository-as-code",
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
docs: update package.json description

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Update CLI Help Text

**Files:**

- Modify: `src/index.ts:458-463`

**Step 1: Update program description**

Change line 461:

```typescript
.description(
  "Sync configuration files and manage GitHub Rulesets across repositories"
)
```

to:

```typescript
.description(
  "Sync files and manage settings across repositories"
)
```

**Step 2: Run help to verify**

Run: `node --import tsx src/cli.ts --help`
Expected: Shows "Sync files and manage settings across repositories"

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "$(cat <<'EOF'
docs: update CLI help text

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Check coverage**

Run: `npm test -- --experimental-test-coverage`
Expected: >= 95% coverage

**Step 3: Run linter**

Run: `./lint.sh`
Expected: No errors

**Step 4: Build**

Run: `npm run build`
Expected: Compiles without errors

**Step 5: Manual verification**

Create test configs and run:

```bash
# Settings-only config
cat > /tmp/settings-only.yaml << 'EOF'
id: test-settings
settings:
  rulesets:
    test:
      target: branch
repos:
  - git: git@github.com:test/repo.git
EOF

# Should fail with helpful message about files
node --import tsx src/cli.ts sync -c /tmp/settings-only.yaml --dry-run

# Files-only config
cat > /tmp/files-only.yaml << 'EOF'
id: test-files
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
EOF

# Should fail with helpful message about settings
node --import tsx src/cli.ts settings -c /tmp/files-only.yaml --dry-run
```

**Step 6: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: final cleanup for config decoupling

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Description                   | Files                    |
| ---- | ----------------------------- | ------------------------ |
| 1    | Make files optional in type   | config.ts                |
| 2    | Extract base config validator | config-validator.ts      |
| 3    | Conditionally validate files  | config-validator.ts      |
| 4    | Add validateForSync           | config-validator.ts      |
| 5    | Add validateForSettings       | config-validator.ts      |
| 6    | Test hasActionableSettings    | config-validator.test.ts |
| 7    | Integrate validateForSync     | index.ts                 |
| 8    | Integrate validateForSettings | index.ts                 |
| 9    | Update existing tests         | config-validator.test.ts |
| 10   | Update docs/index.md          | docs/index.md            |
| 11   | Update README.md              | README.md                |
| 12   | Update CLAUDE.md              | CLAUDE.md                |
| 13   | Update package.json           | package.json             |
| 14   | Update CLI help               | index.ts                 |
| 15   | Final verification            | -                        |
