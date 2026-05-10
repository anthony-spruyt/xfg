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

```typescript
// In RepoSettings (after codeScanning field):
  /** GitHub Actions repository variables keyed by name */
  variables?: Record<string, string>;

// In RawRootSettings (after codeScanning field):
  variables?: Record<string, string | false>;

// In RawRepoSettings (after codeScanning field):
  variables?: Record<string, string | false> & { inherit?: boolean };
```

- [ ] **Step 2: Add SecretConfig type and secrets to RawConfig**

```typescript
// New type (before RepoSettings):
export interface SecretConfig {
  env: string;
}

// In RawConfig (after settings field):
  /** Secrets config: Record<name, SecretConfig> with optional deleteOrphaned flag.
   *  Uses the same pattern as labels' inherit: a peer key alongside data entries. */
  secrets?: Record<string, SecretConfig> & { deleteOrphaned?: boolean };

// In Config (after settings field):
  secrets?: Record<string, SecretConfig> & { deleteOrphaned?: boolean };
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
git add src/config/types.ts
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
    const config = makeConfig({
      settings: {
        variables: { MY_VAR: "value", ANOTHER_123: "val" },
      },
    });
    assert.doesNotThrow(() => validateForSync(config));
  });

  test("rejects variable names starting with GITHUB_", () => {
    const config = makeConfig({
      settings: {
        variables: { GITHUB_TOKEN: "value" },
      },
    });
    assert.throws(() => validateForSync(config), /GITHUB_/);
  });

  test("rejects variable names with invalid characters", () => {
    const config = makeConfig({
      settings: {
        variables: { "my-var": "value" },
      },
    });
    assert.throws(() => validateForSync(config), /invalid.*character/i);
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
if (
  settings.variables &&
  Object.keys(settings.variables).filter((k) => k !== "inherit").length > 0
) {
  return true;
}
```

Add variable name validation call in `validateForSync` or the appropriate per-repo validation path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "validateVariables"` Expected: PASS

- [ ] **Step 5: Write failing tests for secret config validation**

```typescript
describe("validateSecrets", () => {
  test("accepts valid secret config", () => {
    const config = makeConfig({
      secrets: { MY_SECRET: { env: "SOURCE_VAR" } },
    });
    assert.doesNotThrow(() => validateForSync(config));
  });

  test("rejects secret names starting with GITHUB_", () => {
    const config = makeConfig({
      secrets: { GITHUB_TOKEN: { env: "TOKEN" } },
    });
    assert.throws(() => validateForSync(config), /GITHUB_/);
  });

  test("rejects secret without env field", () => {
    const config = makeConfig({
      secrets: { MY_SECRET: {} as SecretConfig },
    });
    assert.throws(() => validateForSync(config), /env/);
  });
});
```

- [ ] **Step 6: Implement validateSecretConfig**

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

export function validateSecretConfig(name: string, config: SecretConfig): void {
  validateSecretName(name);
  if (!config.env || typeof config.env !== "string") {
    throw new ValidationError(
      `Secret '${name}' requires an 'env' field (string) specifying the environment variable source.`
    );
  }
}
```

- [ ] **Step 7: Run all tests**

Run: `npm test` Expected: PASS

