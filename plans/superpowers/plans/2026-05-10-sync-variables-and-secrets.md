# Sync Variables and Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync GitHub Actions variables via `xfg sync` settings flow and secrets via a new `xfg secrets sync` command.

**Architecture:** Variables follow the existing settings processor pattern (ISettingsProcessor + strategy + diff + formatter). Secrets get their own command, processor, encryption module, and env resolver. Both use DI throughout — all collaborators injected via interfaces.

**Tech Stack:** TypeScript, Commander.js (CLI), `libsodium-wrappers` (secret encryption), `gh` CLI (GitHub API via GhApiClient)

**Spec:** `plans/superpowers/specs/2026-05-10-sync-variables-and-secrets-design.md`

## Tasks

### Task 1: Config Types for Variables and Secrets

**Files:**

- Modify: `src/config/types.ts`

- [ ] **Step 1: Add variables to RepoSettings, RawRootSettings, RawRepoSettings**

Variables use their own `deleteOrphaned` peer key (same flat pattern as secrets' `deleteOrphaned` and labels' `inherit`). This keeps variable orphan deletion independent from the shared `settings.deleteOrphaned` flag used by labels/rulesets.

```typescript
// In RepoSettings (after codeScanning field):
  /** GitHub Actions repository variables keyed by name.
   *  After normalization, `false` opt-outs and `inherit` are stripped — only
   *  string values remain. The `deleteOrphaned` peer key uses a branded
   *  intersection (same pattern as labels). */
  variables?: Record<string, string> & { deleteOrphaned?: boolean };

// In RawRootSettings (after codeScanning field):
  variables?: Record<string, string | false> & { deleteOrphaned?: boolean };

// In RawRepoSettings (after codeScanning field):
  variables?: Record<string, string | false> & { inherit?: boolean; deleteOrphaned?: boolean };
```

In the processor, separate `deleteOrphaned` from variable entries:

```typescript
const { deleteOrphaned = false, ...variableEntries } = repoConfig.settings?.variables ?? {};
```

- [ ] **Step 2: Add SecretConfig type and secrets to RawConfig**

> **Important:** Also add `SecretConfig` to the barrel export in `src/config/index.ts`:
>
> ```typescript
> export type { SecretConfig } from "./types.js";
> ```
>
> Add it in the type re-export block alongside the other type exports (e.g., after `ContentValue`).

```typescript
// New type (before RepoSettings):
export interface SecretConfig {
  env: string;
}

// In RawConfig (after settings field):
  /** Secrets config: Record<name, SecretConfig | boolean> with optional deleteOrphaned flag.
   *  Uses the same pattern as labels' inherit: a peer key alongside data entries.
   *  The `| boolean` in the Record allows deleteOrphaned (boolean) alongside
   *  SecretConfig entries — same approach as labels using `Record<string, Label | false>`. */
  secrets?: Record<string, SecretConfig | boolean> & { deleteOrphaned?: boolean };

// In Config (after settings field):
  /** Secrets config passes through from RawConfig unchanged (no normalizer
   *  transformation). The `| boolean` allows the deleteOrphaned peer key;
   *  processors filter out boolean entries before iterating secrets. */
  secrets?: Record<string, SecretConfig | boolean> & { deleteOrphaned?: boolean };
```

The flat structure matches the YAML layout:

```yaml
secrets:
  DEPLOY_TOKEN:
    env: DEPLOY_TOKEN_VALUE
  deleteOrphaned: true
```

In the processor/normalizer, separate `deleteOrphaned` from secret entries:

```typescript
const { deleteOrphaned = false, ...secretEntries } = config.secrets ?? {};
```

This follows the same pattern as labels' `inherit` key.

- [ ] **Step 3: Verify build compiles**

Run: `npm run build` Expected: PASS (no consumers of new types yet)

- [ ] **Step 4: Commit**

```bash
git add src/config/types.ts src/config/index.ts
git commit -m "feat(config): add types for variables and secrets"
```

______________________________________________________________________

### Task 2: Config Validation for Variables and Secrets

**Files:**

- Modify: `src/config/validator.ts`

- Test: `test/unit/config/validator.test.ts`

- [ ] **Step 1: Write failing tests for variable name validation**

Add to the existing validator test file:

```typescript
describe("validateVariables", () => {
  test("accepts valid variable names", () => {
    const config = createValidConfig({
      settings: {
        variables: { MY_VAR: "value", ANOTHER_123: "val" },
      },
    });
    assert.doesNotThrow(() => validateForSync(config));
  });

  test("rejects variable names starting with GITHUB_", () => {
    const config = createValidConfig({
      settings: {
        variables: { GITHUB_TOKEN: "value" },
      },
    });
    assert.throws(() => validateForSync(config), /GITHUB_/);
  });

  test("rejects variable names with invalid characters", () => {
    const config = createValidConfig({
      settings: {
        variables: { "my-var": "value" },
      },
    });
    assert.throws(() => validateForSync(config), /invalid.*character/i);
  });

  // Defensive test: root-level settings don't use `inherit`, but the validator
  // should still skip it gracefully if present (e.g., from a copy-paste error).
  test("skips reserved peer keys (deleteOrphaned, inherit) during name validation", () => {
    const config = createValidConfig({
      settings: {
        variables: Object.assign(
          { MY_VAR: "value" },
          { deleteOrphaned: true, inherit: false }
        ),
      },
    });
    assert.doesNotThrow(() => validateForSync(config));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --grep "validateVariables"` Expected: FAIL

- [ ] **Step 3: Implement validateVariableName in validator.ts**

```typescript
const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateVariableName(name: string): void {
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    throw new ValidationError(
      `Variable name '${name}' contains invalid characters. Only alphanumeric and underscore allowed.`
    );
  }
  if (name.startsWith("GITHUB_")) {
    throw new ValidationError(
      `Variable name '${name}' cannot start with 'GITHUB_' (reserved prefix).`
    );
  }
}
```

Add to `hasActionableSettings`:

```typescript
if (settings.variables) {
  const { deleteOrphaned, inherit: _i, ...entries } = settings.variables as Record<string, unknown>;
  if (Object.keys(entries).length > 0 || deleteOrphaned === true) {
    return true;
  }
}
```

Add variable name validation call in `validateForSync` or the appropriate per-repo validation path. When iterating variable names for validation, skip the reserved peer keys `deleteOrphaned` and `inherit`:

```typescript
const VARIABLE_RESERVED_KEYS = new Set(["deleteOrphaned", "inherit"]);
// In validation loop:
for (const name of Object.keys(variables)) {
  if (VARIABLE_RESERVED_KEYS.has(name)) continue;
  validateVariableName(name);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "validateVariables"` Expected: PASS

- [ ] **Step 5: Write failing tests for secret config validation**

```typescript
// Add to imports at top of test file:
import type { SecretConfig } from "../../../src/config/index.js";

describe("validateSecrets", () => {
  test("accepts valid secret config", () => {
    const config = createValidConfig({
      secrets: { MY_SECRET: { env: "SOURCE_VAR" } },
    });
    assert.doesNotThrow(() => validateSecretsConfig(config));
  });

  test("rejects secret names starting with GITHUB_", () => {
    const config = createValidConfig({
      secrets: { GITHUB_TOKEN: { env: "TOKEN" } },
    });
    assert.throws(() => validateSecretsConfig(config), /GITHUB_/);
  });

  test("rejects secret without env field", () => {
    const config = createValidConfig({
      secrets: { MY_SECRET: {} as SecretConfig },
    });
    assert.throws(() => validateSecretsConfig(config), /env/);
  });

  test("skips when no secrets configured", () => {
    const config = createValidConfig({});
    assert.doesNotThrow(() => validateSecretsConfig(config));
  });
});
```

- [ ] **Step 6: Implement validateSecretName, validateSecretEntry, and validateSecretsConfig**

```typescript
export function validateSecretName(name: string): void {
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    throw new ValidationError(
      `Secret name '${name}' contains invalid characters. Only alphanumeric and underscore allowed.`
    );
  }
  if (name.startsWith("GITHUB_")) {
    throw new ValidationError(
      `Secret name '${name}' cannot start with 'GITHUB_' (reserved prefix).`
    );
  }
}

function validateSecretEntry(name: string, config: SecretConfig): void {
  validateSecretName(name);
  if (!config.env || typeof config.env !== "string") {
    throw new ValidationError(
      `Secret '${name}' requires an 'env' field (string) specifying the environment variable source.`
    );
  }
}

/** Top-level secrets validation — called by `xfg secrets sync` CLI command.
 *  Separate from `validateForSync` because a secrets-only config may have no
 *  files or settings (which `validateForSync` requires). */
export function validateSecretsConfig(config: RawConfig): void {
  if (!config.secrets) return;

  const { deleteOrphaned: _, ...entries } = config.secrets;
  for (const [name, value] of Object.entries(entries)) {
    if (typeof value === "boolean") continue;
    validateSecretEntry(name, value as SecretConfig);
  }
}
```

- [ ] **Step 7: Update `validateRawConfig` to accept secrets-only configs**

`loadRawConfig` calls `validateRawConfig` which requires files or settings. A config with only `secrets:` and `repos:` will fail validation. Add `hasSecrets` to the OR condition:

```typescript
// In validateRawConfig, add after existing checks:
const hasSecrets =
  isPlainObject(config.secrets) && Object.keys(config.secrets).length > 0;

// Update the "requires at least one of" check to include hasSecrets:
if (
  !hasFiles &&
  !hasSettings &&
  !hasGrpFiles &&
  !hasGrpSettings &&
  !hasCondGrpFiles &&
  !hasCondGrpSettings &&
  !hasCondGrpPR &&
  !hasSecrets
) {
  throw new ValidationError(
    "Config requires at least one of: 'files', 'settings', or 'secrets'. " +
      "Use 'files' to sync configuration files, 'settings' to manage repository settings, " +
      "or 'secrets' to manage GitHub Actions secrets."
  );
}
```

Add a test:

```typescript
test("accepts config with only secrets and repos", () => {
  const config: RawConfig = {
    id: "test",
    repos: [{ git: "https://github.com/o/r.git" }],
    secrets: {
      MY_SECRET: { env: "SOURCE_VAR" },
    },
  };
  assert.doesNotThrow(() => validateRawConfig(config));
});
```

> **Note:** This is required for the `xfg secrets sync` command (Task 12) to work, since `runSecretsSync` calls `loadRawConfig` which calls `validateRawConfig`. The secrets integration test configs (Task 13) also depend on this fix.

- [ ] **Step 8: Run all tests**

Run: `npm test` Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/config/validator.ts test/unit/config/validator.test.ts
git commit -m "feat(config): add validation for variables and secrets"
```

______________________________________________________________________

### Task 3: Variables Strategy Types and GitHub Implementation

**Files:**

- Create: `src/settings/variables/types.ts`

- Create: `src/settings/variables/github-variables-strategy.ts`

- Test: `test/unit/settings/variables/github-variables-strategy.test.ts`

- [ ] **Step 1: Create variables types**

```typescript
// src/settings/variables/types.ts
import type { RepoInfo } from "../../repo/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";

export interface GitHubVariable {
  name: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubVariablesListResponse {
  total_count: number;
  variables: GitHubVariable[];
}

export interface IVariablesStrategy {
  list(repoInfo: RepoInfo, options?: GhApiOptions): Promise<GitHubVariable[]>;
  create(
    repoInfo: RepoInfo,
    name: string,
    value: string,
    options?: GhApiOptions
  ): Promise<void>;
  update(
    repoInfo: RepoInfo,
    name: string,
    value: string,
    options?: GhApiOptions
  ): Promise<void>;
  delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void>;
}
```

- [ ] **Step 2: Write failing tests for GitHub Variables strategy**

```typescript
// test/unit/settings/variables/github-variables-strategy.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GitHubVariablesStrategy } from "../../../../src/settings/variables/github-variables-strategy.js";
import type {
  ICommandExecutor,
  ExecOptions,
} from "../../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../../src/repo/index.js";

class MockExecutor implements ICommandExecutor {
  calls: { executable: string; args: string[] }[] = [];
  response = "";

