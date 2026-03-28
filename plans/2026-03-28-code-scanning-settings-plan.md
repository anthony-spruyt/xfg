# Code Scanning Default Setup Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable managing GitHub code scanning default setup via xfg settings configuration, completing the security settings coverage.

**Architecture:** New `src/settings/code-scanning/` module with dedicated processor, strategy, diff, and formatter — mirroring the existing labels/rulesets pattern. A shared `IRepoMetadataProvider` is extracted and injected into both `RepoSettingsProcessor` and `CodeScanningProcessor` for GHAS validation. The feature is wired into the orchestrator via a new factory and settings descriptor.

**Tech Stack:** TypeScript, Node.js test runner, GitHub REST API (`/repos/{owner}/{repo}/code-scanning/default-setup`)

**Issue:** #669
**Spec:** `plans/2026-03-27-code-scanning-settings-design.md`

---

## Task 1: Config Types and Schema

**Files:**

- Modify: `src/config/types.ts:369-377` (add `CodeScanningSettings` and update `RepoSettings`, `RawRootSettings`, `RawRepoSettings`)
- Modify: `config-schema.json` (add `codeScanningSettings` definition and wire into `rootSettings` and `repoSettings`)

- [ ] **Step 1: Add `CodeScanningSettings` interface to types.ts**

In `src/config/types.ts`, add before the `RepoSettings` interface:

```typescript
export type CodeScanningState = "configured" | "not-configured";
export type CodeScanningQuerySuite = "default" | "extended";
export type CodeScanningLanguage =
  | "actions"
  | "c-cpp"
  | "csharp"
  | "go"
  | "java-kotlin"
  | "javascript-typescript"
  | "python"
  | "ruby"
  | "swift";

export interface CodeScanningSettings {
  state: CodeScanningState;
  querySuite?: CodeScanningQuerySuite;
  languages?: CodeScanningLanguage[];
}
```

- [ ] **Step 2: Add `codeScanning` to `RepoSettings`, `RawRootSettings`, and `RawRepoSettings`**

In `RepoSettings`:

```typescript
export interface RepoSettings {
  rulesets?: Record<string, Ruleset>;
  repo?: GitHubRepoSettings;
  labels?: Record<string, Label>;
  codeScanning?: CodeScanningSettings;
  deleteOrphaned?: boolean;
}
```

In `RawRootSettings`:

```typescript
export interface RawRootSettings {
  rulesets?: Record<string, Ruleset | false>;
  repo?: GitHubRepoSettings | false;
  labels?: Record<string, Label | false>;
  codeScanning?: CodeScanningSettings | false;
  deleteOrphaned?: boolean;
}
```

In `RawRepoSettings`:

```typescript
export interface RawRepoSettings {
  rulesets?: Record<string, Ruleset | false> & { inherit?: boolean };
  repo?: GitHubRepoSettings | false;
  labels?: Record<string, Label | false> & { inherit?: boolean };
  codeScanning?: CodeScanningSettings | false;
  deleteOrphaned?: boolean;
}
```

- [ ] **Step 3: Export new types from config barrel**

Ensure `CodeScanningSettings`, `CodeScanningState`, `CodeScanningQuerySuite`, and `CodeScanningLanguage` are exported from `src/config/index.ts`.

- [ ] **Step 4: Add `codeScanningSettings` definition to config-schema.json**

Add a new definition in the `definitions` section of `config-schema.json`:

```json
"codeScanningSettings": {
  "type": "object",
  "description": "GitHub code scanning default setup configuration",
  "required": ["state"],
  "properties": {
    "state": {
      "type": "string",
      "enum": ["configured", "not-configured"],
      "description": "Enable or disable code scanning default setup"
    },
    "querySuite": {
      "type": "string",
      "enum": ["default", "extended"],
      "description": "Query suite to use: 'default' for standard queries, 'extended' for additional queries"
    },
    "languages": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "actions",
          "c-cpp",
          "csharp",
          "go",
          "java-kotlin",
          "javascript-typescript",
          "python",
          "ruby",
          "swift"
        ]
      },
      "description": "Languages to analyze. If omitted, GitHub auto-detects languages in the repository."
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 5: Wire `codeScanning` into `rootSettings` and `repoSettings` in schema**

In the `rootSettings` definition's `properties`, add:

```json
"codeScanning": {
  "$ref": "#/definitions/codeScanningSettings",
  "description": "GitHub code scanning default setup configuration."
}
```

In the `repoSettings` definition's `properties`, add:

```json
"codeScanning": {
  "oneOf": [
    {
      "type": "boolean",
      "const": false,
      "description": "Set to false to opt out of inherited code scanning settings"
    },
    {
      "$ref": "#/definitions/codeScanningSettings"
    }
  ],
  "description": "GitHub code scanning default setup configuration. Set to false at per-repo level to opt out of inherited settings."
}
```

- [ ] **Step 6: Verify build compiles**

Run: `npm run build`
Expected: Compilation succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/config/types.ts config-schema.json src/config/index.ts
git commit -m "feat(config): add CodeScanningSettings type and schema definition (#669)"
```

---

## Task 2: Config Normalizer — Merge Code Scanning Settings

**Files:**

- Modify: `src/config/normalizer.ts:219-301` (add code scanning merge logic to `mergeSettings`)

- [ ] **Step 1: Write a failing test for code scanning merge**

Create `test/unit/config-normalizer-code-scanning.test.ts`:

```typescript
import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { mergeSettings } from "../../src/config/normalizer.js";

describe("mergeSettings - codeScanning", () => {
  test("inherits root codeScanning when repo has none", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured", querySuite: "default" } },
      {}
    );
    assert.deepStrictEqual(result?.codeScanning, {
      state: "configured",
      querySuite: "default",
    });
  });

  test("repo codeScanning overrides root", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured", querySuite: "default" } },
      { codeScanning: { state: "configured", querySuite: "extended" } }
    );
    assert.deepStrictEqual(result?.codeScanning, {
      state: "configured",
      querySuite: "extended",
    });
  });

  test("repo codeScanning: false opts out of root", () => {
    const result = mergeSettings(
      { codeScanning: { state: "configured" } },
      { codeScanning: false }
    );
    assert.strictEqual(result?.codeScanning, undefined);
  });

  test("repo codeScanning with no root passes through", () => {
    const result = mergeSettings(undefined, {
      codeScanning: { state: "not-configured" },
    });
    assert.deepStrictEqual(result?.codeScanning, {
      state: "not-configured",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/config-normalizer-code-scanning.test.ts`