- [ ] **Step 8: Commit**

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
      apiCall.args.includes(
        "/repos/test-org/test-repo/actions/variables"
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

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/variables`;
    const result = await this.api.call("GET", endpoint, {
      options,
      paginate: true,
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
    settings: { variables, deleteOrphaned },
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

  test("dry run does not call create/update/delete", async () => {
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
      strategy.calls.filter((c) => c.method !== "list").length,
      0
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
      hasDesiredSettings: (rc) =>
        Object.keys(rc.settings?.variables ?? {}).length > 0,
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
    const desiredVariables = settings?.variables ?? {};
    const deleteOrphaned =
      (settings?.deleteOrphaned ?? false) && !(noDelete ?? false);

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

Add `"variables"` to `SettingsKind` union.

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

> **Note:** `applyRepoSettings` (line 157-158) does:
>
> ```typescript
> const settingsValue = repoConfig.settings[desc.key];
> if (!settingsValue || Object.keys(settingsValue).length === 0) continue;
> ```
>
> This naturally works for `variables: Record<string, string>` -- `Object.keys()` on an empty object returns `[]`, so empty variables configs are correctly skipped.

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
// Variables merging
if (root?.variables || perRepo?.variables) {
  const rootVars = root?.variables ?? {};
  const repoVars = perRepo?.variables ?? {};

  const inherit = (repoVars as Record<string, unknown>).inherit;
  if (inherit === false) {
    const { inherit: _, ...rest } = repoVars as Record<string, unknown>;
    merged.variables = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== false)
    ) as Record<string, string>;
  } else {
    const combined = { ...rootVars, ...repoVars };
    const { inherit: _, ...rest } = combined as Record<string, unknown>;
    merged.variables = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== false)
    ) as Record<string, string>;
  }

  if (Object.keys(merged.variables).length === 0) {
    delete merged.variables;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "mergeSettings variables"` Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npm test` Expected: PASS

- [ ] **Step 6: Commit**

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
    await encryptor.initialize();

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
    await encryptor.initialize();

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
  initialize(): Promise<void>;
  encrypt(value: string, publicKeyBase64: string): Promise<string>;
}

export class SodiumEncryptor implements ISecretEncryptor {
  private sodium: typeof _sodium | undefined;

  async initialize(): Promise<void> {
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

  async encrypt(
    value: string,
    publicKeyBase64: string
  ): Promise<string> {
    if (!this.sodium) {
      throw new Error(
        "SodiumEncryptor not initialized. Call initialize() first."
      );
    }

    const messageBytes = this.sodium.from_string(value);
    const publicKey = this.sodium.from_base64(
      publicKeyBase64,
      this.sodium.base64_variants.ORIGINAL
    );

    const encrypted = this.sodium.crypto_box_seal(messageBytes, publicKey);

    return this.sodium.to_base64(
      encrypted,
      this.sodium.base64_variants.ORIGINAL
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
      executor.calls[0].args.includes(
        "/repos/test-org/test-repo/actions/secrets"
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

    const endpoint = `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/secrets`;
    const result = await this.api.call("GET", endpoint, {
      options,
      paginate: true,
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
import type { SecretConfig } from "../../../src/config/types.js";

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
  async initialize(): Promise<void> {}
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
 *  Record<string, SecretConfig> & { deleteOrphaned?: boolean } */
function makeSecretsConfig(
  secrets: Record<string, SecretConfig>,
  deleteOrphaned = false
): Record<string, SecretConfig> & { deleteOrphaned?: boolean } {
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
  type GitHubRepoInfo,
  type RepoInfo,
} from "../repo/index.js";
import type { ISecretsStrategy } from "./types.js";
import type { ISecretEncryptor } from "./encryption.js";
import type { IEnvResolver } from "../shared/env-resolver.js";
import type { SecretConfig } from "../config/types.js";

/** Flat secrets config: Record<name, SecretConfig> & { deleteOrphaned?: boolean } */
type SecretsConfig = Record<string, SecretConfig> & {
  deleteOrphaned?: boolean;
};

export interface SecretsProcessorOptions {
  dryRun?: boolean;
  token?: string;
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
    const repoName = `${repoInfo.owner}/${repoInfo.repo}`;

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
    const { deleteOrphaned = false, ...desiredSecrets } = secretsConfig;
    const { dryRun, token } = options;
    const strategyOptions = { token, host: githubRepo.host };

    const secretEntries = Object.entries(desiredSecrets);

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
    const prefix = dryRun ? "[DRY RUN] " : "";

    return {
      success: true,
      repoName,
      message: `${prefix}${summary}`,
      dryRun: dryRun ?? false,
      created,
      updated,
      deleted,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --grep "SecretsProcessor"` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/secrets/processor.ts test/unit/secrets/processor.test.ts
git commit -m "feat(secrets): add SecretsProcessor with env resolution and encryption"
```

______________________________________________________________________

### Task 11: Secrets CLI Command

**Files:**

- Create: `src/cli/secrets-command.ts`

- Modify: `src/cli/program.ts`

- [ ] **Step 1: Implement secrets command runner**

```typescript
// src/cli/secrets-command.ts
import { readConfig } from "../config/index.js";
import { normalizeConfig } from "../config/normalizer.js";
import { SecretsProcessor } from "../secrets/processor.js";
import { GitHubSecretsStrategy } from "../secrets/github-secrets-strategy.js";
import { SodiumEncryptor } from "../secrets/encryption.js";
import { EnvResolver } from "../shared/env-resolver.js";
import { ProcessExecutor } from "../shared/command-executor.js";
import {
  detectRepoType,
  parseGitUrl,
  type RepoInfo,
  type GitHubRepoInfo,
  type AzureDevOpsRepoInfo,
  type GitLabRepoInfo,
} from "../repo/index.js";
import { logger } from "../shared/logger.js";
import { toErrorMessage } from "../shared/type-guards.js";
import type { SecretConfig } from "../config/types.js";

export interface SecretsSyncOptions {
  config: string;
  dryRun?: boolean;
  workDir?: string;
  retries?: number;
}

/**
 * Construct a RepoInfo from a git URL.
 * Follow the same pattern used in the sync flow's composition root
 * (src/sync/repository-processor.ts and settings-runner pipeline).
 */
function buildRepoInfo(
  gitUrl: string,
  githubHosts?: string[]
): RepoInfo {
  const parsed = parseGitUrl(gitUrl);
  const platform = detectRepoType(gitUrl, { githubHosts });

  switch (platform) {
    case "github":
      return {
        type: "github",
        owner: parsed.owner,
        repo: parsed.repo,
        host: parsed.host,
        gitUrl,
      } satisfies GitHubRepoInfo;
    case "azure-devops":
      // For ADO, owner is the org, project is extracted from the URL path
      // parseGitUrl already handles this — check actual codebase for details
      return {
        type: "azure-devops",
        owner: parsed.owner,
        repo: parsed.repo,
        organization: parsed.owner,
        project: parsed.owner, // Agent: read parseGitUrl to get actual project extraction
        gitUrl,
      } satisfies AzureDevOpsRepoInfo;
    case "gitlab":
      return {
        type: "gitlab",
        owner: parsed.owner,
        repo: parsed.repo,
        namespace: parsed.owner,
        host: parsed.host,
        gitUrl,
      } satisfies GitLabRepoInfo;
  }
}

export async function runSecretsSync(
  options: SecretsSyncOptions
): Promise<void> {
  const { config: configPath, dryRun, workDir, retries } = options;
  const cwd = workDir ?? process.cwd();

  const rawConfig = await readConfig(configPath);
  const config = normalizeConfig(rawConfig, process.env);

  if (!config.secrets) {
    logger.info("No secrets configured. Nothing to do.");
    return;
  }

  // Separate deleteOrphaned from secret entries (flat config pattern)
  const { deleteOrphaned, ...secretEntries } = config.secrets;
  const secretNames = Object.keys(secretEntries).filter(
    (k) => k !== "deleteOrphaned"
  );

  if (secretNames.length === 0) {
    logger.info("No secrets configured. Nothing to do.");
    return;
  }

  const executor = new ProcessExecutor(process.env);
  const encryptor = new SodiumEncryptor();
  await encryptor.initialize();
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
      const repoInfo = buildRepoInfo(
        repoConfig.git,
        config.githubHosts
      );

      const result = await processor.process(config.secrets, repoInfo, {
        dryRun,
        token,
      });

      if (result.skipped) {
        logger.warn(i + 1, repoName, result.message);
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

> **Implementation note:** The `buildRepoInfo` helper constructs `RepoInfo` from a git URL using `detectRepoType` and `parseGitUrl` from `src/repo/index.js`. The implementing agent should read `src/sync/repository-processor.ts` and the sync command's composition root to verify the exact pattern for building `RepoInfo` objects from git URLs, especially for Azure DevOps where the project field needs
> proper extraction from the URL path.

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

### Task 12: Config Normalizer for Secrets and Cross-Validation

**Files:**

- Modify: `src/config/normalizer.ts`

- Modify: `src/config/validator.ts`

- Test: `test/unit/config/normalizer.test.ts`

- Test: `test/unit/config/validator.test.ts`

- [ ] **Step 1: Write failing test for secrets config passthrough in normalizer**

```typescript
describe("normalizeConfig secrets", () => {
  test("passes secrets config through to normalized config", () => {
    const raw = makeRawConfig({
      secrets: {
        MY_SECRET: { env: "SOURCE_VAR" },
        deleteOrphaned: true,
      },
    });
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

In `normalizeConfig`, add:

```typescript
if (raw.secrets) {
  normalized.secrets = raw.secrets;
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- --grep "normalizeConfig secrets"` Expected: PASS

- [ ] **Step 4: Write failing test for variable/secret name overlap validation**

Secrets config is global (on `Config`), variables are per-repo (on `RepoConfig.settings`). The cross-validation needs to iterate each repo's effective variables and check against global secrets.

```typescript
describe("cross-validation", () => {
  test("rejects overlapping variable and secret names", () => {
    const config = makeConfig({
      repos: [
        {
          git: "https://github.com/o/r.git",
          files: [],
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
});
```

- [ ] **Step 5: Implement cross-validation**

In `validateForSync`, after per-repo validation. Since secrets is global and variables is per-repo, iterate repos:

```typescript
// Cross-validate: no overlap between global secret names and per-repo variable names
if (config.secrets) {
  const { deleteOrphaned: _, ...secretEntries } = config.secrets;
  const secretNames = new Set(
    Object.keys(secretEntries).map((n) => n.toUpperCase())
  );

  for (const repo of config.repos) {
    const variableNames = Object.keys(
      repo.settings?.variables ?? {}
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

### Task 13: Integration Tests

**Files:**

- Create: `test/integration/github-variables.test.ts`

- Create: `test/integration/github-secrets.test.ts`

> **Note:** Integration tests live in `test/integration/` (not a `github/` subdirectory). Follow the same patterns as `test/integration/github-labels.test.ts`: ephemeral repos via `generateRepoName`/`createRepo`/`deleteRepo`, inline configs via `writeConfig`, rate-limit-safe helpers from `test-helpers.ts`.

- [ ] **Step 1: Create variables integration test**

Follow patterns from existing integration test files in `test/integration/`. Use real GitHub API against an ephemeral test repo.

```typescript
// test/integration/github-variables.test.ts
import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec as execHelper,
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
  return execHelper(
    `node dist/cli.js sync --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}

describe("GitHub Variables Integration Test", () => {
  before(async () => {
    repoName = generateRepoName("variables");
    testRepo = `${OWNER}/${repoName}`;
    tmpDir = mkdtempSync(join(tmpdir(), "xfg-variables-"));
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
files:
  .xfg-var-test:
    content: "# Placeholder"
    createOnly: true
settings:
  variables:
    XFG_TEST_VAR: "test-value"
repos:
  - git: https://github.com/${testRepo}.git
    files:
      .xfg-var-test: false
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
  variables: {}
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

```typescript
// test/integration/github-secrets.test.ts
import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec as execHelper,
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
  return execHelper(
    `node dist/cli.js secrets sync --config ${configPath} ${extraArgs}`.trim(),
    {
      cwd: projectRoot,
      env: {
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
    tmpDir = mkdtempSync(join(tmpdir(), "xfg-secrets-"));
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

- [ ] **Step 1: Update settings report to include variables**

Update `src/output/settings-report.ts` to include variables in `SettingsReport`, `RepoChanges`, and the totals. Read the existing file to understand the pattern for adding a new settings type. The key changes:

- Add `variables: VariableChange[]` to `RepoChanges`
- Add `variables: { create: number; update: number; delete: number }` to `totals`
- Add processing block in `buildSettingsReport` for `variablesResult` (similar to how `labelsResult` is processed)

Then update `src/cli/settings-report-builder.ts` to populate `variablesResult` from the processor results.

- [ ] **Step 2: Update GitHub job summary**

Update `src/output/settings-report.ts`'s markdown formatter (`formatSettingsReportMarkdown`) to include a variables section in the GitHub step summary output. Follow the same pattern used for labels/rulesets sections.

- [ ] **Step 3: Verify all barrel exports are complete**

Check `src/settings/index.ts` includes variables exports. Create `src/secrets/index.ts` barrel if needed:

```typescript
// src/secrets/index.ts
export { SecretsProcessor } from "./processor.js";
export { GitHubSecretsStrategy } from "./github-secrets-strategy.js";
export { SodiumEncryptor, type ISecretEncryptor } from "./encryption.js";
export type {
  ISecretsStrategy,
  GitHubSecret,
  GitHubPublicKey,
} from "./types.js";
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
npm run test:typecheck
./lint.sh
```

- [ ] **Step 5: Test CLI commands manually**

```bash
node dist/index.js sync --help
node dist/index.js secrets sync --help
node dist/index.js secrets sync --config test-config.yaml --dry-run
```

- [ ] **Step 6: Push and verify CI**

```bash
git push
```

Wait for CI checks to pass before proceeding.