  async exec(
    executable: string,
    args: string[],
    _cwd: string,
    _options?: ExecOptions
  ): Promise<string> {
    this.calls.push({ executable, args });
    return this.response;
  }
}

const mockRepo: GitHubRepoInfo = {
  type: "github",
  owner: "test-org",
  repo: "test-repo",
  host: "github.com",
  gitUrl: "https://github.com/test-org/test-repo.git",
};

describe("GitHubVariablesStrategy", () => {
  test("list calls correct API endpoint", async () => {
    const executor = new MockExecutor();
    executor.response = JSON.stringify({
      total_count: 1,
      variables: [
        {
          name: "MY_VAR",
          value: "my-value",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    const strategy = new GitHubVariablesStrategy(executor, { cwd: "/tmp" });

    const result = await strategy.list(mockRepo);

    assert.equal(result.length, 1);
    assert.equal(result[0].name, "MY_VAR");
    const apiCall = executor.calls[0];
    assert.ok(
      apiCall.args.some((a) =>
        a.startsWith("/repos/test-org/test-repo/actions/variables")
      )
    );
  });

  test("create calls POST with name and value", async () => {
    const executor = new MockExecutor();
    executor.response = "{}";
    const strategy = new GitHubVariablesStrategy(executor, { cwd: "/tmp" });

    await strategy.create(mockRepo, "NEW_VAR", "new-value");

    const call = executor.calls[0];
    assert.ok(call.args.some((a) => a.includes("POST")));
  });

  test("update calls PATCH with value", async () => {
    const executor = new MockExecutor();
    executor.response = "";
    const strategy = new GitHubVariablesStrategy(executor, { cwd: "/tmp" });

    await strategy.update(mockRepo, "MY_VAR", "updated-value");

    const call = executor.calls[0];
    assert.ok(call.args.some((a) => a.includes("PATCH")));
  });

  test("delete calls DELETE endpoint", async () => {
    const executor = new MockExecutor();
    executor.response = "";
    const strategy = new GitHubVariablesStrategy(executor, { cwd: "/tmp" });

    await strategy.delete(mockRepo, "MY_VAR");

    const call = executor.calls[0];
    assert.ok(call.args.some((a) => a.includes("DELETE")));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --grep "GitHubVariablesStrategy"` Expected: FAIL (module not found)

- [ ] **Step 4: Implement GitHubVariablesStrategy**

```typescript
// src/settings/variables/github-variables-strategy.ts
import type { ICommandExecutor } from "../../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../../repo/index.js";
import { GhApiClient, type GhApiOptions } from "../../shared/gh-api-utils.js";
import { parseApiJson } from "../../shared/json-utils.js";
import type {
  IVariablesStrategy,
  GitHubVariable,
  GitHubVariablesListResponse,
} from "./types.js";

interface GitHubVariablesStrategyOptions {
  retries?: number;
  cwd: string;
}

export class GitHubVariablesStrategy implements IVariablesStrategy {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubVariablesStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async list(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubVariable[]> {
    assertGitHubRepo(repoInfo, "GitHub Variables strategy");

    // NOTE: Do NOT use `paginate: true` here. The /actions/variables endpoint
    // returns an envelope `{ total_count, variables: [] }`. With --paginate,
    // `gh` outputs one envelope per page as concatenated JSON objects (not valid
    // JSON). Instead use per_page=100 (API max).
    // Known limitation: repos with >100 variables will be truncated. If needed,
    // implement manual pagination using per_page + page params.
    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/variables?per_page=100`;
    const result = await this.api.call("GET", endpoint, {
      options,
    });

    const response = parseApiJson<GitHubVariablesListResponse>(
      result,
      "variables response"
    );
    return response.variables;
  }

  async create(
    repoInfo: RepoInfo,
    name: string,
    value: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Variables strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/variables`;
    await this.api.call("POST", endpoint, {
      payload: { name, value },
      options,
    });
  }

  async update(
    repoInfo: RepoInfo,
    name: string,
    value: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Variables strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/variables/${encodeURIComponent(name)}`;
    await this.api.call("PATCH", endpoint, {
      payload: { name, value },
      options,
    });
  }

  async delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Variables strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/variables/${encodeURIComponent(name)}`;
    await this.api.call("DELETE", endpoint, { options });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --grep "GitHubVariablesStrategy"` Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/settings/variables/types.ts src/settings/variables/github-variables-strategy.ts test/unit/settings/variables/github-variables-strategy.test.ts
git commit -m "feat(variables): add strategy types and GitHub implementation"
```

______________________________________________________________________

### Task 4: Variables Diff and Formatter

**Files:**

- Create: `src/settings/variables/diff.ts`

- Create: `src/settings/variables/formatter.ts`

- Test: `test/unit/settings/variables/diff.test.ts`

- Test: `test/unit/settings/variables/formatter.test.ts`

- [ ] **Step 1: Write failing tests for variables diff**

```typescript
// test/unit/settings/variables/diff.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { diffVariables } from "../../../../src/settings/variables/diff.js";
import type { GitHubVariable } from "../../../../src/settings/variables/types.js";

function makeVariable(name: string, value: string): GitHubVariable {
  return {
    name,
    value,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };
}

describe("diffVariables", () => {
  test("detects new variables to create", () => {
    const current: GitHubVariable[] = [];
    const desired: Record<string, string> = { NEW_VAR: "value" };

    const changes = diffVariables(current, desired, false);

    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "create");
    assert.equal(changes[0].name, "NEW_VAR");
  });

  test("detects unchanged variables", () => {
    const current = [makeVariable("MY_VAR", "same-value")];
    const desired: Record<string, string> = { MY_VAR: "same-value" };

    const changes = diffVariables(current, desired, false);

    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "unchanged");
  });

  test("detects value changes for update", () => {
    const current = [makeVariable("MY_VAR", "old-value")];
    const desired: Record<string, string> = { MY_VAR: "new-value" };

    const changes = diffVariables(current, desired, false);

    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "update");
    assert.equal(changes[0].oldValue, "old-value");
    assert.equal(changes[0].newValue, "new-value");
  });

  test("detects orphans for deletion when deleteOrphaned is true", () => {
    const current = [makeVariable("ORPHAN", "value")];
    const desired: Record<string, string> = {};

    const changes = diffVariables(current, desired, true);

    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "delete");
    assert.equal(changes[0].name, "ORPHAN");
  });

  test("does not delete orphans when deleteOrphaned is false", () => {
    const current = [makeVariable("ORPHAN", "value")];
    const desired: Record<string, string> = {};

    const changes = diffVariables(current, desired, false);

    assert.equal(changes.length, 0);
  });

  test("matches variable names case-insensitively", () => {
    const current = [makeVariable("my_var", "value")];
    const desired: Record<string, string> = { MY_VAR: "value" };

    const changes = diffVariables(current, desired, false);

    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "unchanged");
  });

  test("sorts changes: delete, update, create, unchanged", () => {
    const current = [
      makeVariable("DELETE_ME", "val"),
      makeVariable("UPDATE_ME", "old"),
      makeVariable("KEEP_ME", "same"),
    ];
    const desired: Record<string, string> = {
      UPDATE_ME: "new",
      KEEP_ME: "same",
      CREATE_ME: "val",
    };

    const changes = diffVariables(current, desired, true);

    assert.equal(changes[0].action, "delete");
    assert.equal(changes[1].action, "update");
    assert.equal(changes[2].action, "create");
    assert.equal(changes[3].action, "unchanged");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --grep "diffVariables"` Expected: FAIL

- [ ] **Step 3: Implement diffVariables**

```typescript
// src/settings/variables/diff.ts
import type { GitHubVariable } from "./types.js";
import type { SettingsAction } from "../base-processor.js";

export type VariableAction = SettingsAction;

export interface VariableChange {
  action: VariableAction;
  name: string;
  oldValue?: string;
  newValue?: string;
}

export function diffVariables(
  current: GitHubVariable[],
  desired: Record<string, string>,
  deleteOrphaned: boolean
): VariableChange[] {
  const changes: VariableChange[] = [];

  const currentByName = new Map<string, GitHubVariable>();
  for (const v of current) {
    currentByName.set(v.name.toUpperCase(), v);
  }

  const desiredUpper = new Set(
    Object.keys(desired).map((n) => n.toUpperCase())
  );

  for (const [name, desiredValue] of Object.entries(desired)) {
    const currentVar = currentByName.get(name.toUpperCase());

    if (!currentVar) {
      changes.push({ action: "create", name, newValue: desiredValue });
    } else if (currentVar.value !== desiredValue) {
      changes.push({
        action: "update",
        name,
        oldValue: currentVar.value,
        newValue: desiredValue,
      });
    } else {
      changes.push({ action: "unchanged", name });
    }
  }

  if (deleteOrphaned) {
    for (const [nameUpper, currentVar] of currentByName) {
      if (!desiredUpper.has(nameUpper)) {
        changes.push({ action: "delete", name: currentVar.name });
      }
    }
  }

  const actionOrder: Record<VariableAction, number> = {
    delete: 0,
    update: 1,
    create: 2,
    unchanged: 3,
  };

  return changes.sort(
    (a, b) => actionOrder[a.action] - actionOrder[b.action]
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "diffVariables"` Expected: PASS

- [ ] **Step 5: Write failing tests for variables formatter**

```typescript
// test/unit/settings/variables/formatter.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatVariablesPlan } from "../../../../src/settings/variables/formatter.js";
import type { VariableChange } from "../../../../src/settings/variables/diff.js";

describe("formatVariablesPlan", () => {
  test("formats creates, updates, deletes, and unchanged", () => {
    const changes: VariableChange[] = [
      { action: "delete", name: "OLD_VAR" },
      { action: "update", name: "UPD_VAR", oldValue: "old", newValue: "new" },
      { action: "create", name: "NEW_VAR", newValue: "val" },
      { action: "unchanged", name: "KEEP_VAR" },
    ];

    const result = formatVariablesPlan(changes);

    assert.equal(result.creates, 1);
    assert.equal(result.updates, 1);
    assert.equal(result.deletes, 1);
    assert.equal(result.unchanged, 1);
    assert.equal(result.entries.length, 4);
    assert.ok(result.lines.length > 0);
  });

  test("returns empty output for no changes", () => {
    const result = formatVariablesPlan([]);
    assert.equal(result.creates, 0);
    assert.equal(result.entries.length, 0);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- --grep "formatVariablesPlan"` Expected: FAIL

- [ ] **Step 7: Implement formatVariablesPlan**

```typescript
// src/settings/variables/formatter.ts
import chalk from "chalk";
import type { VariableChange, VariableAction } from "./diff.js";
import { countActions } from "../base-processor.js";

export interface VariablesPlanEntry {
  name: string;
  action: VariableAction;
  oldValue?: string;
  newValue?: string;
}

export interface VariablesPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  entries: VariablesPlanEntry[];
}

export function formatVariablesPlan(
  changes: VariableChange[]
): VariablesPlanResult {
  const lines: string[] = [];
  const entries: VariablesPlanEntry[] = [];

  const {
    create: creates,
    update: updates,
    delete: deletes,
    unchanged,
  } = countActions(changes);

  const grouped: Record<VariableAction, VariableChange[]> = {
    create: [],
    update: [],
    delete: [],
    unchanged: [],
  };
  for (const c of changes) {
    grouped[c.action].push(c);
  }

  if (grouped.create.length > 0) {
    lines.push(chalk.bold("  Create:"));
    for (const change of grouped.create) {
      lines.push(chalk.green(`    + variable "${change.name}"`));
      if (change.newValue !== undefined) {
        lines.push(chalk.green(`        value: "${change.newValue}"`));
      }
      entries.push({
        name: change.name,
        action: "create",
        newValue: change.newValue,
      });
      lines.push("");
    }
  }

  if (grouped.update.length > 0) {
    lines.push(chalk.bold("  Update:"));
    for (const change of grouped.update) {
      lines.push(chalk.yellow(`    ~ variable "${change.name}"`));
      lines.push(
        chalk.yellow(
          `        value: "${change.oldValue}" → "${change.newValue}"`
        )
      );
      entries.push({
        name: change.name,
        action: "update",
        oldValue: change.oldValue,
        newValue: change.newValue,
      });
      lines.push("");
    }
  }

  if (grouped.delete.length > 0) {
    lines.push(chalk.bold("  Delete:"));
    for (const change of grouped.delete) {
      lines.push(chalk.red(`    - variable "${change.name}"`));
      entries.push({ name: change.name, action: "delete" });
    }
    lines.push("");
  }

  for (const change of grouped.unchanged) {
    entries.push({ name: change.name, action: "unchanged" });
  }

  const total = creates + updates + deletes;
  if (total > 0) {
    const parts: string[] = [];
    if (creates > 0) parts.push(`${creates} to create`);
    if (updates > 0) parts.push(`${updates} to update`);
    if (deletes > 0) parts.push(`${deletes} to delete`);
    lines.push(`  Plan: ${total} variables (${parts.join(", ")})`);
  }

  return { lines, creates, updates, deletes, unchanged, entries };
}
```

- [ ] **Step 8: Run all tests**

Run: `npm test` Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/settings/variables/diff.ts src/settings/variables/formatter.ts test/unit/settings/variables/diff.test.ts test/unit/settings/variables/formatter.test.ts
git commit -m "feat(variables): add diff and formatter modules"
```

______________________________________________________________________

### Task 5: Variables Processor

**Files:**

- Create: `src/settings/variables/processor.ts`

- Test: `test/unit/settings/variables/processor.test.ts`

- [ ] **Step 1: Write failing tests for VariablesProcessor**

```typescript
// test/unit/settings/variables/processor.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { VariablesProcessor } from "../../../../src/settings/variables/processor.js";
import type {
  IVariablesStrategy,
  GitHubVariable,
} from "../../../../src/settings/variables/types.js";
import type { RepoConfig } from "../../../../src/config/index.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  RepoInfo,
} from "../../../../src/repo/index.js";
import type { GhApiOptions } from "../../../../src/shared/gh-api-utils.js";

class MockVariablesStrategy implements IVariablesStrategy {
  calls: { method: string; args: unknown[] }[] = [];
  listResponse: GitHubVariable[] = [];

  async list(
    _repoInfo: RepoInfo,
    _options?: GhApiOptions
  ): Promise<GitHubVariable[]> {
    this.calls.push({ method: "list", args: [] });
    return this.listResponse;
  }
  async create(
    _repoInfo: RepoInfo,
    name: string,
    value: string
  ): Promise<void> {
    this.calls.push({ method: "create", args: [name, value] });
  }
  async update(
    _repoInfo: RepoInfo,
    name: string,
    value: string
  ): Promise<void> {
    this.calls.push({ method: "update", args: [name, value] });
  }
  async delete(_repoInfo: RepoInfo, name: string): Promise<void> {
    this.calls.push({ method: "delete", args: [name] });
  }
}

const mockGitHubRepo: GitHubRepoInfo = {
  type: "github",
  owner: "test-org",
  repo: "test-repo",
  host: "github.com",
  gitUrl: "https://github.com/test-org/test-repo.git",
};

function makeRepoConfig(
  variables: Record<string, string>,
  deleteOrphaned = false
): RepoConfig {
  return {
    git: "https://github.com/test-org/test-repo.git",
    files: [],
    settings: { variables: { ...variables, deleteOrphaned } },
  };
}

describe("VariablesProcessor", () => {
  test("creates new variables", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [];
    const processor = new VariablesProcessor(strategy);

    const result = await processor.process(
      makeRepoConfig({ NEW_VAR: "value" }),
      mockGitHubRepo,
      {}
    );

    assert.equal(result.success, true);
    assert.equal(result.changes?.create, 1);
    const createCalls = strategy.calls.filter((c) => c.method === "create");
    assert.equal(createCalls.length, 1);
  });

  test("updates changed variables", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [
      { name: "MY_VAR", value: "old", created_at: "", updated_at: "" },
    ];
    const processor = new VariablesProcessor(strategy);

    const result = await processor.process(
      makeRepoConfig({ MY_VAR: "new" }),
      mockGitHubRepo,
      {}
    );

    assert.equal(result.success, true);
    assert.equal(result.changes?.update, 1);
  });

  test("skips unchanged variables", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [
      { name: "MY_VAR", value: "same", created_at: "", updated_at: "" },
    ];
    const processor = new VariablesProcessor(strategy);

    const result = await processor.process(
      makeRepoConfig({ MY_VAR: "same" }),
      mockGitHubRepo,
      {}
    );

    assert.equal(result.success, true);
    assert.equal(result.changes?.unchanged, 1);
    assert.equal(
      strategy.calls.filter((c) => c.method !== "list").length,
      0
    );
  });

  test("deletes orphaned variables when deleteOrphaned is true", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [
      { name: "ORPHAN", value: "val", created_at: "", updated_at: "" },
    ];
    const processor = new VariablesProcessor(strategy);

    const result = await processor.process(
      makeRepoConfig({}, true),
      mockGitHubRepo,
      {}
    );

    assert.equal(result.success, true);
    assert.equal(result.changes?.delete, 1);
  });

  test("dry run lists current state but does not mutate", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [];
    const processor = new VariablesProcessor(strategy);

    const result = await processor.process(
      makeRepoConfig({ NEW_VAR: "value" }),
      mockGitHubRepo,
      { dryRun: true }
    );

    assert.equal(result.dryRun, true);
    assert.equal(
      strategy.calls.filter((c) => c.method === "list").length,
      1,
      "list should still be called for diffing"
    );
    assert.equal(
      strategy.calls.filter((c) => c.method !== "list").length,
      0,
      "no mutating calls in dry run"
    );
  });

  test("skips non-GitHub repos", async () => {
    const strategy = new MockVariablesStrategy();
    const processor = new VariablesProcessor(strategy);
    const adoRepo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      owner: "org",
      repo: "repo",
      organization: "org",
      project: "proj",
      gitUrl: "https://dev.azure.com/org/proj/_git/repo",
    };

    const result = await processor.process(
      makeRepoConfig({ VAR: "val" }),
      adoRepo,
      {}
    );

    assert.equal(result.skipped, true);
  });

  test("skips when no variables configured", async () => {
    const strategy = new MockVariablesStrategy();
    const processor = new VariablesProcessor(strategy);

    const result = await processor.process(
      { git: "https://github.com/o/r.git", files: [], settings: {} },
      mockGitHubRepo,
      {}
    );

    assert.equal(result.skipped, true);
  });

  test("deleteOrphaned only (no variable entries) still runs processor", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [
      { name: "ORPHAN", value: "val", created_at: "", updated_at: "" },
    ];
    const processor = new VariablesProcessor(strategy);

    const result = await processor.process(
      {
        git: "https://github.com/o/r.git",
        files: [],
        settings: { variables: Object.assign({}, { deleteOrphaned: true }) },
      },
      mockGitHubRepo,
      {}
    );

    assert.equal(result.success, true);
    assert.equal(result.skipped, undefined);
    assert.equal(result.changes?.delete, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --grep "VariablesProcessor"` Expected: FAIL

- [ ] **Step 3: Implement VariablesProcessor**

```typescript
// src/settings/variables/processor.ts
import type { RepoConfig } from "../../config/index.js";
import type { GitHubRepoInfo, RepoInfo } from "../../repo/index.js";
import { diffVariables } from "./diff.js";
import { formatVariablesPlan, type VariablesPlanResult } from "./formatter.js";
import type { IVariablesStrategy } from "./types.js";
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

export type IVariablesProcessor = ISettingsProcessor<
  VariablesProcessorOptions,
  VariablesProcessorResult
>;

export interface VariablesProcessorOptions extends BaseProcessorOptions {
  noDelete?: boolean;
}

export interface VariablesProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: VariablesPlanResult;
}

export class VariablesProcessor implements IVariablesProcessor {
  private readonly strategy: IVariablesStrategy;

  constructor(strategy: IVariablesStrategy) {
    this.strategy = strategy;
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: VariablesProcessorOptions
  ): Promise<VariablesProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) => {
        const vars = rc.settings?.variables ?? {};
        const { deleteOrphaned, ...entries } = vars as Record<string, unknown>;
        return Object.keys(entries).length > 0 || deleteOrphaned === true;
      },
      emptySettingsMessage: "No variables configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async applySettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: VariablesProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<VariablesProcessorResult> {
    const { dryRun, noDelete } = options;
    const settings = repoConfig.settings;
    // Separate deleteOrphaned peer key from variable entries.
    // After normalization, `inherit` and `false` opt-outs are already stripped.
    const { deleteOrphaned: varDeleteOrphaned = false, ...desiredVariables } =
      (settings?.variables ?? {}) as Record<string, string> & { deleteOrphaned?: boolean };
    const deleteOrphaned =
      varDeleteOrphaned && !(noDelete ?? false);

    const strategyOptions = { token: effectiveToken, host: githubRepo.host };
    const currentVariables = await this.strategy.list(
      githubRepo,
      strategyOptions
    );

    const changes = diffVariables(
      currentVariables,
      desiredVariables,
      deleteOrphaned
    );
    const changeCounts = countActions(changes);
    const planOutput = formatVariablesPlan(changes);

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts, { planOutput });
    }

    let appliedCount = 0;

    for (const change of changes) {
      switch (change.action) {
        case "create":
          if (change.newValue !== undefined) {
            await this.strategy.create(
              githubRepo,
              change.name,
              change.newValue,
              strategyOptions
            );
            appliedCount++;
          }
          break;

        case "update":
          if (change.newValue !== undefined) {
            await this.strategy.update(
              githubRepo,
              change.name,
              change.newValue,
              strategyOptions
            );
            appliedCount++;
          }
          break;

        case "delete":
          await this.strategy.delete(
            githubRepo,
            change.name,
            strategyOptions
          );
          appliedCount++;
          break;

        case "unchanged":
          break;
      }
    }

    return buildApplyResult(repoName, changeCounts, appliedCount, {
      planOutput,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "VariablesProcessor"` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/settings/variables/processor.ts test/unit/settings/variables/processor.test.ts
git commit -m "feat(variables): add VariablesProcessor with diff-based sync"
```

______________________________________________________________________

### Task 6: Variables Barrel Exports, Factory, and Settings Runner Integration

**Files:**

- Create: `src/settings/variables/index.ts`

- Modify: `src/settings/index.ts`

- Modify: `src/cli/types.ts`

- Modify: `src/cli/settings-factories.ts`

- Modify: `src/cli/settings-runner.ts`

- Modify: `src/cli/settings-report-builder.ts`

- [ ] **Step 1: Create variables barrel export**

```typescript
// src/settings/variables/index.ts
export { type VariableChange, type VariableAction } from "./diff.js";
export { type VariablesPlanEntry } from "./formatter.js";
export {
  VariablesProcessor,
  type IVariablesProcessor,
} from "./processor.js";
export { GitHubVariablesStrategy } from "./github-variables-strategy.js";
```

- [ ] **Step 2: Add variables to settings barrel**

In `src/settings/index.ts`, add:

```typescript
// Variables
export {
  type VariablesPlanEntry,
  VariablesProcessor,
  type IVariablesProcessor,
  GitHubVariablesStrategy,
} from "./variables/index.js";
```

- [ ] **Step 3: Add VariablesProcessorFactory to CLI types**

In `src/cli/types.ts`, add import for `IVariablesProcessor` and:

```typescript
export type VariablesProcessorFactory =
  SettingsProcessorFactory<IVariablesProcessor>;
```

Update `SettingsKind` union (must stay in sync with `SettingsDescriptor.key` in settings-runner.ts):

```typescript
export type SettingsKind = "rulesets" | "labels" | "repo" | "codeScanning" | "variables";
```

Add `variables: VariablesProcessorFactory` to `SettingsProcessorFactories`.

- [ ] **Step 4: Add variables factory to settings-factories.ts**

Import `VariablesProcessor` and `GitHubVariablesStrategy` from settings index.

```typescript
export function createDefaultVariablesProcessorFactory(
  executor: ProcessExecutor
): VariablesProcessorFactory {
  const cwd = process.cwd();
  return () =>
    new VariablesProcessor(new GitHubVariablesStrategy(executor, { cwd }));
}
```

Add to `createDefaultFactories`:

```typescript
variables:
  overrides?.variables ?? createDefaultVariablesProcessorFactory(executor),
```

- [ ] **Step 5: Add variables to settings-runner.ts**

First, update the `SettingsDescriptor` key union in `settings-runner.ts` (line 12) to include `"variables"`:

```typescript
interface SettingsDescriptor {
  key: "rulesets" | "labels" | "repo" | "codeScanning" | "variables";
  label: string;
  run: () => Promise<SettingsResult>;
}
```

> **Note:** `applyRepoSettings` uses `Object.keys(settingsValue).length === 0` to skip empty settings. With `deleteOrphaned` as a peer key, `{ deleteOrphaned: true }` (no actual variables) will have length 1 and NOT be skipped — this is correct because `deleteOrphaned: true` with no variables means "delete all orphans." The processor's `hasDesiredSettings` guard already filters out
> `deleteOrphaned` from the entry count, so a config with only `deleteOrphaned` will still run the processor to handle orphan deletion.

Then in `buildSettingsDescriptors`, add entry:

```typescript
{
  key: "variables" as const,
  label: "Variables",
  run: () =>
    runAndStoreResult(
      factories.variables,
      repoConfig,
      repoInfo,
      sharedOpts,
      repoName,
      settingsCollector,
      (e, r) => {
        e.variablesResult = r;
      }
    ),
},
```

- [ ] **Step 6: Add variablesResult to ProcessorResults in settings-report-builder.ts**

```typescript
// Add import at top of file:
import type { VariablesPlanEntry } from "../settings/index.js";
```

Then add to the `ProcessorResults` interface:

```typescript
variablesResult?: {
  planOutput?: {
    entries?: VariablesPlanEntry[];
  };
};
```

- [ ] **Step 7: Verify build compiles**

Run: `npm run build` Expected: PASS

- [ ] **Step 8: Run all tests**

Run: `npm test` Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/settings/variables/index.ts src/settings/index.ts src/cli/types.ts src/cli/settings-factories.ts src/cli/settings-runner.ts src/cli/settings-report-builder.ts
git commit -m "feat(variables): integrate into settings sync pipeline"
```

______________________________________________________________________

### Task 7: Config Normalizer for Variables

**Files:**

- Modify: `src/config/normalizer.ts`

- Test: `test/unit/config/normalizer.test.ts`

- [ ] **Step 1: Write failing tests for variables normalization**

```typescript
describe("mergeSettings variables", () => {
  test("merges root variables into repo settings", () => {
    const root: RawRootSettings = {
      variables: { ROOT_VAR: "root-value" },
    };
    const result = mergeSettings(root, undefined);

    assert.deepStrictEqual(result?.variables, { ROOT_VAR: "root-value" });
  });

  test("per-repo variables override root", () => {
    const root: RawRootSettings = {
      variables: { SHARED: "root" },
    };
    const perRepo: RawRepoSettings = {
      variables: { SHARED: "repo" },
    };
    const result = mergeSettings(root, perRepo);

    assert.equal(result?.variables?.SHARED, "repo");
  });

  test("per-repo inherit false discards root variables", () => {
    const root: RawRootSettings = {
      variables: { ROOT_VAR: "value" },
    };
    const perRepo: RawRepoSettings = {
      variables: Object.assign({ REPO_VAR: "val" }, { inherit: false }),
    };
    const result = mergeSettings(root, perRepo);

    assert.equal(result?.variables?.ROOT_VAR, undefined);
    assert.equal(result?.variables?.REPO_VAR, "val");
  });

  test("merges deleteOrphaned peer key from root variables", () => {
    const root: RawRootSettings = {
      variables: Object.assign({ ROOT_VAR: "value" }, { deleteOrphaned: true }),
    };
    const result = mergeSettings(root, undefined);

    assert.equal(result?.variables?.ROOT_VAR, "value");
    assert.equal((result?.variables as Record<string, unknown>)?.deleteOrphaned, true);
  });

  test("per-repo deleteOrphaned overrides root deleteOrphaned", () => {
    const root: RawRootSettings = {
      variables: Object.assign({ ROOT_VAR: "value" }, { deleteOrphaned: true }),
    };
    const perRepo: RawRepoSettings = {
      variables: Object.assign({ ROOT_VAR: "value" }, { deleteOrphaned: false }),
    };
    const result = mergeSettings(root, perRepo);

    assert.equal((result?.variables as Record<string, unknown>)?.deleteOrphaned, false);
  });

  test("per-repo variable: false opts out of root variable", () => {
    const root: RawRootSettings = {
      variables: { ROOT_VAR: "value", KEEP: "yes" },
    };
    const perRepo: RawRepoSettings = {
      variables: { ROOT_VAR: false as unknown as string },
    };
    const result = mergeSettings(root, perRepo);

    assert.equal(result?.variables?.ROOT_VAR, undefined);
    assert.equal(result?.variables?.KEEP, "yes");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --grep "mergeSettings variables"` Expected: FAIL

- [ ] **Step 3: Implement variables merging in normalizer.ts**

In `mergeSettings`, add variables merging after the labels section:

```typescript
// Variables merging — deleteOrphaned is a peer key (like secrets' deleteOrphaned)
if (root?.variables || perRepo?.variables) {
  const rootVars = root?.variables ?? {};
  const repoVars = perRepo?.variables ?? {};

  // Preserve deleteOrphaned from whichever level sets it (per-repo overrides root)
  const rootDeleteOrphaned = (rootVars as Record<string, unknown>).deleteOrphaned;
  const repoDeleteOrphaned = (repoVars as Record<string, unknown>).deleteOrphaned;
  const effectiveDeleteOrphaned = repoDeleteOrphaned ?? rootDeleteOrphaned;

  const inherit = (repoVars as Record<string, unknown>).inherit;
  if (inherit === false) {
    const { inherit: _, deleteOrphaned: _d, ...rest } = repoVars as Record<string, unknown>;
    result.variables = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== false)
    ) as Record<string, string>;
  } else {
    const combined = { ...rootVars, ...repoVars };
    const { inherit: _, deleteOrphaned: _d, ...rest } = combined as Record<string, unknown>;
    result.variables = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== false)
    ) as Record<string, string>;
  }

  if (effectiveDeleteOrphaned !== undefined) {
    (result.variables as Record<string, unknown>).deleteOrphaned = effectiveDeleteOrphaned;
  }

  // Only delete if no variable entries remain (deleteOrphaned alone is not actionable)
  const { deleteOrphaned: _check, ...varEntries } = result.variables as Record<string, unknown>;
  if (Object.keys(varEntries).length === 0 && !effectiveDeleteOrphaned) {
    delete result.variables;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "mergeSettings variables"` Expected: PASS

- [ ] **Step 5: Add variables merging to `mergeRawSettings`**

`mergeRawSettings` is used for group-level settings inheritance. Without this, group-level variables are silently dropped. Note: `mergeNamedEntries` won't work for variables because it checks `typeof entry === "object"` and variable values are strings. Use a custom overlay merge with `false` opt-outs and `inherit` support.

In `mergeRawSettings`, add variables merging after the `codeScanning` section (before the `deleteOrphaned` handling):

```typescript
// Variables: simple string values with false opt-outs (mergeNamedEntries won't work for strings)
if (overlay.variables) {
  const overlayVars = overlay.variables as Record<string, unknown>;
  const inherit = overlayVars.inherit !== false;
  const base = inherit ? { ...(result.variables ?? {}) } : {};
  for (const [name, entry] of Object.entries(overlay.variables)) {
    if (name === "inherit" || name === "deleteOrphaned") continue;
    (base as Record<string, unknown>)[name] = entry;
  }
  const overlayDelete = overlayVars.deleteOrphaned;
  if (overlayDelete !== undefined) {
    (base as Record<string, unknown>).deleteOrphaned = overlayDelete;
  }
  result.variables = base as typeof result.variables;
}
```

- [ ] **Step 6: Write test for group-level variables merging**

Add a test to verify group-level variables are merged via `mergeRawSettings`:

```typescript
describe("mergeRawSettings variables", () => {
  test("group-level variables merge into root settings", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      settings: {
        variables: { ROOT_VAR: "root-value" },
      },
      groups: {
        myGroup: {
          settings: {
            variables: { GROUP_VAR: "group-value" },
          },
        },
      },
      repos: [
        {
          git: "https://github.com/o/r.git",
          groups: ["myGroup"],
        },
      ],
    };
    const config = normalizeConfig(raw, {});

    assert.equal(config.repos[0].settings?.variables?.ROOT_VAR, "root-value");
    assert.equal(config.repos[0].settings?.variables?.GROUP_VAR, "group-value");
  });

  test("group-level variables override root variables", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      settings: {
        variables: { SHARED: "root" },
      },
      groups: {
        myGroup: {
          settings: {
            variables: { SHARED: "group" },
          },
        },
      },
      repos: [
        {
          git: "https://github.com/o/r.git",
          groups: ["myGroup"],
        },
      ],
    };
    const config = normalizeConfig(raw, {});

    assert.equal(config.repos[0].settings?.variables?.SHARED, "group");
  });

  test("group-level inherit: false discards root variables", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      settings: {
        variables: { ROOT_VAR: "value" },
      },
      groups: {
        myGroup: {
          settings: {
            variables: Object.assign({ GROUP_VAR: "val" }, { inherit: false }),
          },
        },
      },
      repos: [
        {
          git: "https://github.com/o/r.git",
          groups: ["myGroup"],
        },
      ],
    };
    const config = normalizeConfig(raw, {});

    assert.equal(config.repos[0].settings?.variables?.ROOT_VAR, undefined);
    assert.equal(config.repos[0].settings?.variables?.GROUP_VAR, "val");
  });
});
```

- [ ] **Step 7: Run all tests**

Run: `npm test` Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/config/normalizer.ts test/unit/config/normalizer.test.ts
git commit -m "feat(config): add variables merging to normalizer"
```

______________________________________________________________________

### Task 8: Env Resolver and Encryption Module

**Files:**

- Create: `src/shared/env-resolver.ts`

- Create: `src/secrets/encryption.ts`

- Test: `test/unit/shared/env-resolver.test.ts`

- Test: `test/unit/secrets/encryption.test.ts`

- [ ] **Step 1: Write failing tests for EnvResolver**

```typescript
// test/unit/shared/env-resolver.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EnvResolver } from "../../../src/shared/env-resolver.js";

describe("EnvResolver", () => {
  test("resolves existing env var", () => {
    const resolver = new EnvResolver({ MY_VAR: "my-value" });
    assert.equal(resolver.resolve("MY_VAR"), "my-value");
  });

  test("throws for missing env var", () => {
    const resolver = new EnvResolver({});
    assert.throws(
      () => resolver.resolve("MISSING"),
      /environment variable.*MISSING.*not set/i
    );
  });

  test("throws for empty env var", () => {
    const resolver = new EnvResolver({ EMPTY: "" });
    assert.throws(
      () => resolver.resolve("EMPTY"),
      /environment variable.*EMPTY.*empty/i
    );
  });

  test("resolveAll returns all values or throws with all missing", () => {
    const resolver = new EnvResolver({ A: "val-a" });
    assert.throws(
      () =>
        resolver.resolveAll([
          { name: "SEC1", envVar: "A" },
          { name: "SEC2", envVar: "B" },
          { name: "SEC3", envVar: "C" },
        ]),
      /B.*C/
    );
  });

  test("resolveAll returns map when all present", () => {
    const resolver = new EnvResolver({ A: "val-a", B: "val-b" });
    const result = resolver.resolveAll([
      { name: "SEC1", envVar: "A" },
      { name: "SEC2", envVar: "B" },
    ]);
    assert.equal(result.get("SEC1"), "val-a");
    assert.equal(result.get("SEC2"), "val-b");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --grep "EnvResolver"` Expected: FAIL

- [ ] **Step 3: Implement EnvResolver**

```typescript
// src/shared/env-resolver.ts
export interface IEnvResolver {
  resolve(envName: string): string;
  resolveAll(
    entries: { name: string; envVar: string }[]
  ): Map<string, string>;
}

export class EnvResolver implements IEnvResolver {
  private readonly env: Record<string, string | undefined>;

  constructor(env: Record<string, string | undefined>) {
    this.env = env;
  }

  resolve(envName: string): string {
    const value = this.env[envName];
    if (value === undefined) {
      throw new Error(
        `Environment variable '${envName}' is not set.`
      );
    }
    if (value === "") {
      throw new Error(
        `Environment variable '${envName}' is empty.`
      );
    }
    return value;
  }

  resolveAll(
    entries: { name: string; envVar: string }[]
  ): Map<string, string> {
    const missing: string[] = [];
    const result = new Map<string, string>();

    for (const { name, envVar } of entries) {
      const value = this.env[envVar];
      if (value === undefined || value === "") {
        missing.push(envVar);
      } else {
        result.set(name, value);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing environment variables: ${missing.join(", ")}`
      );
    }

    return result;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "EnvResolver"` Expected: PASS

- [ ] **Step 5: Write failing tests for SecretEncryptor**

```typescript
// test/unit/secrets/encryption.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SodiumEncryptor } from "../../../src/secrets/encryption.js";

describe("SodiumEncryptor", () => {
  test("encrypt returns base64 string", async () => {
    const encryptor = new SodiumEncryptor();

    const testKey = Buffer.from(new Uint8Array(32).fill(1)).toString(
      "base64"
    );
    const result = await encryptor.encrypt("test-secret-value", testKey);

    assert.equal(typeof result, "string");
    assert.doesNotThrow(() => Buffer.from(result, "base64"));
    const decoded = Buffer.from(result, "base64");
    assert.ok(decoded.length > 48);
  });

  test("encrypt produces different output each call (nonce)", async () => {
    const encryptor = new SodiumEncryptor();

    const testKey = Buffer.from(new Uint8Array(32).fill(1)).toString(
      "base64"
    );
    const result1 = await encryptor.encrypt("same-value", testKey);
    const result2 = await encryptor.encrypt("same-value", testKey);

    assert.notEqual(result1, result2);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- --grep "SodiumEncryptor"` Expected: FAIL

- [ ] **Step 7: Install libsodium-wrappers and implement SodiumEncryptor**

```bash
npm install libsodium-wrappers
npm install -D @types/libsodium-wrappers
```

```typescript
// src/secrets/encryption.ts
import type _sodium from "libsodium-wrappers";

export interface ISecretEncryptor {
  encrypt(value: string, publicKeyBase64: string): Promise<string>;
}

export class SodiumEncryptor implements ISecretEncryptor {
  private sodium: typeof _sodium | undefined;

  private async ensureInitialized(): Promise<typeof _sodium> {
    if (!this.sodium) {
      try {
        const sodium = await import("libsodium-wrappers");
        await sodium.default.ready;
        this.sodium = sodium.default;
      } catch {
        throw new Error(
          "Failed to load libsodium-wrappers. Install it: npm install libsodium-wrappers"
        );
      }
    }
    return this.sodium;
  }

  async encrypt(
    value: string,
    publicKeyBase64: string
  ): Promise<string> {
    const sodium = await this.ensureInitialized();

    const messageBytes = sodium.from_string(value);
    const publicKey = sodium.from_base64(
      publicKeyBase64,
      sodium.base64_variants.ORIGINAL
    );

    const encrypted = sodium.crypto_box_seal(messageBytes, publicKey);

    return sodium.to_base64(
      encrypted,
      sodium.base64_variants.ORIGINAL
    );
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- --grep "SodiumEncryptor"` Expected: PASS

- [ ] **Step 9: Run all tests**

Run: `npm test` Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/shared/env-resolver.ts src/secrets/encryption.ts test/unit/shared/env-resolver.test.ts test/unit/secrets/encryption.test.ts package.json package-lock.json
git commit -m "feat(secrets): add env resolver and sodium encryption module"
```

______________________________________________________________________

### Task 9: Secrets Strategy Types and GitHub Implementation

**Files:**

- Create: `src/secrets/types.ts`

- Create: `src/secrets/github-secrets-strategy.ts`

- Test: `test/unit/secrets/github-secrets-strategy.test.ts`

- [ ] **Step 1: Create secrets types**

```typescript
// src/secrets/types.ts
import type { RepoInfo } from "../repo/index.js";
import type { GhApiOptions } from "../shared/gh-api-utils.js";

export interface GitHubSecret {
  name: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubSecretsListResponse {
  total_count: number;
  secrets: GitHubSecret[];
}

export interface GitHubPublicKey {
  key_id: string;
  key: string;
}

export interface ISecretsStrategy {
  list(repoInfo: RepoInfo, options?: GhApiOptions): Promise<GitHubSecret[]>;
  getPublicKey(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubPublicKey>;
  upsert(
    repoInfo: RepoInfo,
    name: string,
    encryptedValue: string,
    keyId: string,
    options?: GhApiOptions
  ): Promise<void>;
  delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void>;
}
```

- [ ] **Step 2: Write failing tests for GitHubSecretsStrategy**

```typescript
// test/unit/secrets/github-secrets-strategy.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GitHubSecretsStrategy } from "../../../src/secrets/github-secrets-strategy.js";
import type {
  ICommandExecutor,
  ExecOptions,
} from "../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../src/repo/index.js";

class MockExecutor implements ICommandExecutor {
  calls: { executable: string; args: string[] }[] = [];
  response = "";

  async exec(
    executable: string,
    args: string[],
    _cwd: string,
    _options?: ExecOptions
  ): Promise<string> {
    this.calls.push({ executable, args });
    return this.response;
  }
}

const mockRepo: GitHubRepoInfo = {
  type: "github",
  owner: "test-org",
  repo: "test-repo",
  host: "github.com",
  gitUrl: "https://github.com/test-org/test-repo.git",
};

describe("GitHubSecretsStrategy", () => {
  test("list calls correct API endpoint", async () => {
    const executor = new MockExecutor();
    executor.response = JSON.stringify({
      total_count: 1,
      secrets: [
        {
          name: "MY_SECRET",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    const strategy = new GitHubSecretsStrategy(executor, { cwd: "/tmp" });

    const result = await strategy.list(mockRepo);

    assert.equal(result.length, 1);
    assert.equal(result[0].name, "MY_SECRET");
    assert.ok(
      executor.calls[0].args.some((a) =>
        a.startsWith("/repos/test-org/test-repo/actions/secrets")
      )
    );
  });

  test("getPublicKey returns key and key_id", async () => {
    const executor = new MockExecutor();
    executor.response = JSON.stringify({
      key_id: "key-123",
      key: "base64pubkey==",
    });
    const strategy = new GitHubSecretsStrategy(executor, { cwd: "/tmp" });

    const result = await strategy.getPublicKey(mockRepo);

    assert.equal(result.key_id, "key-123");
    assert.equal(result.key, "base64pubkey==");
  });

  test("upsert calls PUT with encrypted value and key_id", async () => {
    const executor = new MockExecutor();
    executor.response = "";
    const strategy = new GitHubSecretsStrategy(executor, { cwd: "/tmp" });

    await strategy.upsert(
      mockRepo,
      "MY_SECRET",
      "encrypted-base64",
      "key-123"
    );

    const call = executor.calls[0];
    assert.ok(call.args.some((a) => a.includes("PUT")));
  });

  test("delete calls DELETE endpoint", async () => {
    const executor = new MockExecutor();
    executor.response = "";
    const strategy = new GitHubSecretsStrategy(executor, { cwd: "/tmp" });

    await strategy.delete(mockRepo, "MY_SECRET");

    const call = executor.calls[0];
    assert.ok(call.args.some((a) => a.includes("DELETE")));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --grep "GitHubSecretsStrategy"` Expected: FAIL

- [ ] **Step 4: Implement GitHubSecretsStrategy**

```typescript
// src/secrets/github-secrets-strategy.ts
import type { ICommandExecutor } from "../shared/command-executor.js";
import { assertGitHubRepo, type RepoInfo } from "../repo/index.js";
import { GhApiClient, type GhApiOptions } from "../shared/gh-api-utils.js";
import { parseApiJson } from "../shared/json-utils.js";
import type {
  ISecretsStrategy,
  GitHubSecret,
  GitHubSecretsListResponse,
  GitHubPublicKey,
} from "./types.js";

interface GitHubSecretsStrategyOptions {
  retries?: number;
  cwd: string;
}

export class GitHubSecretsStrategy implements ISecretsStrategy {
  private api: GhApiClient;

  constructor(
    executor: ICommandExecutor,
    options: GitHubSecretsStrategyOptions
  ) {
    this.api = new GhApiClient(executor, options.retries ?? 3, options.cwd);
  }

  async list(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubSecret[]> {
    assertGitHubRepo(repoInfo, "GitHub Secrets strategy");

    // Envelope endpoint — don't use --paginate (see variables strategy comment).
    // Known limitation: repos with >100 secrets will be truncated.
    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/secrets?per_page=100`;
    const result = await this.api.call("GET", endpoint, {
      options,
    });

    const response = parseApiJson<GitHubSecretsListResponse>(
      result,
      "secrets response"
    );
    return response.secrets;
  }

  async getPublicKey(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<GitHubPublicKey> {
    assertGitHubRepo(repoInfo, "GitHub Secrets strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/secrets/public-key`;
    const result = await this.api.call("GET", endpoint, { options });

    return parseApiJson<GitHubPublicKey>(result, "public key response");
  }

  async upsert(
    repoInfo: RepoInfo,
    name: string,
    encryptedValue: string,
    keyId: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Secrets strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/secrets/${encodeURIComponent(name)}`;
    await this.api.call("PUT", endpoint, {
      payload: { encrypted_value: encryptedValue, key_id: keyId },
      options,
    });
  }

  async delete(
    repoInfo: RepoInfo,
    name: string,
    options?: GhApiOptions
  ): Promise<void> {
    assertGitHubRepo(repoInfo, "GitHub Secrets strategy");

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/secrets/${encodeURIComponent(name)}`;
    await this.api.call("DELETE", endpoint, { options });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --grep "GitHubSecretsStrategy"` Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/secrets/types.ts src/secrets/github-secrets-strategy.ts test/unit/secrets/github-secrets-strategy.test.ts
git commit -m "feat(secrets): add strategy types and GitHub implementation"
```

______________________________________________________________________

### Task 10: Secrets Processor

**Files:**

- Create: `src/secrets/processor.ts`

- Test: `test/unit/secrets/processor.test.ts`

- [ ] **Step 1: Write failing tests for SecretsProcessor**

```typescript
// test/unit/secrets/processor.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SecretsProcessor } from "../../../src/secrets/processor.js";
import type {
  ISecretsStrategy,
  GitHubSecret,
  GitHubPublicKey,
} from "../../../src/secrets/types.js";
import type { ISecretEncryptor } from "../../../src/secrets/encryption.js";
import type { IEnvResolver } from "../../../src/shared/env-resolver.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  RepoInfo,
} from "../../../src/repo/index.js";
import type { GhApiOptions } from "../../../src/shared/gh-api-utils.js";
import type { SecretConfig } from "../../../src/config/index.js";

class MockSecretsStrategy implements ISecretsStrategy {
  calls: { method: string; args: unknown[] }[] = [];
  listResponse: GitHubSecret[] = [];
  publicKey: GitHubPublicKey = { key_id: "key-1", key: "pubkey==" };

  async list(
    _r: RepoInfo,
    _o?: GhApiOptions
  ): Promise<GitHubSecret[]> {
    this.calls.push({ method: "list", args: [] });
    return this.listResponse;
  }
  async getPublicKey(
    _r: RepoInfo,
    _o?: GhApiOptions
  ): Promise<GitHubPublicKey> {
    this.calls.push({ method: "getPublicKey", args: [] });
    return this.publicKey;
  }
  async upsert(
    _r: RepoInfo,
    name: string,
    encrypted: string,
    keyId: string
  ): Promise<void> {
    this.calls.push({
      method: "upsert",
      args: [name, encrypted, keyId],
    });
  }
  async delete(_r: RepoInfo, name: string): Promise<void> {
    this.calls.push({ method: "delete", args: [name] });
  }
}

class MockEncryptor implements ISecretEncryptor {
  async encrypt(value: string, _key: string): Promise<string> {
    return Buffer.from(`encrypted:${value}`).toString("base64");
  }
}

class MockEnvResolver implements IEnvResolver {
  values: Map<string, string>;
  constructor(values: Record<string, string>) {
    this.values = new Map(Object.entries(values));
  }
  resolve(name: string): string {
    const v = this.values.get(name);
    if (!v) throw new Error(`Missing env var: ${name}`);
    return v;
  }
  resolveAll(
    entries: { name: string; envVar: string }[]
  ): Map<string, string> {
    const missing: string[] = [];
    const result = new Map<string, string>();
    for (const { name, envVar } of entries) {
      const v = this.values.get(envVar);
      if (!v) {
        missing.push(envVar);
      } else {
        result.set(name, v);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Missing environment variables: ${missing.join(", ")}`
      );
    }
    return result;
  }
}

const mockGitHubRepo: GitHubRepoInfo = {
  type: "github",
  owner: "test-org",
  repo: "test-repo",
  host: "github.com",
  gitUrl: "https://github.com/test-org/test-repo.git",
};

/** Build a flat secrets config matching the type:
 *  Record<string, SecretConfig | boolean> & { deleteOrphaned?: boolean } */
function makeSecretsConfig(
  secrets: Record<string, SecretConfig>,
  deleteOrphaned = false
): Record<string, SecretConfig | boolean> & { deleteOrphaned?: boolean } {
  return { ...secrets, deleteOrphaned };
}

describe("SecretsProcessor", () => {
  test("upserts all configured secrets", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [];
    const envResolver = new MockEnvResolver({
      TOKEN_SOURCE: "secret-value",
    });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      envResolver
    );

    const result = await processor.process(
      makeSecretsConfig({ DEPLOY_TOKEN: { env: "TOKEN_SOURCE" } }),
      mockGitHubRepo,
      {}
    );

    assert.equal(result.success, true);
    assert.equal(result.created, 1);
    const upsertCalls = strategy.calls.filter(
      (c) => c.method === "upsert"
    );
    assert.equal(upsertCalls.length, 1);
  });

  test("detects existing secrets as updates", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "DEPLOY_TOKEN", created_at: "", updated_at: "" },
    ];
    const envResolver = new MockEnvResolver({
      TOKEN_SOURCE: "new-value",
    });
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      envResolver
    );

    const result = await processor.process(
      makeSecretsConfig({ DEPLOY_TOKEN: { env: "TOKEN_SOURCE" } }),
      mockGitHubRepo,
      {}
    );

    assert.equal(result.success, true);
    assert.equal(result.updated, 1);
  });

  test("deletes orphaned secrets when deleteOrphaned is true", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [
      { name: "OLD_SECRET", created_at: "", updated_at: "" },
    ];
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({})
    );

    const result = await processor.process(
      makeSecretsConfig({}, true),
      mockGitHubRepo,
      {}
    );

    assert.equal(result.deleted, 1);
    const deleteCalls = strategy.calls.filter(
      (c) => c.method === "delete"
    );
    assert.equal(deleteCalls.length, 1);
  });

  test("dry run does not call upsert or delete", async () => {
    const strategy = new MockSecretsStrategy();
    strategy.listResponse = [];
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({ SRC: "val" })
    );

    const result = await processor.process(
      makeSecretsConfig({ MY_SECRET: { env: "SRC" } }),
      mockGitHubRepo,
      { dryRun: true }
    );

    assert.equal(result.dryRun, true);
    const mutatingCalls = strategy.calls.filter(
      (c) => c.method !== "list"
    );
    assert.equal(mutatingCalls.length, 0);
  });

  test("fails fast when env vars are missing", async () => {
    const strategy = new MockSecretsStrategy();
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({})
    );

    await assert.rejects(
      () =>
        processor.process(
          makeSecretsConfig({ SEC: { env: "MISSING_VAR" } }),
          mockGitHubRepo,
          {}
        ),
      /MISSING_VAR/
    );
  });

  test("skips non-GitHub repos", async () => {
    const strategy = new MockSecretsStrategy();
    const processor = new SecretsProcessor(
      strategy,
      new MockEncryptor(),
      new MockEnvResolver({})
    );
    const adoRepo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      owner: "org",
      repo: "repo",
      organization: "org",
      project: "proj",
      gitUrl: "https://dev.azure.com/org/proj/_git/repo",
    };

    const result = await processor.process(
      makeSecretsConfig({ SEC: { env: "VAR" } }),
      adoRepo,
      {}
    );

    assert.equal(result.skipped, true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --grep "SecretsProcessor"` Expected: FAIL

- [ ] **Step 3: Implement SecretsProcessor**

```typescript
// src/secrets/processor.ts
import {
  isGitHubRepo,
  getRepoDisplayName,
  type GitHubRepoInfo,
  type RepoInfo,
} from "../repo/index.js";
import type { ISecretsStrategy } from "./types.js";
import type { ISecretEncryptor } from "./encryption.js";
import type { IEnvResolver } from "../shared/env-resolver.js";
import type { SecretConfig } from "../config/index.js";

/** Flat secrets config: Record<name, SecretConfig | boolean> & { deleteOrphaned?: boolean }.
 *  The `| boolean` allows the deleteOrphaned peer key (same pattern as labels' inherit).
 *  When iterating secret entries, filter out boolean values. */
type SecretsConfig = Record<string, SecretConfig | boolean> & {
  deleteOrphaned?: boolean;
};

export interface SecretsProcessorOptions {
  dryRun?: boolean;
  token?: string;
  noDelete?: boolean;
}

export interface SecretsProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  skipped?: boolean;
  dryRun?: boolean;
  created: number;
  updated: number;
  deleted: number;
}

export class SecretsProcessor {
  constructor(
    private readonly strategy: ISecretsStrategy,
    private readonly encryptor: ISecretEncryptor,
    private readonly envResolver: IEnvResolver
  ) {}

  async process(
    secretsConfig: SecretsConfig,
    repoInfo: RepoInfo,
    options: SecretsProcessorOptions
  ): Promise<SecretsProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);

    if (!isGitHubRepo(repoInfo)) {
      return {
        success: true,
        repoName,
        message: "Skipped: not a GitHub repository",
        skipped: true,
        created: 0,
        updated: 0,
        deleted: 0,
      };
    }

    const githubRepo = repoInfo as GitHubRepoInfo;
    // Separate deleteOrphaned flag from secret entries (same pattern as labels' inherit)
    const { deleteOrphaned: configDeleteOrphaned = false, ...rawEntries } = secretsConfig;
    const { dryRun, token, noDelete } = options;
    const deleteOrphaned = configDeleteOrphaned && !(noDelete ?? false);
    const strategyOptions = { token, host: githubRepo.host };

    // Filter out boolean values (deleteOrphaned peer key) — keep only SecretConfig entries
    const secretEntries = Object.entries(rawEntries).filter(
      (entry): entry is [string, SecretConfig] => typeof entry[1] !== "boolean"
    );

    // Resolve all env vars upfront (fail fast) — skip in dry run
    let resolvedValues: Map<string, string>;
    if (!dryRun && secretEntries.length > 0) {
      resolvedValues = this.envResolver.resolveAll(
        secretEntries.map(([name, config]) => ({
          name,
          envVar: config.env,
        }))
      );
    } else {
      resolvedValues = new Map();
    }

    const currentSecrets = await this.strategy.list(
      githubRepo,
      strategyOptions
    );
    const currentByName = new Set(
      currentSecrets.map((s) => s.name.toUpperCase())
    );
    const desiredNames = new Set(
      secretEntries.map(([name]) => name.toUpperCase())
    );

    let created = 0;
    let updated = 0;
    let deleted = 0;

    if (!dryRun) {
      const publicKey = await this.strategy.getPublicKey(
        githubRepo,
        strategyOptions
      );

      for (const [name] of secretEntries) {
        const value = resolvedValues.get(name)!;
        const encrypted = await this.encryptor.encrypt(
          value,
          publicKey.key
        );

        await this.strategy.upsert(
          githubRepo,
          name,
          encrypted,
          publicKey.key_id,
          strategyOptions
        );

        if (currentByName.has(name.toUpperCase())) {
          updated++;
        } else {
          created++;
        }
      }

      if (deleteOrphaned) {
        for (const current of currentSecrets) {
          if (!desiredNames.has(current.name.toUpperCase())) {
            await this.strategy.delete(
              githubRepo,
              current.name,
              strategyOptions
            );
            deleted++;
          }
        }
      }
    } else {
      for (const [name] of secretEntries) {
        if (currentByName.has(name.toUpperCase())) {
          updated++;
        } else {
          created++;
        }
      }
      if (deleteOrphaned) {
        for (const current of currentSecrets) {
          if (!desiredNames.has(current.name.toUpperCase())) {
            deleted++;
          }
        }
      }
    }

    const parts: string[] = [];
    if (created > 0) parts.push(`${created} created`);
    if (updated > 0) parts.push(`${updated} updated`);
    if (deleted > 0) parts.push(`${deleted} deleted`);
    const summary =
      parts.length > 0 ? parts.join(", ") : "no changes";

    if (dryRun) {
      return {
        success: true,
        repoName,
        message: `[DRY RUN] ${summary}`,
        dryRun: true,
        created,
        updated,
        deleted,
      };
    }

    return {
      success: true,
      repoName,
      message: summary,
      created,
      updated,
      deleted,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "SecretsProcessor"` Expected: PASS

- [ ] **Step 5: Create secrets barrel export**

```typescript
// src/secrets/index.ts
export { SecretsProcessor } from "./processor.js";
export type {
  SecretsProcessorOptions,
  SecretsProcessorResult,
} from "./processor.js";
export { GitHubSecretsStrategy } from "./github-secrets-strategy.js";
export { SodiumEncryptor, type ISecretEncryptor } from "./encryption.js";
export type {
  ISecretsStrategy,
  GitHubSecret,
  GitHubPublicKey,
} from "./types.js";
```

- [ ] **Step 6: Commit**

```bash
git add src/secrets/processor.ts src/secrets/index.ts test/unit/secrets/processor.test.ts
git commit -m "feat(secrets): add SecretsProcessor with env resolution and encryption"
```

______________________________________________________________________

### Task 11: Config Normalizer for Secrets and Cross-Validation

> **Ordering note:** This task was moved before the CLI command (now Task 12) because `runSecretsSync` calls `normalizeConfig()` and accesses `config.secrets`. Without the secrets passthrough in the normalizer, `config.secrets` would be undefined.

**Files:**

- Modify: `src/config/normalizer.ts`

- Modify: `src/config/validator.ts`

- Test: `test/unit/config/normalizer.test.ts`

- Test: `test/unit/config/validator.test.ts`

- [ ] **Step 1: Write failing test for secrets config passthrough in normalizer**

```typescript
describe("normalizeConfig secrets", () => {
  test("passes secrets config through to normalized config", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      repos: [{ git: "git@github.com:org/repo.git" }],
      secrets: {
        MY_SECRET: { env: "SOURCE_VAR" },
        deleteOrphaned: true,
      },
    };
    const config = normalizeConfig(raw, {});

    // Flat config: secret entries are peers of deleteOrphaned
    assert.deepStrictEqual(
      (config.secrets as Record<string, unknown>)["MY_SECRET"],
      { env: "SOURCE_VAR" }
    );
    assert.equal(
      (config.secrets as Record<string, unknown>)["deleteOrphaned"],
      true
    );
  });
});
```

- [ ] **Step 2: Implement secrets passthrough in normalizer**

In `normalizeConfig`'s return object (around line 782), add `secrets` alongside other fields:

```typescript
return {
  id: raw.id,
  repos: expandedRepos,
  prTemplate: raw.prTemplate,
  githubHosts: raw.githubHosts,
  deleteOrphaned: raw.deleteOrphaned,
  settings: normalizedRootSettings,
  secrets: raw.secrets,
};
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- --grep "normalizeConfig secrets"` Expected: PASS

- [ ] **Step 4: Write failing test for variable/secret name overlap validation**

Secrets config is global (on `Config`), variables are per-repo (on `RepoConfig.settings`). The cross-validation needs to iterate each repo's effective variables and check against global secrets.

```typescript
describe("cross-validation", () => {
  test("rejects overlapping variable and secret names", () => {
    const config = createValidConfig({
      repos: [
        {
          git: "https://github.com/o/r.git",
          settings: {
            variables: { DEPLOY_TOKEN: "value" },
          },
        },
      ],
      secrets: {
        DEPLOY_TOKEN: { env: "SRC" },
      },
    });
    assert.throws(
      () => validateForSync(config),
      /DEPLOY_TOKEN.*overlap/i
    );
  });

  test("rejects overlapping root variable and secret names", () => {
    const config = createValidConfig({
      settings: {
        variables: { DEPLOY_TOKEN: "value" },
      },
      secrets: {
        DEPLOY_TOKEN: { env: "SRC" },
      },
    });
    assert.throws(
      () => validateForSync(config),
      /DEPLOY_TOKEN.*overlap/i
    );
  });
});
```

- [ ] **Step 5: Implement cross-validation**

In `validateForSync`, after per-repo validation. First validate secret names/configs (reuse `validateSecretsConfig`), then cross-validate overlap:

```typescript
// Validate secret names and configs (also validated by `xfg secrets sync` independently)
validateSecretsConfig(config);