Expected: FAIL — `codeScanning` not handled in `mergeSettings`.

- [ ] **Step 3: Add code scanning merge logic to `mergeSettings`**

In `src/config/normalizer.ts`, inside `mergeSettings()`, after the labels merge block (around line 298) and before the final `return`, add:

```typescript
  // Merge code scanning: per-repo overrides root (replace, not deep merge)
  // codeScanning: false means opt out of all root code scanning settings
  if (perRepo?.codeScanning === false) {
    // Opt-out: don't include any code scanning settings
  } else {
    const mergedCodeScanning =
      perRepo?.codeScanning ?? root?.codeScanning;
    if (mergedCodeScanning && mergedCodeScanning !== false) {
      result.codeScanning = mergedCodeScanning;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/config-normalizer-code-scanning.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/normalizer.ts test/unit/config-normalizer-code-scanning.test.ts
git commit -m "feat(config): merge code scanning settings in normalizer (#669)"
```

---

## Task 3: Config Validator — Validate Code Scanning Settings

**Files:**

- Modify: `src/config/validator.ts:211-270` (add `codeScanning` validation to `validateSettings`)

- [ ] **Step 1: Write failing tests for code scanning validation**

Create `test/unit/config-validator-code-scanning.test.ts`:

```typescript
import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { validateRawConfig } from "../../src/config/validator.js";

function makeConfig(codeScanning: unknown) {
  return {
    id: "test",
    settings: { codeScanning },
    repos: [{ git: "https://github.com/org/repo.git" }],
  };
}

describe("validateRawConfig - codeScanning", () => {
  test("accepts valid codeScanning settings", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(
        makeConfig({
          state: "configured",
          querySuite: "extended",
          languages: ["python", "javascript-typescript"],
        })
      )
    );
  });

  test("accepts minimal codeScanning (state only)", () => {
    assert.doesNotThrow(() =>
      validateRawConfig(makeConfig({ state: "configured" }))
    );
  });

  test("rejects codeScanning without state", () => {
    assert.throws(
      () => validateRawConfig(makeConfig({ querySuite: "default" })),
      /state is required/
    );
  });

  test("rejects invalid state value", () => {
    assert.throws(
      () => validateRawConfig(makeConfig({ state: "enabled" })),
      /state must be.*configured.*not-configured/
    );
  });

  test("rejects invalid querySuite value", () => {
    assert.throws(
      () =>
        validateRawConfig(
          makeConfig({ state: "configured", querySuite: "full" })
        ),
      /querySuite must be.*default.*extended/
    );
  });

  test("rejects non-array languages", () => {
    assert.throws(
      () =>
        validateRawConfig(
          makeConfig({ state: "configured", languages: "python" })
        ),
      /languages must be an array/
    );
  });

  test("rejects invalid language value", () => {
    assert.throws(
      () =>
        validateRawConfig(
          makeConfig({ state: "configured", languages: ["rust"] })
        ),
      /invalid language.*rust/i
    );
  });

  test("accepts codeScanning: false at repo level", () => {
    const config = {
      id: "test",
      settings: { codeScanning: { state: "configured" } },
      repos: [
        {
          git: "https://github.com/org/repo.git",
          settings: { codeScanning: false },
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/config-validator-code-scanning.test.ts`
Expected: FAIL — `codeScanning` not validated.

- [ ] **Step 3: Add code scanning validation to `validateSettings`**

In `src/config/validator.ts`, inside `validateSettings()`, add after the `repo` validation block:

```typescript
  if (settings.codeScanning !== undefined) {
    if (settings.codeScanning === false) {
      if (!rootCtx) {
        throw new ValidationError(
          `${context}: codeScanning: false is not valid at root level. Define codeScanning settings or remove the field.`
        );
      }
      // Per-repo level — valid opt-out
    } else {
      validateCodeScanningSettings(
        settings.codeScanning,
        `${context} codeScanning`
      );
    }
  }
```

Add the validation function (can be in the same file or a new validator file — follow the existing pattern):

```typescript
const VALID_CODE_SCANNING_STATES = ["configured", "not-configured"];
const VALID_CODE_SCANNING_QUERY_SUITES = ["default", "extended"];
const VALID_CODE_SCANNING_LANGUAGES = [
  "actions",
  "c-cpp",
  "csharp",
  "go",
  "java-kotlin",
  "javascript-typescript",
  "python",
  "ruby",
  "swift",
];

function validateCodeScanningSettings(
  settings: unknown,
  context: string
): void {
  if (!isPlainObject(settings)) {
    throw new ValidationError(`${context}: must be an object`);
  }

  if (settings.state === undefined) {
    throw new ValidationError(`${context}: state is required`);
  }

  if (!VALID_CODE_SCANNING_STATES.includes(settings.state as string)) {
    throw new ValidationError(
      `${context}: state must be one of: ${VALID_CODE_SCANNING_STATES.join(", ")}`
    );
  }

  if (
    settings.querySuite !== undefined &&
    !VALID_CODE_SCANNING_QUERY_SUITES.includes(settings.querySuite as string)
  ) {
    throw new ValidationError(
      `${context}: querySuite must be one of: ${VALID_CODE_SCANNING_QUERY_SUITES.join(", ")}`
    );
  }

  if (settings.languages !== undefined) {
    if (!Array.isArray(settings.languages)) {
      throw new ValidationError(`${context}: languages must be an array`);
    }
    for (const lang of settings.languages) {
      if (!VALID_CODE_SCANNING_LANGUAGES.includes(lang as string)) {
        throw new ValidationError(
          `${context}: invalid language "${lang}". Valid languages: ${VALID_CODE_SCANNING_LANGUAGES.join(", ")}`
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/config-validator-code-scanning.test.ts`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npm test`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/config/validator.ts test/unit/config-validator-code-scanning.test.ts
git commit -m "feat(config): validate codeScanning settings (#669)"
```

---

## Task 4: Code Scanning Types and Strategy

**Files:**

- Create: `src/settings/code-scanning/types.ts`
- Create: `src/settings/code-scanning/github-code-scanning-strategy.ts`
- Test: `test/unit/settings/code-scanning/github-code-scanning-strategy.test.ts`

- [ ] **Step 1: Create types.ts**

Create `src/settings/code-scanning/types.ts`:

```typescript
import type { RepoInfo } from "../../shared/repo-detector.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";

/**
 * Current code scanning default setup state from GitHub API.
 */
export interface CurrentCodeScanningSettings {
  state: "configured" | "not-configured";
  query_suite?: "default" | "extended";
  languages?: string[];
}

/**
 * Strategy interface for code scanning default setup operations.
 * Abstracts the GitHub API calls for testability.
 */
export interface ICodeScanningStrategy {
  getDefaultSetup(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<CurrentCodeScanningSettings>;

  updateDefaultSetup(
    repoInfo: RepoInfo,
    settings: { state: string; query_suite?: string; languages?: string[] },
    options?: GhApiOptions
  ): Promise<void>;
}
```

- [ ] **Step 2: Write failing test for strategy**

Create `test/unit/settings/code-scanning/github-code-scanning-strategy.test.ts`:

```typescript
import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubCodeScanningStrategy } from "../../../../src/settings/code-scanning/github-code-scanning-strategy.js";
import type { ICommandExecutor } from "../../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../../src/shared/repo-detector.js";

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "https://github.com/test-org/test-repo.git",
  host: "github.com",
  owner: "test-org",
  repo: "test-repo",
};

class MockExecutor implements ICommandExecutor {
  lastCommand = "";
  result = "";

  async exec(command: string, _cwd: string): Promise<string> {
    this.lastCommand = command;
    return this.result;
  }
}

describe("GitHubCodeScanningStrategy", () => {
  let executor: MockExecutor;
  let strategy: GitHubCodeScanningStrategy;

  beforeEach(() => {
    executor = new MockExecutor();
    strategy = new GitHubCodeScanningStrategy(executor, { cwd: "/tmp" });
  });

  test("getDefaultSetup calls correct endpoint", async () => {
    executor.result = JSON.stringify({
      state: "configured",
      query_suite: "default",
      languages: ["javascript-typescript"],
    });

    const result = await strategy.getDefaultSetup(githubRepo);

    assert.equal(result.state, "configured");
    assert.equal(result.query_suite, "default");
    assert.deepStrictEqual(result.languages, ["javascript-typescript"]);
    assert.ok(
      executor.lastCommand.includes(
        "/repos/test-org/test-repo/code-scanning/default-setup"
      )
    );
  });

  test("updateDefaultSetup calls correct endpoint with payload", async () => {
    executor.result = "";

    await strategy.updateDefaultSetup(githubRepo, {
      state: "configured",
      query_suite: "extended",
      languages: ["python"],
    });

    assert.ok(
      executor.lastCommand.includes(
        "/repos/test-org/test-repo/code-scanning/default-setup"
      )
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test test/unit/settings/code-scanning/github-code-scanning-strategy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement GitHubCodeScanningStrategy**

Create `src/settings/code-scanning/github-code-scanning-strategy.ts`:

```typescript
import type { ICommandExecutor } from "../../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../../shared/repo-detector.js";
import { GhApiClient, type GhApiOptions } from "../../shared/gh-api-utils.js";
import { parseApiJson } from "../../shared/json-utils.js";
import type {
  ICodeScanningStrategy,
  CurrentCodeScanningSettings,
} from "./types.js";

interface GitHubCodeScanningStrategyOptions {
  retries?: number;
  cwd: string;
}

export class GitHubCodeScanningStrategy implements ICodeScanningStrategy {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubCodeScanningStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async getDefaultSetup(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<CurrentCodeScanningSettings> {
    assertGitHubRepo(repoInfo, "GitHub Code Scanning strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/code-scanning/default-setup`;
    const result = await this.api.call("GET", endpoint, { options });

    return parseApiJson<CurrentCodeScanningSettings>(
      result,
      "code scanning default setup response"
    );
  }

  async updateDefaultSetup(
    repoInfo: RepoInfo,
    settings: { state: string; query_suite?: string; languages?: string[] },
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Code Scanning strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/code-scanning/default-setup`;
    await this.api.call("PATCH", endpoint, { payload: settings, options });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test test/unit/settings/code-scanning/github-code-scanning-strategy.test.ts`
Expected: PASS — both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/settings/code-scanning/types.ts src/settings/code-scanning/github-code-scanning-strategy.ts test/unit/settings/code-scanning/github-code-scanning-strategy.test.ts
git commit -m "feat(settings): add code scanning strategy interface and GitHub implementation (#669)"
```

---

## Task 5: Code Scanning Diff

**Files:**

- Create: `src/settings/code-scanning/diff.ts`
- Test: `test/unit/settings/code-scanning/code-scanning-diff.test.ts`

- [ ] **Step 1: Write failing tests for diff logic**

Create `test/unit/settings/code-scanning/code-scanning-diff.test.ts`:

```typescript
import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  diffCodeScanning,
  hasCodeScanningChanges,
} from "../../../../src/settings/code-scanning/diff.js";
import type { CurrentCodeScanningSettings } from "../../../../src/settings/code-scanning/types.js";
import type { CodeScanningSettings } from "../../../../src/config/index.js";

describe("diffCodeScanning", () => {
  test("detects state change", () => {
    const current: CurrentCodeScanningSettings = {
      state: "not-configured",
    };
    const desired: CodeScanningSettings = { state: "configured" };

    const changes = diffCodeScanning(current, desired);
    const stateChange = changes.find((c) => c.property === "state");

    assert.ok(stateChange);
    assert.equal(stateChange.action, "update");
    assert.equal(stateChange.oldValue, "not-configured");
    assert.equal(stateChange.newValue, "configured");
  });

  test("detects querySuite change", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
      query_suite: "default",
    };
    const desired: CodeScanningSettings = {
      state: "configured",
      querySuite: "extended",
    };

    const changes = diffCodeScanning(current, desired);
    const qsChange = changes.find((c) => c.property === "querySuite");

    assert.ok(qsChange);
    assert.equal(qsChange.action, "update");
    assert.equal(qsChange.oldValue, "default");
    assert.equal(qsChange.newValue, "extended");
  });

  test("detects languages change (sorted comparison)", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
      languages: ["python", "javascript-typescript"],
    };
    const desired: CodeScanningSettings = {
      state: "configured",
      languages: ["go", "python"],
    };

    const changes = diffCodeScanning(current, desired);
    const langChange = changes.find((c) => c.property === "languages");

    assert.ok(langChange);
    assert.equal(langChange.action, "update");
  });