// Cross-validate: no overlap between global secret names and variable names
if (config.secrets) {
  const { deleteOrphaned: _, ...secretEntries } = config.secrets;
  const secretNames = new Set(
    Object.keys(secretEntries)
      .filter((k) => typeof secretEntries[k] !== "boolean")
      .map((n) => n.toUpperCase())
  );

  // Check root-level variables (inherited by all repos unless overridden)
  if (config.settings?.variables) {
    const { deleteOrphaned: _rd, ...rootVarEntries } =
      config.settings.variables as Record<string, unknown>;
    const rootVariableNames = Object.keys(rootVarEntries).filter(
      (k) => typeof rootVarEntries[k] !== "boolean"
    );
    const overlapping = rootVariableNames.filter((n) =>
      secretNames.has(n.toUpperCase())
    );
    if (overlapping.length > 0) {
      throw new ValidationError(
        `Root variable and secret names overlap: ${overlapping.join(", ")}. ` +
          "GitHub does not allow variables and secrets with the same name."
      );
    }
  }

  for (const repo of config.repos) {
    // Filter out reserved peer keys (deleteOrphaned, inherit) from variable names
    const { deleteOrphaned: _d, inherit: _i, ...varEntries } =
      (repo.settings?.variables ?? {}) as Record<string, unknown>;
    const variableNames = Object.keys(varEntries).filter(
      (k) => typeof varEntries[k] !== "boolean"
    );
    const overlapping = variableNames.filter((n) =>
      secretNames.has(n.toUpperCase())
    );
    if (overlapping.length > 0) {
      throw new ValidationError(
        `Repo '${repo.git}': variable and secret names overlap: ${overlapping.join(", ")}. ` +
          "GitHub does not allow variables and secrets with the same name."
      );
    }
  }
}
```

- [ ] **Step 6: Run all tests**

Run: `npm test` Expected: PASS

- [ ] **Step 7: Run lint**

Run: `./lint.sh` Expected: PASS

- [ ] **Step 8: Run typecheck**

Run: `npm run test:typecheck` Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/config/normalizer.ts src/config/validator.ts test/unit/config/normalizer.test.ts test/unit/config/validator.test.ts
git commit -m "feat(config): add secrets normalization and cross-validation"
```

______________________________________________________________________

### Task 12: Secrets CLI Command

> **Dependency:** `runSecretsSync` calls `loadRawConfig` which calls `validateRawConfig`. Task 2 Step 7 updated `validateRawConfig` to accept secrets-only configs (no files/settings required). Without that fix, a secrets-only config would fail validation at load time.

**Files:**

- Create: `src/cli/secrets-command.ts`

- Modify: `src/cli/program.ts`

- [ ] **Step 1: Implement secrets command runner**

```typescript
// src/cli/secrets-command.ts
import { loadRawConfig } from "../config/index.js";
import { normalizeConfig } from "../config/normalizer.js";
import { validateSecretsConfig } from "../config/validator.js";
import {
  SecretsProcessor,
  GitHubSecretsStrategy,
  SodiumEncryptor,
} from "../secrets/index.js";
import { EnvResolver } from "../shared/env-resolver.js";
import { ProcessExecutor } from "../shared/command-executor.js";
import { parseGitUrl } from "../repo/index.js";
import { Logger } from "../shared/logger.js";
import { toErrorMessage } from "../shared/type-guards.js";

export interface SecretsSyncOptions {
  config: string;
  dryRun?: boolean;
  delete?: boolean; // Commander's --no-delete sets this to false
  workDir?: string;
  retries?: number;
}

export async function runSecretsSync(
  options: SecretsSyncOptions
): Promise<void> {
  const logger = new Logger(!!(process.env.DEBUG || process.env.XFG_DEBUG));
  const { config: configPath, dryRun, workDir, retries } = options;
  const noDelete = options.delete === false;
  const cwd = workDir ?? process.cwd();

  const rawConfig = loadRawConfig(configPath);
  validateSecretsConfig(rawConfig);
  const config = normalizeConfig(rawConfig, process.env);

  if (!config.secrets) {
    logger.info("No secrets configured. Nothing to do.");
    return;
  }

  // Separate deleteOrphaned from secret entries (flat config pattern)
  const { deleteOrphaned, ...secretEntries } = config.secrets;
  const secretNames = Object.keys(secretEntries).filter(
    (k) => typeof secretEntries[k] !== "boolean"
  );

  if (secretNames.length === 0 && !deleteOrphaned) {
    logger.info("No secrets configured. Nothing to do.");
    return;
  }

  const executor = new ProcessExecutor(process.env);
  const encryptor = new SodiumEncryptor();
  const envResolver = new EnvResolver(process.env);
  const strategy = new GitHubSecretsStrategy(executor, {
    cwd,
    retries: retries ?? 3,
  });
  const processor = new SecretsProcessor(
    strategy,
    encryptor,
    envResolver
  );

  // Read token from env (CLI entry point pattern, no App token manager needed)
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  let hasErrors = false;

  for (let i = 0; i < config.repos.length; i++) {
    const repoConfig = config.repos[i];
    const repoName = repoConfig.git;

    try {
      const repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });

      const result = await processor.process(config.secrets, repoInfo, {
        dryRun,
        token,
        noDelete,
      });

      if (result.skipped) {
        logger.skip(i + 1, repoName, result.message);
      } else if (result.success) {
        logger.success(i + 1, repoName, `Secrets: ${result.message}`);
      }
    } catch (error) {
      logger.error(
        i + 1,
        repoName,
        `Secrets: ${toErrorMessage(error)}`
      );
      hasErrors = true;
    }
  }

  if (hasErrors) {
    throw new Error(
      "One or more repositories failed secrets sync."
    );
  }
}
```