  test("no changes when everything matches", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
      query_suite: "default",
      languages: ["javascript-typescript", "python"],
    };
    const desired: CodeScanningSettings = {
      state: "configured",
      querySuite: "default",
      languages: ["python", "javascript-typescript"],
    };

    const changes = diffCodeScanning(current, desired);

    assert.ok(!hasCodeScanningChanges(changes));
  });

  test("skips querySuite diff when not specified in desired", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
      query_suite: "default",
    };
    const desired: CodeScanningSettings = { state: "configured" };

    const changes = diffCodeScanning(current, desired);

    assert.ok(!changes.find((c) => c.property === "querySuite"));
  });

  test("skips languages diff when not specified in desired", () => {
    const current: CurrentCodeScanningSettings = {
      state: "configured",
      languages: ["python"],
    };
    const desired: CodeScanningSettings = { state: "configured" };

    const changes = diffCodeScanning(current, desired);

    assert.ok(!changes.find((c) => c.property === "languages"));
  });

  test("hasCodeScanningChanges returns true when changes exist", () => {
    const current: CurrentCodeScanningSettings = {
      state: "not-configured",
    };
    const desired: CodeScanningSettings = { state: "configured" };

    const changes = diffCodeScanning(current, desired);

    assert.ok(hasCodeScanningChanges(changes));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/settings/code-scanning/code-scanning-diff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement diff.ts**

Create `src/settings/code-scanning/diff.ts`:

```typescript
import type { CodeScanningSettings } from "../../config/index.js";
import type { CurrentCodeScanningSettings } from "./types.js";
import type { SettingsAction } from "../base-processor.js";

export interface CodeScanningChange {
  property: "state" | "querySuite" | "languages";
  action: SettingsAction;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Compares current code scanning default setup with desired settings.
 * Only compares properties that are explicitly set in desired.
 * Languages are compared as sorted arrays (order doesn't matter).
 */
export function diffCodeScanning(
  current: CurrentCodeScanningSettings,
  desired: CodeScanningSettings
): CodeScanningChange[] {
  const changes: CodeScanningChange[] = [];

  // state is always compared (required field)
  if (current.state !== desired.state) {
    changes.push({
      property: "state",
      action: current.state === undefined ? "create" : "update",
      oldValue: current.state,
      newValue: desired.state,
    });
  } else {
    changes.push({
      property: "state",
      action: "unchanged",
      oldValue: current.state,
      newValue: desired.state,
    });
  }

  // querySuite: only diff if specified in desired
  if (desired.querySuite !== undefined) {
    const currentQS = current.query_suite;
    if (currentQS !== desired.querySuite) {
      changes.push({
        property: "querySuite",
        action: currentQS === undefined ? "create" : "update",
        oldValue: currentQS,
        newValue: desired.querySuite,
      });
    } else {
      changes.push({
        property: "querySuite",
        action: "unchanged",
        oldValue: currentQS,
        newValue: desired.querySuite,
      });
    }
  }

  // languages: only diff if specified in desired (sorted comparison)
  if (desired.languages !== undefined) {
    const currentLangs = [...(current.languages ?? [])].sort();
    const desiredLangs = [...desired.languages].sort();
    const langsMatch =
      currentLangs.length === desiredLangs.length &&
      currentLangs.every((lang, i) => lang === desiredLangs[i]);

    if (!langsMatch) {
      changes.push({
        property: "languages",
        action: current.languages === undefined ? "create" : "update",
        oldValue: current.languages,
        newValue: desired.languages,
      });
    } else {
      changes.push({
        property: "languages",
        action: "unchanged",
        oldValue: current.languages,
        newValue: desired.languages,
      });
    }
  }

  return changes;
}

/**
 * Checks if there are any actual changes to apply.
 */
export function hasCodeScanningChanges(
  changes: CodeScanningChange[]
): boolean {
  return changes.some((c) => c.action !== "unchanged");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/settings/code-scanning/code-scanning-diff.test.ts`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/settings/code-scanning/diff.ts test/unit/settings/code-scanning/code-scanning-diff.test.ts
git commit -m "feat(settings): add code scanning diff logic (#669)"
```

---

## Task 6: Code Scanning Formatter

**Files:**

- Create: `src/settings/code-scanning/formatter.ts`

- [ ] **Step 1: Create formatter.ts**

Create `src/settings/code-scanning/formatter.ts`:

```typescript
import chalk from "chalk";
import { formatScalarValue } from "../../shared/string-utils.js";
import type { CodeScanningChange } from "./diff.js";
import { countActions } from "../base-processor.js";

export interface CodeScanningPlanEntry {
  property: string;
  action: "create" | "update";
  oldValue?: unknown;
  newValue?: unknown;
}

export interface CodeScanningPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  entries: CodeScanningPlanEntry[];
}

function formatValue(val: unknown): string {
  if (Array.isArray(val)) {
    return `[${val.join(", ")}]`;
  }
  return formatScalarValue(val) ?? String(val);
}

/**
 * Formats code scanning changes as Terraform-style plan output.
 */
export function formatCodeScanningPlan(
  changes: CodeScanningChange[]
): CodeScanningPlanResult {
  const lines: string[] = [];
  const entries: CodeScanningPlanEntry[] = [];

  const { create: creates, update: updates } = countActions(changes);

  for (const change of changes) {
    if (change.action === "create") {
      lines.push(
        chalk.green(
          `    + ${change.property}: ${formatValue(change.newValue)}`
        )
      );
      entries.push({
        property: change.property,
        action: "create",
        newValue: change.newValue,
      });
    } else if (change.action === "update") {
      lines.push(
        chalk.yellow(
          `    ~ ${change.property}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`
        )
      );
      entries.push({
        property: change.property,
        action: "update",
        oldValue: change.oldValue,
        newValue: change.newValue,
      });
    }
  }

  return { lines, creates, updates, entries };
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Compilation succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/settings/code-scanning/formatter.ts
git commit -m "feat(settings): add code scanning formatter (#669)"
```

---

## Task 7: Shared Repo Metadata Provider

**Files:**

- Create: `src/shared/repo-metadata-provider.ts`
- Create: `test/unit/shared/repo-metadata-provider.test.ts`
- Modify: `src/shared/index.ts` (if barrel exists) or export from new file

- [ ] **Step 1: Write failing test for metadata provider**

Create `test/unit/shared/repo-metadata-provider.test.ts`:

```typescript
import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubRepoMetadataProvider } from "../../../src/shared/repo-metadata-provider.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "https://github.com/test-org/test-repo.git",
  host: "github.com",
  owner: "test-org",
  repo: "test-repo",
};