> **Note:** Uses `parseGitUrl` from `src/repo/index.js` directly — it already returns the correct `RepoInfo` subtype (including ADO project extraction). Same pattern as `src/cli/repo-sync-runner.ts`.

- [ ] **Step 2: Register secrets command in program.ts**

Add imports and command registration:

```typescript
import {
  runSecretsSync,
  type SecretsSyncOptions,
} from "./secrets-command.js";

const secretsCommand = new Command("secrets").description(
  "Manage repository secrets"
);

const secretsSyncCommand = new Command("sync")
  .description("Sync secrets to target repositories")
  .requiredOption("-c, --config <path>", "Path to xfg config file")
  .option("-d, --dry-run", "Show what would change without applying")
  .option("--no-delete", "Skip deletion of orphaned secrets")
  .option("-w, --work-dir <path>", "Working directory")
  .option(
    "-r, --retries <number>",
    "Number of API retries",
    parseInt
  )
  .action(async (opts) => {
    try {
      await runSecretsSync(opts as SecretsSyncOptions);
    } catch (error) {
      console.error("Fatal error:", error);
      return process.exit(1);
    }
  });

secretsCommand.addCommand(secretsSyncCommand);
program.addCommand(secretsCommand);
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build` Expected: PASS

- [ ] **Step 4: Run all tests**

Run: `npm test` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/secrets-command.ts src/cli/program.ts
git commit -m "feat(secrets): add 'xfg secrets sync' CLI command"
```

______________________________________________________________________

### Task 13: Integration Tests

**Files:**

- Create: `test/integration/github-variables.test.ts`

- Create: `test/integration/github-secrets.test.ts`

> **Note:** Integration tests live in `test/integration/` (not a `github/` subdirectory). Follow the same patterns as `test/integration/github-labels.test.ts`: ephemeral repos via `generateRepoName`/`createRepo`/`deleteRepo`, inline configs via `writeConfig`, rate-limit-safe helpers from `test-helpers.ts`.

- [ ] **Step 1: Create variables integration test**

Follow patterns from existing integration test files in `test/integration/`. Use real GitHub API against an ephemeral test repo.

```typescript
// test/integration/github-variables.test.ts
import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  execWithRetry,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
  withTestRetry,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";

interface Variable {
  name: string;
  value: string;
}

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function getVariables(): Promise<Variable[]> {
  try {
    const output = await execWithRetry(
      `gh api repos/${testRepo}/actions/variables --jq '.variables'`
    );
    return JSON.parse(output) as Variable[];
  } catch {
    return [];
  }
}

async function runSync(configPath: string, extraArgs = ""): Promise<string> {
  return exec(
    `node dist/cli.js sync --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}

describe("GitHub Variables Integration Test", () => {
  before(async () => {
    repoName = generateRepoName("variables");
    testRepo = `${OWNER}/${repoName}`;
    tmpDir = join(tmpdir(), `xfg-variables-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates variables via sync", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-variables
settings:
  variables:
    XFG_TEST_VAR: "test-value"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath);

    await withTestRetry(
      async () => {
        const variables = await getVariables();
        const found = variables.find(
          (v) => v.name === "XFG_TEST_VAR"
        );
        assert.ok(found, "Variable XFG_TEST_VAR should exist");
        assert.equal(found.value, "test-value");
      },
      { description: "variable creation visible" }
    );
  });

  test("updates variable value", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-variables
settings:
  variables:
    XFG_TEST_VAR: "updated-value"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath);

    await withTestRetry(
      async () => {
        const variables = await getVariables();
        const found = variables.find(
          (v) => v.name === "XFG_TEST_VAR"
        );
        assert.ok(found, "Variable XFG_TEST_VAR should exist");
        assert.equal(found.value, "updated-value");
      },
      { description: "variable update visible" }
    );
  });

  test("dry run does not create variable", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-variables
settings:
  variables:
    XFG_DRY_RUN_VAR: "should-not-exist"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath, "--dry-run");

    const variables = await getVariables();
    const found = variables.find(
      (v) => v.name === "XFG_DRY_RUN_VAR"
    );
    assert.equal(found, undefined, "Dry-run variable should not exist");
  });

  test("deletes orphaned variables with deleteOrphaned", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-variables
settings:
  variables:
    deleteOrphaned: true
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath);

    await withTestRetry(
      async () => {
        const variables = await getVariables();
        const found = variables.find(
          (v) => v.name === "XFG_TEST_VAR"
        );
        assert.equal(found, undefined, "Orphaned variable should be deleted");
      },
      { description: "variable deletion visible" }
    );
  });
});
```

- [ ] **Step 2: Create secrets integration test**

> **Note:** The secrets integration test configs below use only `secrets:` and `repos:` with no `files:` or `settings:`. This is valid because Task 2 Step 7 updated `validateRawConfig` to accept secrets-only configs.

```typescript
// test/integration/github-secrets.test.ts
import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  execWithRetry,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
  withTestRetry,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";