class MockExecutor implements ICommandExecutor {
  result = "";
  async exec(_command: string, _cwd: string): Promise<string> {
    return this.result;
  }
}

describe("GitHubRepoMetadataProvider", () => {
  let executor: MockExecutor;
  let provider: GitHubRepoMetadataProvider;

  beforeEach(() => {
    executor = new MockExecutor();
    provider = new GitHubRepoMetadataProvider(executor, { cwd: "/tmp" });
  });

  test("returns metadata for public repo without GHAS", async () => {
    executor.result = JSON.stringify({
      visibility: "public",
      owner: { type: "Organization" },
    });

    const metadata = await provider.getMetadata(githubRepo);

    assert.equal(metadata.visibility, "public");
    assert.equal(metadata.ownerType, "Organization");
    assert.equal(metadata.hasGHAS, false);
  });

  test("detects GHAS from security_and_analysis", async () => {
    executor.result = JSON.stringify({
      visibility: "private",
      owner: { type: "Organization" },
      security_and_analysis: {
        advanced_security: { status: "enabled" },
      },
    });

    const metadata = await provider.getMetadata(githubRepo);

    assert.equal(metadata.visibility, "private");
    assert.equal(metadata.hasGHAS, true);
  });

  test("returns hasGHAS false when security_and_analysis is null", async () => {
    executor.result = JSON.stringify({
      visibility: "private",
      owner: { type: "User" },
      security_and_analysis: null,
    });

    const metadata = await provider.getMetadata(githubRepo);

    assert.equal(metadata.ownerType, "User");
    assert.equal(metadata.hasGHAS, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/shared/repo-metadata-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the metadata provider**

Create `src/shared/repo-metadata-provider.ts`:

```typescript
import type { ICommandExecutor } from "./command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "./repo-detector.js";
import { GhApiClient, type GhApiOptions } from "./gh-api-utils.js";
import { parseApiJson } from "./json-utils.js";
import type { RepoVisibility } from "../config/index.js";

export interface RepoMetadata {
  visibility: RepoVisibility;
  ownerType: "User" | "Organization";
  hasGHAS: boolean;
}

/**
 * Strategy interface for fetching repository metadata.
 * Used to share repo metadata (visibility, owner type, GHAS)
 * across settings processors without coupling them.
 */
export interface IRepoMetadataProvider {
  getMetadata(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<RepoMetadata>;
}

interface GitHubRepoMetadataProviderOptions {
  retries?: number;
  cwd: string;
}

export class GitHubRepoMetadataProvider implements IRepoMetadataProvider {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubRepoMetadataProviderOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async getMetadata(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<RepoMetadata> {
    assertGitHubRepo(repoInfo, "Repo Metadata Provider");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}`;
    const result = await this.api.call("GET", endpoint, { options });

    const parsed = parseApiJson<{
      visibility?: RepoVisibility;
      owner?: { type?: "User" | "Organization" };
      security_and_analysis?: Record<string, unknown> | null;
    }>(result, "repo metadata response");

    return {
      visibility: parsed.visibility ?? "public",
      ownerType: parsed.owner?.type ?? "User",
      hasGHAS: parsed.security_and_analysis != null,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/shared/repo-metadata-provider.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/repo-metadata-provider.ts test/unit/shared/repo-metadata-provider.test.ts
git commit -m "feat(shared): add IRepoMetadataProvider for shared GHAS/visibility detection (#669)"
```

---

## Task 8: Code Scanning Processor

**Files:**

- Create: `src/settings/code-scanning/processor.ts`
- Test: `test/unit/settings/code-scanning/code-scanning-processor.test.ts`

- [ ] **Step 1: Write failing tests for processor**

Create `test/unit/settings/code-scanning/code-scanning-processor.test.ts`:

```typescript
import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { CodeScanningProcessor } from "../../../../src/settings/code-scanning/processor.js";
import type {
  ICodeScanningStrategy,
  CurrentCodeScanningSettings,
} from "../../../../src/settings/code-scanning/types.js";
import type {
  IRepoMetadataProvider,
  RepoMetadata,
} from "../../../../src/shared/repo-metadata-provider.js";
import type { GitHubRepoInfo } from "../../../../src/shared/repo-detector.js";
import type { RepoConfig } from "../../../../src/config/index.js";
import type { RepoInfo } from "../../../../src/shared/repo-detector.js";
import type { GhApiOptions } from "../../../../src/shared/gh-api-utils.js";

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "https://github.com/test-org/test-repo.git",
  host: "github.com",
  owner: "test-org",
  repo: "test-repo",
};

const adoRepo: RepoInfo = {
  type: "azure-devops",
  gitUrl: "https://dev.azure.com/org/project/_git/repo",
  host: "dev.azure.com",
  owner: "org",
  organization: "org",
  project: "project",
  repo: "repo",
};

class MockStrategy implements ICodeScanningStrategy {
  getResult: CurrentCodeScanningSettings = { state: "not-configured" };
  updateCalls: Array<{
    settings: { state: string; query_suite?: string; languages?: string[] };
  }> = [];

  async getDefaultSetup(
    _repoInfo: RepoInfo,
    _options?: GhApiOptions
  ): Promise<CurrentCodeScanningSettings> {
    return this.getResult;
  }

  async updateDefaultSetup(
    _repoInfo: RepoInfo,
    settings: { state: string; query_suite?: string; languages?: string[] },
    _options?: GhApiOptions
  ): Promise<void> {
    this.updateCalls.push({ settings });
  }
}

class MockMetadataProvider implements IRepoMetadataProvider {
  result: RepoMetadata = {
    visibility: "public",
    ownerType: "Organization",
    hasGHAS: false,
  };

  async getMetadata(
    _repoInfo: RepoInfo,
    _options?: GhApiOptions
  ): Promise<RepoMetadata> {
    return this.result;
  }
}

function makeRepoConfig(
  codeScanning: RepoConfig["settings"] extends { codeScanning?: infer T }
    ? T
    : never
): RepoConfig {
  return {
    git: "https://github.com/test-org/test-repo.git",
    files: [],
    settings: { codeScanning },
  } as RepoConfig;
}

describe("CodeScanningProcessor", () => {
  let strategy: MockStrategy;
  let metadataProvider: MockMetadataProvider;
  let processor: CodeScanningProcessor;

  beforeEach(() => {
    strategy = new MockStrategy();
    metadataProvider = new MockMetadataProvider();
    processor = new CodeScanningProcessor(strategy, metadataProvider);
  });

  test("skips non-GitHub repos", async () => {
    const config = makeRepoConfig({ state: "configured" });
    const result = await processor.process(config, adoRepo, {});

    assert.ok(result.skipped);
    assert.ok(result.message.includes("not a GitHub repository"));
  });

  test("skips when no codeScanning settings", async () => {
    const config = { git: "https://github.com/test-org/test-repo.git", files: [] } as RepoConfig;
    const result = await processor.process(config, githubRepo, {});

    assert.ok(result.skipped);
  });

  test("applies changes when state differs", async () => {
    strategy.getResult = { state: "not-configured" };
    const config = makeRepoConfig({ state: "configured" });

    const result = await processor.process(config, githubRepo, {});

    assert.ok(result.success);
    assert.equal(strategy.updateCalls.length, 1);
    assert.equal(strategy.updateCalls[0].settings.state, "configured");
  });

  test("dry run does not apply changes", async () => {
    strategy.getResult = { state: "not-configured" };
    const config = makeRepoConfig({ state: "configured" });

    const result = await processor.process(config, githubRepo, {
      dryRun: true,
    });

    assert.ok(result.success);
    assert.ok(result.dryRun);
    assert.equal(strategy.updateCalls.length, 0);
  });

  test("no changes when settings match", async () => {
    strategy.getResult = {
      state: "configured",
      query_suite: "default",
    };
    const config = makeRepoConfig({
      state: "configured",
      querySuite: "default",
    });

    const result = await processor.process(config, githubRepo, {});

    assert.ok(result.success);
    assert.ok(result.message.includes("No changes needed"));
    assert.equal(strategy.updateCalls.length, 0);
  });

  test("rejects when GHAS not available for private repo", async () => {
    metadataProvider.result = {
      visibility: "private",
      ownerType: "User",
      hasGHAS: false,
    };
    strategy.getResult = { state: "not-configured" };
    const config = makeRepoConfig({ state: "configured" });

    const result = await processor.process(config, githubRepo, {});

    assert.ok(!result.success);
    assert.ok(
      result.message.includes("Advanced Security"),
      `Expected GHAS error, got: ${result.message}`
    );
  });

  test("allows code scanning on public repo without GHAS", async () => {
    metadataProvider.result = {
      visibility: "public",
      ownerType: "User",
      hasGHAS: false,
    };
    strategy.getResult = { state: "not-configured" };
    const config = makeRepoConfig({ state: "configured" });

    const result = await processor.process(config, githubRepo, {});

    assert.ok(result.success);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/unit/settings/code-scanning/code-scanning-processor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement processor.ts**

Create `src/settings/code-scanning/processor.ts`:

```typescript
import type { RepoConfig, CodeScanningSettings } from "../../config/index.js";
import type { GitHubRepoInfo, RepoInfo } from "../../shared/repo-detector.js";
import type { ICodeScanningStrategy } from "./types.js";
import type {
  IRepoMetadataProvider,
  RepoMetadata,
} from "../../shared/repo-metadata-provider.js";
import { diffCodeScanning, hasCodeScanningChanges } from "./diff.js";
import {
  formatCodeScanningPlan,
  type CodeScanningPlanResult,
} from "./formatter.js";
import {
  withGitHubGuards,
  type BaseProcessorOptions,
  type BaseProcessorResult,
  type ISettingsProcessor,
  type ChangeCounts,
  countActions,
  buildDryRunResult,
  buildApplyResult,
} from "../base-processor.js";

export type ICodeScanningProcessor = ISettingsProcessor<
  CodeScanningProcessorOptions,
  CodeScanningProcessorResult
>;

export type CodeScanningProcessorOptions = BaseProcessorOptions;

export interface CodeScanningProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: CodeScanningPlanResult;
}

export class CodeScanningProcessor implements ICodeScanningProcessor {
  private readonly strategy: ICodeScanningStrategy;
  private readonly metadataProvider: IRepoMetadataProvider;

  constructor(
    strategy: ICodeScanningStrategy,
    metadataProvider: IRepoMetadataProvider
  ) {
    this.strategy = strategy;
    this.metadataProvider = metadataProvider;
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: CodeScanningProcessorOptions
  ): Promise<CodeScanningProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) => {
        const cs = rc.settings?.codeScanning;
        return !!cs && typeof cs === "object";
      },
      emptySettingsMessage: "No code scanning settings configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async applySettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: CodeScanningProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<CodeScanningProcessorResult> {
    const { dryRun } = options;
    const desiredSettings = repoConfig.settings!
      .codeScanning! as CodeScanningSettings;

    const strategyOptions = { token: effectiveToken, host: githubRepo.host };

    // Validate GHAS availability for private repos
    const metadata = await this.metadataProvider.getMetadata(
      githubRepo,
      strategyOptions
    );
    const validationError = this.validateGHAS(desiredSettings, metadata);
    if (validationError) {
      return {
        success: false,
        repoName,
        message: `Failed: ${validationError}`,
      };
    }

    // Fetch current settings
    const currentSettings = await this.strategy.getDefaultSetup(
      githubRepo,
      strategyOptions
    );

    // Compute diff
    const changes = diffCodeScanning(currentSettings, desiredSettings);
    const changeCounts = countActions(changes);

    if (!hasCodeScanningChanges(changes)) {
      return {
        success: true,
        repoName,
        message: "No changes needed",
        changes: changeCounts,
      };
    }

    // Format plan output
    const planOutput = formatCodeScanningPlan(changes);

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts, { planOutput });
    }

    // Build API payload from desired settings
    const payload: {
      state: string;
      query_suite?: string;
      languages?: string[];
    } = {
      state: desiredSettings.state,
    };
    if (desiredSettings.querySuite !== undefined) {
      payload.query_suite = desiredSettings.querySuite;
    }
    if (desiredSettings.languages !== undefined) {
      payload.languages = desiredSettings.languages;
    }

    await this.strategy.updateDefaultSetup(
      githubRepo,
      payload,
      strategyOptions
    );

    const appliedCount = changes.filter(
      (c) => c.action !== "unchanged"
    ).length;
    return buildApplyResult(repoName, changeCounts, appliedCount, {
      planOutput,
    });
  }

  private validateGHAS(
    desired: CodeScanningSettings,
    metadata: RepoMetadata
  ): string | undefined {
    if (desired.state !== "configured") return undefined;

    const isPublic = metadata.visibility === "public";
    if (isPublic) return undefined;

    if (!metadata.hasGHAS) {
      return "Code scanning default setup requires GitHub Advanced Security (not available for this repository)";
    }

    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/unit/settings/code-scanning/code-scanning-processor.test.ts`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/settings/code-scanning/processor.ts test/unit/settings/code-scanning/code-scanning-processor.test.ts
git commit -m "feat(settings): add code scanning processor with GHAS validation (#669)"
```

---

## Task 9: Barrel Exports and Settings Index

**Files:**

- Create: `src/settings/code-scanning/index.ts`
- Modify: `src/settings/index.ts`

- [ ] **Step 1: Create code-scanning barrel export**

Create `src/settings/code-scanning/index.ts`:

```typescript
// Formatter
export { type CodeScanningPlanEntry } from "./formatter.js";

// Processor
export {
  CodeScanningProcessor,
  type ICodeScanningProcessor,
} from "./processor.js";

// Strategy
export { GitHubCodeScanningStrategy } from "./github-code-scanning-strategy.js";
```

- [ ] **Step 2: Add code scanning exports to settings index**

In `src/settings/index.ts`, add:

```typescript
// Code scanning
export {
  type CodeScanningPlanEntry,
  CodeScanningProcessor,
  type ICodeScanningProcessor,
  GitHubCodeScanningStrategy,
} from "./code-scanning/index.js";
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: Compilation succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/settings/code-scanning/index.ts src/settings/index.ts
git commit -m "feat(settings): add code scanning barrel exports (#669)"
```

---

## Task 10: Wire into Orchestrator

**Files:**

- Modify: `src/cli/types.ts` (add `CodeScanningProcessorFactory`, update `SyncDependencies`, `ApplyRepoSettingsContext`)
- Modify: `src/cli/sync-command.ts` (add factory, descriptor, wiring)
- Modify: `src/cli/settings-report-builder.ts` (add `codeScanningResult` to `ProcessorResults`)

- [ ] **Step 1: Update CLI types**

In `src/cli/types.ts`, add the import:

```typescript
import type { ICodeScanningProcessor } from "../settings/index.js";
```

Add the factory type:

```typescript
export type CodeScanningProcessorFactory =
  SettingsProcessorFactory<ICodeScanningProcessor>;
```

Add to `SyncDependencies`:

```typescript
codeScanningProcessorFactory?: CodeScanningProcessorFactory;
```

Add to `ApplyRepoSettingsContext`:

```typescript
codeScanningProcessorFactory: NonNullable<
  SyncDependencies["codeScanningProcessorFactory"]
>;
```

- [ ] **Step 2: Update settings-report-builder.ts**

In `src/cli/settings-report-builder.ts`, add the import:

```typescript
import type { CodeScanningPlanEntry } from "../settings/index.js";
```

Add to `ProcessorResults`:

```typescript
codeScanningResult?: {
  planOutput?: {
    entries?: CodeScanningPlanEntry[];
  };
};
```

Add a conversion block after the labels conversion (around line 104), before the error check:

```typescript
    // Convert code scanning processor output
    if (result.codeScanningResult?.planOutput?.entries) {
      for (const entry of result.codeScanningResult.planOutput.entries) {
        repoChanges.settings.push({
          name: `codeScanning.${entry.property}`,
          action: entry.action,
          oldValue: entry.oldValue,
          newValue: entry.newValue ?? null,
        });
      }
      const counts = countActions(repoChanges.settings);
      totals.settings.create += counts.create;
      totals.settings.update += counts.update;
    }
```

- [ ] **Step 3: Update sync-command.ts**

Add imports:

```typescript
import {
  // ...existing imports...
  CodeScanningProcessor,
  GitHubCodeScanningStrategy,
  type ICodeScanningProcessor,
} from "../settings/index.js";
import {
  GitHubRepoMetadataProvider,
} from "../shared/repo-metadata-provider.js";
import type { CodeScanningProcessorFactory } from "./types.js";
```

Add the default factory function (alongside the existing factory functions):

```typescript
function createDefaultCodeScanningProcessorFactory(): CodeScanningProcessorFactory {
  const cwd = process.cwd();
  const executor = getDefaultExecutor();
  return () =>
    new CodeScanningProcessor(
      new GitHubCodeScanningStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}
```

Update the `SettingsDescriptor` interface's `key` type:

```typescript
interface SettingsDescriptor {
  key: "rulesets" | "labels" | "repo" | "codeScanning";
  label: string;
  run: () => Promise<SettingsResult>;
}
```

Add `codeScanningProcessorFactory` to the destructured `deps` in the sync function (alongside the other factories):

```typescript
codeScanningProcessorFactory = createDefaultCodeScanningProcessorFactory(),
```

Add `codeScanningProcessorFactory` to `buildSettingsDescriptors` parameters and the `ApplyRepoSettingsContext`.

Add a new descriptor entry to the array returned by `buildSettingsDescriptors`:

```typescript
{
  key: "codeScanning" as const,
  label: "Code Scanning",
  run: () =>
    runAndStore(codeScanningProcessorFactory, sharedOpts, (e, r) => {
      e.codeScanningResult = r as ProcessorResults["codeScanningResult"];
    }),
},
```

- [ ] **Step 4: Update `hasActionableSettings` in validator.ts**

In `src/config/validator.ts`, find `hasActionableSettings` and add a check for `codeScanning` after the `labels` check:

```typescript
  if (
    settings.codeScanning &&
    typeof settings.codeScanning === "object"
  ) {
    return true;
  }
```

This ensures a config with only `codeScanning` settings (no files, repo, labels, or rulesets) is recognized as having actionable content.

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: Compilation succeeds.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli/types.ts src/cli/sync-command.ts src/cli/settings-report-builder.ts src/config/validator.ts
git commit -m "feat(cli): wire code scanning processor into orchestrator (#669)"
```

---

## Task 11: Refactor RepoSettingsProcessor to Use IRepoMetadataProvider

**Files:**

- Modify: `src/settings/repo-settings/processor.ts` (inject `IRepoMetadataProvider`, refactor `validateSecuritySettings`)
- Modify: `test/unit/repo-settings-processor.test.ts` (update mock setup)
- Modify: `src/cli/sync-command.ts` (update factory to inject metadata provider)

- [ ] **Step 1: Update RepoSettingsProcessor constructor**

In `src/settings/repo-settings/processor.ts`, add the import:

```typescript
import type {
  IRepoMetadataProvider,
  RepoMetadata,
} from "../../shared/repo-metadata-provider.js";
```

Update the constructor to accept the metadata provider:

```typescript
export class RepoSettingsProcessor implements IRepoSettingsProcessor {
  private readonly strategy: IRepoSettingsStrategy;
  private readonly metadataProvider: IRepoMetadataProvider;

  constructor(
    strategy: IRepoSettingsStrategy,
    metadataProvider: IRepoMetadataProvider
  ) {
    this.strategy = strategy;
    this.metadataProvider = metadataProvider;
  }
```

- [ ] **Step 2: Refactor `validateSecuritySettings` to use metadata**

In `applySettings`, after fetching current settings but before computing the diff, fetch metadata and pass it to validation:

```typescript
    // Fetch metadata for GHAS validation
    const metadata = await this.metadataProvider.getMetadata(
      githubRepo,
      strategyOptions
    );

    // Validate security settings compatibility
    const securityErrors = this.validateSecuritySettings(
      desiredSettings,
      currentSettings,
      metadata
    );
```

Update `validateSecuritySettings` to use `RepoMetadata`:

```typescript
  private validateSecuritySettings(
    desiredSettings: GitHubRepoSettings,
    currentSettings: CurrentRepoSettings,
    metadata: RepoMetadata
  ): string[] {
    const errors: string[] = [];
    const effectiveVisibility =
      desiredSettings.visibility ?? metadata.visibility;
    const isPublic = effectiveVisibility === "public";

    if (desiredSettings.privateVulnerabilityReporting === true && !isPublic) {
      errors.push(
        "privateVulnerabilityReporting is only available for public repositories"
      );
    }

    if (!isPublic) {
      const isUserOwned = metadata.ownerType === "User";
      const hasGHAS = metadata.hasGHAS;

      if (
        desiredSettings.secretScanning === true &&
        (isUserOwned || !hasGHAS)
      ) {
        errors.push(
          "secretScanning requires GitHub Advanced Security (not available for this repository)"
        );
      }

      if (
        desiredSettings.secretScanningPushProtection === true &&
        (isUserOwned || !hasGHAS)
      ) {
        errors.push(
          "secretScanningPushProtection requires GitHub Advanced Security (not available for this repository)"
        );
      }
    }

    return errors;
  }
```

- [ ] **Step 3: Update the default factory in sync-command.ts**

Update `createDefaultRepoSettingsProcessorFactory`:

```typescript
function createDefaultRepoSettingsProcessorFactory(): RepoSettingsProcessorFactory {
  const cwd = process.cwd();
  const executor = getDefaultExecutor();
  return () =>
    new RepoSettingsProcessor(
      new GitHubRepoSettingsStrategy(executor, { cwd }),
      new GitHubRepoMetadataProvider(executor, { cwd })
    );
}
```

- [ ] **Step 4: Update tests**

In `test/unit/repo-settings-processor.test.ts`, add a `MockMetadataProvider` and pass it to the processor constructor:

```typescript
import type {
  IRepoMetadataProvider,
  RepoMetadata,
} from "../../src/shared/repo-metadata-provider.js";

class MockMetadataProvider implements IRepoMetadataProvider {
  result: RepoMetadata = {
    visibility: "public",
    ownerType: "Organization",
    hasGHAS: true,
  };

  async getMetadata(): Promise<RepoMetadata> {
    return this.result;
  }
}
```

Update the processor instantiation in `beforeEach`:

```typescript
let metadataProvider: MockMetadataProvider;

beforeEach(() => {
  strategy = new MockStrategy();
  metadataProvider = new MockMetadataProvider();
  processor = new RepoSettingsProcessor(strategy, metadataProvider);
});
```

Update any tests that test GHAS validation to set `metadataProvider.result` instead of relying on `currentSettings.security_and_analysis` and `currentSettings.owner_type`.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass, including the refactored repo settings tests.

- [ ] **Step 6: Run typecheck on tests**

Run: `npm run test:typecheck`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add src/settings/repo-settings/processor.ts src/cli/sync-command.ts test/unit/repo-settings-processor.test.ts
git commit -m "refactor(settings): extract IRepoMetadataProvider from RepoSettingsProcessor (#669)"
```

---

## Task 12: Documentation

**Files:**

- Modify: `docs/configuration/settings.md` (or equivalent settings docs page)

- [ ] **Step 1: Find the correct docs file**

Run: `find docs/ -name "*.md" | head -20` and check which file documents settings.

- [ ] **Step 2: Add code scanning documentation**

Add a new section documenting the `codeScanning` settings with:

- Config example
- Supported languages
- Explanation of `state`, `querySuite`, and `languages` fields
- Note about GHAS requirement for private repos
- Per-repo opt-out with `codeScanning: false`

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: add code scanning settings documentation (#669)"
```

---

## Task 13: Lint, Typecheck, and Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run build**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 2: Run all unit tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Run test typecheck**

Run: `npm run test:typecheck`
Expected: No type errors.

- [ ] **Step 4: Run linter**

Run: `./lint.sh` (from main repo, not worktree)
Expected: No lint errors.

- [ ] **Step 5: Commit any fixes if needed**

---

## Task 14: Integration Test

**Files:**

- Modify: `test/integration/github/` (add code scanning integration test)

- [ ] **Step 1: Add code scanning to integration test config**

Create or modify an integration test that:

1. Creates an ephemeral repo
2. Runs sync with `codeScanning: { state: "configured", querySuite: "default" }`
3. Verifies via `gh api /repos/{owner}/{repo}/code-scanning/default-setup` that state is `configured`
4. Runs sync again with `querySuite: "extended"` and verifies the change
5. Runs sync with `state: "not-configured"` and verifies it's disabled
6. Verifies dry-run shows changes without applying

Follow the ephemeral repo pattern from existing integration tests (see `test/integration/test-helpers.ts` for `generateRepoName`, `createRepo`, `deleteRepo`).

- [ ] **Step 2: Run integration test**

Run: `npm run test:integration:github`
Expected: Code scanning integration tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/integration/
git commit -m "test: add code scanning integration tests (#669)"
```