interface Secret {
  name: string;
}

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function getSecrets(): Promise<Secret[]> {
  try {
    const output = await execWithRetry(
      `gh api repos/${testRepo}/actions/secrets --jq '.secrets'`
    );
    return JSON.parse(output) as Secret[];
  } catch {
    return [];
  }
}

async function runSecretsSync(
  configPath: string,
  extraArgs = ""
): Promise<string> {
  return exec(
    `node dist/cli.js secrets sync --config ${configPath} ${extraArgs}`.trim(),
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        // Set env vars that the secrets config references
        XFG_TEST_SECRET_VALUE: "integration-test-secret",
      },
    }
  );
}

describe("GitHub Secrets Integration Test", () => {
  before(async () => {
    repoName = generateRepoName("secrets");
    testRepo = `${OWNER}/${repoName}`;
    tmpDir = join(tmpdir(), `xfg-secrets-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates a new secret", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets
repos:
  - git: https://github.com/${testRepo}.git
secrets:
  XFG_TEST_SECRET:
    env: XFG_TEST_SECRET_VALUE
`
    );

    await runSecretsSync(configPath);

    await withTestRetry(
      async () => {
        const secrets = await getSecrets();
        const found = secrets.find(
          (s) => s.name === "XFG_TEST_SECRET"
        );
        assert.ok(found, "Secret XFG_TEST_SECRET should exist");
      },
      { description: "secret creation visible" }
    );
  });

  test("upserts existing secret", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets
repos:
  - git: https://github.com/${testRepo}.git
secrets:
  XFG_TEST_SECRET:
    env: XFG_TEST_SECRET_VALUE
`
    );

    // Should succeed without error (upsert, not create)
    await runSecretsSync(configPath);

    const secrets = await getSecrets();
    const found = secrets.find(
      (s) => s.name === "XFG_TEST_SECRET"
    );
    assert.ok(found, "Secret XFG_TEST_SECRET should still exist");
  });

  test("dry run does not create secret", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets
repos:
  - git: https://github.com/${testRepo}.git
secrets:
  XFG_DRY_RUN_SECRET:
    env: XFG_TEST_SECRET_VALUE
`
    );

    await runSecretsSync(configPath, "--dry-run");

    const secrets = await getSecrets();
    const found = secrets.find(
      (s) => s.name === "XFG_DRY_RUN_SECRET"
    );
    assert.equal(found, undefined, "Dry-run secret should not exist");
  });

  test("deletes orphaned secret", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets
repos:
  - git: https://github.com/${testRepo}.git
secrets:
  deleteOrphaned: true
`
    );

    await runSecretsSync(configPath);

    await withTestRetry(
      async () => {
        const secrets = await getSecrets();
        const found = secrets.find(
          (s) => s.name === "XFG_TEST_SECRET"
        );
        assert.equal(found, undefined, "Orphaned secret should be deleted");
      },
      { description: "secret deletion visible" }
    );
  });
});
```

- [ ] **Step 3: Run integration tests**

Run: `npm run test:integration:github` Expected: PASS

- [ ] **Step 4: Run full pre-PR checklist**

```bash
npm test
npm run test:typecheck
./lint.sh
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add test/integration/github-variables.test.ts test/integration/github-secrets.test.ts
git commit -m "test(integration): add GitHub variables and secrets integration tests"
```

______________________________________________________________________

### Task 14: GitHub Summary, Final Verification, and Cleanup

**Files:**

- Modify: `src/output/settings-report.ts`

- Modify: `src/cli/settings-report-builder.ts`

- [ ] **Step 1: Update settings report to include variables**

Read `src/output/settings-report.ts` and follow the exact pattern used for labels. Changes:

1. In `RepoChanges` interface, add:

   ```typescript
   variables: { name: string; action: ActiveAction; oldValue?: string; newValue?: string }[];
   ```

1. In the `totals` property of the `SettingsReport` interface, add:

   ```typescript
   variables: { create: number; update: number; delete: number };
   ```

1. In `buildSettingsReport`:

   - Add `variables: { create: 0, update: 0, delete: 0 }` to the `totals` initializer
   - Add `variables: []` to the `repoChanges` initializer (required field, initialized as empty array)
   - Add a processing block for `variablesResult` after the labels block (same pattern as `labelsResult`):

   ```typescript
   if (result.variablesResult?.planOutput?.entries) {
     for (const entry of result.variablesResult.planOutput.entries) {
       if (!isActiveAction(entry)) continue;
       repoChanges.variables.push({
         name: entry.name,
         action: entry.action,
         oldValue: entry.oldValue,
         newValue: entry.newValue,
       });
     }
     const counts = countActions(repoChanges.variables);
     totals.variables.create += counts.create;
     totals.variables.update += counts.update;
     totals.variables.delete += counts.delete;
   }
   ```

Then in `src/cli/settings-report-builder.ts`:

- Import `VariablesPlanEntry` from settings index

- `variablesResult` was already added to `ProcessorResults` in Task 6 Step 6 — verify it is present. Do NOT add it again.

- In the builder function, map `variablesResult.planOutput.entries` into the report's `variables` field

- [ ] **Step 2: Update report rendering functions**

In `src/output/settings-report.ts`, update the following functions to include variables (follow the exact patterns used for labels/rulesets):

1. **`renderRepoSettingsDiffLines`** — Add a variables rendering section after the labels section. Use the same blank-line-before pattern:

   ```typescript
   // Blank line before variables if there was content above
   if (repo.variables.length > 0 && diffLines.length > startLength) {
     diffLines.push("");
   }

   for (const variable of repo.variables) {
     if (variable.action === "create") {
       diffLines.push(`+ variable "${variable.name}": ${formatValuePlain(variable.newValue)}`);
     } else if (variable.action === "update") {
       diffLines.push(`! variable "${variable.name}": ${formatValuePlain(variable.oldValue)} → ${formatValuePlain(variable.newValue)}`);
     } else if (variable.action === "delete") {
       diffLines.push(`- variable "${variable.name}"`);
     }
   }
   ```

1. **`formatSettingsReportCLI`** — Update the skip-check to include variables emptiness:

   ```typescript
   if (
     repo.settings.length === 0 &&
     repo.rulesets.length === 0 &&
     repo.labels.length === 0 &&
     repo.variables.length === 0 &&
     !repo.error
   ) {
     continue;
   }
   ```

1. **`formatSettingsReportMarkdown`** — Update the same skip-check:

   ```typescript
   if (
     repo.settings.length === 0 &&
     repo.rulesets.length === 0 &&
     repo.labels.length === 0 &&
     repo.variables.length === 0 &&
     !repo.error
   ) {
     continue;
   }
   ```

1. **`formatSettingsSummary`** — Add a variables entry after the labels entry:

   ```typescript
   const variablesEntry = formatCountEntry("variable", "variables", [
     { label: "to create", value: totals.variables.create },
     { label: "to update", value: totals.variables.update },
     { label: "to delete", value: totals.variables.delete },
   ]);
   if (variablesEntry) parts.push(variablesEntry);
   ```

- [ ] **Step 3: Verify all barrel exports are complete**

Check `src/settings/index.ts` includes variables exports. `src/secrets/index.ts` barrel was already created in Task 10 Step 5 — verify it exports all needed types.

- [ ] **Step 4: Run full test suite**

```bash
npm test
npm run test:typecheck
./lint.sh
```

- [ ] **Step 5: Test CLI commands manually**

```bash
node dist/cli.js sync --help
node dist/cli.js secrets sync --help
# Use one of the integration test configs, or create a minimal one inline:
echo 'id: manual-test
repos:
  - git: https://github.com/spruyt-labs/xfg-test.git
secrets:
  TEST_SECRET:
    env: TEST_SECRET_VALUE' > /tmp/xfg-secrets-test.yaml
node dist/cli.js secrets sync --config /tmp/xfg-secrets-test.yaml --dry-run
```

- [ ] **Step 6: Push and verify CI**

```bash
git push
```

Wait for CI checks to pass before proceeding.

______________________________________________________________________

### Task 15: JSON Schema Updates

**Files:**

- Modify: `config-schema.json`

- [ ] **Step 1: Add variables to rootSettings**

Add `variables` property after `codeScanning` in `rootSettings`:

```json
"variables": {
  "type": "object",
  "description": "Map of GitHub Actions variable names to values. Set a variable to false to disable it. Use deleteOrphaned to remove variables not in config.",
  "properties": {
    "deleteOrphaned": {
      "type": "boolean",
      "default": false,
      "description": "Delete variables from repos that are not defined in this config. Independent from the settings-level deleteOrphaned flag. Default: false"
    }
  },
  "additionalProperties": {
    "oneOf": [
      {
        "type": "boolean",
        "const": false,
        "description": "Set to false to disable this variable"
      },
      {
        "type": "string",
        "description": "Variable value"
      }
    ]
  }
}
```

- [ ] **Step 2: Add variables to repoSettings**

Add `variables` property after `codeScanning` in `repoSettings`:

```json
"variables": {
  "type": "object",
  "description": "Map of GitHub Actions variable names to values. Set a variable to false to opt out. Set inherit: false to skip all inherited variables.",
  "properties": {
    "inherit": {
      "type": "boolean",
      "description": "Set to false to skip all inherited root variables. Default: true"
    },
    "deleteOrphaned": {
      "type": "boolean",
      "default": false,
      "description": "Delete variables from repos that are not defined in this config. Overrides root-level variables.deleteOrphaned. Default: false"
    }
  },
  "additionalProperties": {
    "oneOf": [
      {
        "type": "boolean",
        "const": false,
        "description": "Set to false to opt out of this inherited variable"
      },
      {
        "type": "string",
        "description": "Variable value"
      }
    ]
  }
}
```

- [ ] **Step 3: Add SecretConfig definition**

Add `secretConfig` to `definitions`:

```json
"secretConfig": {
  "type": "object",
  "description": "Secret configuration mapping to an environment variable source",
  "required": ["env"],
  "properties": {
    "env": {
      "type": "string",
      "description": "Name of the environment variable containing the secret value"
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 4: Add secrets to root config properties**

Add `secrets` property to root config (after `settings`):

```json
"secrets": {
  "type": "object",
  "description": "Secrets config: map of secret names to SecretConfig. Use deleteOrphaned to remove secrets not in config.",
  "properties": {
    "deleteOrphaned": {
      "type": "boolean",
      "default": false,
      "description": "Delete secrets from repos that are not defined in this config. Default: false"
    }
  },
  "additionalProperties": {
    "oneOf": [
      {
        "type": "boolean",
        "description": "Set to false to disable this secret"
      },
      {
        "$ref": "#/definitions/secretConfig"
      }
    ]
  }
}
```

- [ ] **Step 5: Update deleteOrphaned descriptions**

The settings-level `deleteOrphaned` flag does NOT affect variables (variables has its own `deleteOrphaned` peer key). No changes needed to existing `deleteOrphaned` descriptions — they already correctly reference rulesets and labels only.

- [ ] **Step 6: Validate schema is valid JSON and test with a sample config**

```bash
node -e "JSON.parse(require('fs').readFileSync('config-schema.json', 'utf8')); console.log('Valid JSON')"
```

Also verify `additionalProperties` with `oneOf` (boolean + string/$ref) validates correctly against a sample config with both variables and secrets — some JSON Schema validators are strict about `additionalProperties` conflicting with `properties`.

- [ ] **Step 7: Commit**

```bash
git add config-schema.json
git commit -m "feat(schema): add variables and secrets to config schema"
```

______________________________________________________________________

### Task 16: Documentation

**Files:**

- Create: `docs/configuration/variables.md`

- Create: `docs/configuration/secrets.md`

- Modify: `docs/reference/config-schema.md`

- Modify: `docs/reference/cli-options.md`

- Modify: `mkdocs.yml`

- [ ] **Step 1: Create variables documentation page**

Create `docs/configuration/variables.md` following the same structure as `docs/configuration/labels.md`:

- GitHub-Only admonition

- Quick Start example with YAML config

- Variable naming rules (alphanumeric + underscore, no `GITHUB_` prefix)

- Case-insensitive matching note

- Inheritance section (`inherit: false`, `VAR: false` opt-out)

- `deleteOrphaned` behavior

- Dry run output example

- GitHub API reference (Actions Variables API endpoints)

- [ ] **Step 2: Create secrets documentation page**

Create `docs/configuration/secrets.md`:

- GitHub-Only admonition

- Explain `secrets:` is root-level config (not under `settings:`)

- `xfg secrets sync` command (separate from `xfg sync`)

- `SecretConfig` with `env:` field mapping

- `deleteOrphaned` option

- Environment variable requirements (values read at runtime)

- Encryption note (libsodium sealed box encryption)

- Secret naming rules (same as variables)

- Dry run output example

- Security warning: secret values never logged

- [ ] **Step 3: Update CLI options reference**

Update `docs/reference/cli-options.md`:

- Update sync command description to mention variables

- Add new `## Secrets Sync Command` section documenting `xfg secrets sync` with its options (`--config`, `--dry-run`, `--retries`, `--no-delete`)

- [ ] **Step 4: Update config schema reference**

Update `docs/reference/config-schema.md`:

- Add `secrets` row to Root Object table

- Add `variables` mention in settings description

- Add Settings Object subsection listing `variables` field

- [ ] **Step 5: Update mkdocs.yml navigation**

Add new pages to nav under Configuration, after "GitHub Labels":

```yaml
      - GitHub Variables: configuration/variables.md
      - Secrets: configuration/secrets.md
```

- [ ] **Step 6: Verify docs build (if mkdocs available)**

```bash
npx mkdocs build --strict 2>&1 || echo "mkdocs not available locally — verify in CI"
```

- [ ] **Step 7: Commit**

```bash
git add docs/configuration/variables.md docs/configuration/secrets.md docs/reference/config-schema.md docs/reference/cli-options.md mkdocs.yml
git commit -m "docs: add variables and secrets documentation"
```
