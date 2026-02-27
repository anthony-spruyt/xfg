# Default Branch Lifecycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `settings.repo.defaultBranch` rename the default branch during lifecycle create and migrate operations.

**Architecture:** Extend `CreateRepoSettings` with `defaultBranch`, plumb it through `toCreateRepoSettings`, then add rename logic in `GitHubLifecycleProvider.create()` (GitHub API rename) and `receiveMigration()` (git branch rename in bare mirror clone before push). Fork ignores it.

**Tech Stack:** TypeScript, node:test, GitHub REST API (`POST /repos/{owner}/{repo}/branches/{branch}/rename`), git CLI

**Design doc:** `plans/2026-02-26-default-branch-lifecycle-design.md`

---

### Task 1: Add `defaultBranch` to `CreateRepoSettings` and plumb through helpers

**Files:**

- Modify: `src/lifecycle/types.ts:39-44`
- Modify: `src/lifecycle/lifecycle-helpers.ts:27-39`
- Create: `test/unit/lifecycle/lifecycle-helpers.test.ts`

**Step 1: Write the failing test**

Create `test/unit/lifecycle/lifecycle-helpers.test.ts`:

```ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { toCreateRepoSettings } from "../../../src/lifecycle/lifecycle-helpers.js";

describe("toCreateRepoSettings", () => {
  test("maps defaultBranch from GitHubRepoSettings", () => {
    const result = toCreateRepoSettings({ defaultBranch: "main" });
    assert.deepEqual(result, { defaultBranch: "main" });
  });

  test("returns settings when only defaultBranch is set", () => {
    const result = toCreateRepoSettings({ defaultBranch: "develop" });
    assert.ok(result !== undefined, "should not return undefined");
    assert.equal(result!.defaultBranch, "develop");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/unit/lifecycle/lifecycle-helpers.test.ts`
Expected: FAIL — `defaultBranch` not on `CreateRepoSettings` type / not mapped

**Step 3: Write minimal implementation**

In `src/lifecycle/types.ts`, add to `CreateRepoSettings`:

```ts
export interface CreateRepoSettings {
  visibility?: "public" | "private" | "internal";
  description?: string;
  hasIssues?: boolean;
  hasWiki?: boolean;
  defaultBranch?: string;
}
```

In `src/lifecycle/lifecycle-helpers.ts`, add mapping in `toCreateRepoSettings` after the `hasWiki` line:

```ts
if (repo.defaultBranch !== undefined) result.defaultBranch = repo.defaultBranch;
```

**Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/unit/lifecycle/lifecycle-helpers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lifecycle/types.ts src/lifecycle/lifecycle-helpers.ts test/unit/lifecycle/lifecycle-helpers.test.ts
git commit -m "feat(lifecycle): add defaultBranch to CreateRepoSettings and plumb through helpers"
```

---

### Task 2: Branch rename in `create()` — unit tests and implementation

**Files:**

- Modify: `src/lifecycle/github-lifecycle-provider.ts:173-220`
- Modify: `test/unit/lifecycle/github-lifecycle-provider.test.ts`

**Step 1: Write failing tests**

Add a new `describe` block inside the existing `describe("create()")` block in `test/unit/lifecycle/github-lifecycle-provider.test.ts`:

```ts
describe("create() with defaultBranch", () => {
  test("renames branch when GitHub created a different default branch", async () => {
    const { mock: executor, calls } = createMockExecutor({
      responses: new Map([
        // gh repo create succeeds
        ["gh repo create", ""],
        // GET repo -> actual default branch is "master"
        ["--jq '.default_branch'", "master"],
        // POST branch rename succeeds
        ["branches/'master'/rename", ""],
        // GET README SHA
        ["contents/README.md --jq", "abc123def"],
        // DELETE README
        ["--method DELETE", ""],
      ]),
      defaultResponse: "",
    });

    const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
    await provider.create(mockRepoInfo, { defaultBranch: "main" });

    // Should have: create, get default_branch, rename, get README sha, delete README
    assert.equal(calls.length, 5);
    assert.ok(calls[1].command.includes("--jq '.default_branch'"));
    assert.ok(calls[2].command.includes("branches/'master'/rename"));
    assert.ok(calls[2].command.includes("--method POST"));
    assert.ok(calls[2].command.includes("'main'"));
  });

  test("skips rename when GitHub created branch matches desired name", async () => {
    const { mock: executor, calls } = createMockExecutor({
      responses: new Map([
        ["gh repo create", ""],
        ["--jq '.default_branch'", "main"],
        ["contents/README.md --jq", "abc123def"],
        ["--method DELETE", ""],
      ]),
      defaultResponse: "",
    });

    const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
    await provider.create(mockRepoInfo, { defaultBranch: "main" });

    // Should have: create, get default_branch, get README sha, delete README (no rename)
    assert.equal(calls.length, 4);
    assert.ok(!calls.some((c) => c.command.includes("branches/")));
  });

  test("no extra API calls when defaultBranch is not set", async () => {
    const { mock: executor, calls } = createMockExecutor({
      responses: new Map([["contents/README.md --jq", "abc123def"]]),
      defaultResponse: "",
    });

    const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
    await provider.create(mockRepoInfo);

    // Should have: create, get README sha, delete README (no default_branch check)
    assert.equal(calls.length, 3);
    assert.ok(!calls.some((c) => c.command.includes("default_branch")));
  });

  test("error propagates from rename API and deleteReadme is not reached", async () => {
    const { mock: executor, calls } = createMockExecutor({
      responses: new Map([
        ["gh repo create", ""],
        ["--jq '.default_branch'", "master"],
        [
          "branches/'master'/rename",
          new Error("Rename failed: 422 Unprocessable Entity"),
        ],
      ]),
      defaultResponse: "",
    });

    const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

    await assert.rejects(
      () => provider.create(mockRepoInfo, { defaultBranch: "main" }),
      /Rename failed/
    );

    // Should have: create, get default_branch, rename (failed) - no README calls
    assert.equal(calls.length, 3);
    assert.ok(!calls.some((c) => c.command.includes("contents/README.md")));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run build && node --test test/unit/lifecycle/github-lifecycle-provider.test.ts`
Expected: FAIL — no rename logic exists in `create()`

**Step 3: Write minimal implementation**

In `src/lifecycle/github-lifecycle-provider.ts`, modify `create()` to add branch rename between repo creation and `deleteReadme`. The new `create()` method:

```ts
  async create(
    repoInfo: RepoInfo,
    settings?: CreateRepoSettings,
    token?: string
  ): Promise<void> {
    this.assertGitHub(repoInfo);

    const tokenPrefix = this.buildTokenPrefix(token);
    const parts: string[] = [
      `${tokenPrefix}gh repo create`,
      escapeShellArg(`${repoInfo.owner}/${repoInfo.repo}`),
    ];

    // Visibility flag (default to private for safety)
    if (settings?.visibility === "public") {
      parts.push("--public");
    } else if (settings?.visibility === "internal") {
      parts.push("--internal");
    } else {
      parts.push("--private");
    }

    // Description
    if (settings?.description) {
      parts.push("--description", escapeShellArg(settings.description));
    }

    // Disable features if specified
    if (settings?.hasIssues === false) {
      parts.push("--disable-issues");
    }
    if (settings?.hasWiki === false) {
      parts.push("--disable-wiki");
    }

    // Add --add-readme to establish the default branch via an initial commit.
    // This avoids empty repos where HEAD doesn't resolve.
    parts.push("--add-readme");

    const command = parts.join(" ");

    await withRetry(() => this.executor.exec(command, this.cwd), {
      retries: this.retries,
    });

    // Rename default branch if requested and it differs from what GitHub created.
    if (settings?.defaultBranch) {
      await this.renameDefaultBranchAfterCreate(repoInfo, settings.defaultBranch, token);
    }

    // Delete the README so xfg sync starts from a clean state.
    await this.deleteReadme(repoInfo, token);
  }
```

Add the private helper method after `deleteReadme`:

```ts
  /**
   * Rename the default branch after repo creation if it differs from the desired name.
   * Uses the GitHub branch rename API which automatically updates the default branch pointer.
   */
  private async renameDefaultBranchAfterCreate(
    repoInfo: GitHubRepoInfo,
    desiredBranch: string,
    token?: string
  ): Promise<void> {
    const tokenPrefix = this.buildTokenPrefix(token);
    const hostnameFlag = getHostnameFlag(repoInfo);
    const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
    const apiPath = `repos/${escapeShellArg(repoInfo.owner)}/${escapeShellArg(repoInfo.repo)}`;

    // After repo creation, GitHub may return 404 due to eventual consistency.
    // Exclude 404/not-found from permanent errors so withRetry retries them.
    const postCreatePermanentPatterns = DEFAULT_PERMANENT_ERROR_PATTERNS.filter(
      (p) => !p.test("404 Not Found")
    );

    // Detect the actual default branch name
    const actualBranch = (
      await withRetry(
        () =>
          this.executor.exec(
            `${tokenPrefix}gh api ${hostnamePart}${apiPath} --jq '.default_branch'`,
            this.cwd
          ),
        {
          retries: this.retries,
          permanentErrorPatterns: postCreatePermanentPatterns,
        }
      )
    ).trim();

    if (actualBranch === desiredBranch) {
      return;
    }

    // Rename the branch - GitHub automatically updates the default branch pointer
    await withRetry(
      () =>
        this.executor.exec(
          `${tokenPrefix}gh api ${hostnamePart}${apiPath}/branches/${escapeShellArg(actualBranch)}/rename ` +
            `--method POST -f new_name=${escapeShellArg(desiredBranch)}`,
          this.cwd
        ),
      {
        retries: this.retries,
      }
    );
  }
```

**Step 4: Run tests to verify they pass**

Run: `npm run build && node --test test/unit/lifecycle/github-lifecycle-provider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lifecycle/github-lifecycle-provider.ts test/unit/lifecycle/github-lifecycle-provider.test.ts
git commit -m "feat(lifecycle): rename default branch after create when settings.repo.defaultBranch is set"
```

---

### Task 3: Branch rename in `receiveMigration()` — unit tests and implementation

**Files:**

- Modify: `src/lifecycle/github-lifecycle-provider.ts:345-430`
- Modify: `test/unit/lifecycle/github-lifecycle-provider.test.ts`

**Step 1: Write failing tests**

Add a new `describe` block inside the existing `describe("receiveMigration()")` block:

```ts
describe("receiveMigration() with defaultBranch", () => {
  test("renames branch in mirror clone when source HEAD differs from desired", async () => {
    const { mock: executor, calls } = createMockExecutor({
      responses: new Map([
        ["for-each-ref", "refs/heads/master\nrefs/tags/v1.0"],
        ["symbolic-ref HEAD", "refs/heads/master"],
      ]),
      defaultResponse: "",
    });

    const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
    await provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror", {
      defaultBranch: "main",
    });

    const branchRenameCall = calls.find((c) => c.command.includes("branch -m"));
    assert.ok(branchRenameCall, "should call git branch -m");
    assert.ok(branchRenameCall.command.includes("'master'"));
    assert.ok(branchRenameCall.command.includes("'main'"));

    const symrefSetCall = calls.find((c) =>
      c.command.includes("symbolic-ref HEAD refs/heads/")
    );
    assert.ok(symrefSetCall, "should update symbolic-ref HEAD");
    assert.ok(symrefSetCall.command.includes("refs/heads/'main'"));
  });

  test("skips rename when source HEAD matches desired branch", async () => {
    const { mock: executor, calls } = createMockExecutor({
      responses: new Map([
        ["for-each-ref", "refs/heads/main\nrefs/tags/v1.0"],
        ["symbolic-ref HEAD", "refs/heads/main"],
      ]),
      defaultResponse: "",
    });

    const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
    await provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror", {
      defaultBranch: "main",
    });

    assert.ok(!calls.some((c) => c.command.includes("branch -m")));
  });

  test("no git rename ops when defaultBranch is not set", async () => {
    const { mock: executor, calls } = createMockExecutor({
      responses: new Map([
        ["for-each-ref", "refs/heads/master\nrefs/tags/v1.0\nrefs/pull/1/head"],
      ]),
      defaultResponse: "",
    });

    const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
    await provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror");

    assert.ok(!calls.some((c) => c.command.includes("symbolic-ref HEAD")));
    assert.ok(!calls.some((c) => c.command.includes("branch -m")));
  });

  test("throws descriptive error when symbolic-ref output is not refs/heads/", async () => {
    const { mock: executor } = createMockExecutor({
      responses: new Map([
        ["for-each-ref", "refs/heads/main"],
        ["symbolic-ref HEAD", "refs/tags/v1.0"],
      ]),
      defaultResponse: "",
    });

    const provider = new GitHubLifecycleProvider({ executor, retries: 0 });

    await assert.rejects(
      () =>
        provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror", {
          defaultBranch: "main",
        }),
      /refs\/heads\//
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run build && node --test test/unit/lifecycle/github-lifecycle-provider.test.ts`
Expected: FAIL — no rename logic exists in `receiveMigration()`

**Step 3: Write minimal implementation**

In `src/lifecycle/github-lifecycle-provider.ts`, in `receiveMigration()`, insert branch rename logic **after** the ref-stripping try/catch block and **before** the `gh repo create --source --push` block:

```ts
// Rename default branch in mirror clone if requested.
if (settings?.defaultBranch) {
  const headRef = (
    await this.executor.exec(
      `git -C ${escapeShellArg(sourceDir)} symbolic-ref HEAD`,
      this.cwd
    )
  ).trim();

  const prefix = "refs/heads/";
  if (!headRef.startsWith(prefix)) {
    throw new Error(
      `Mirror clone HEAD symbolic-ref is '${headRef}', expected to start with '${prefix}'. ` +
        `Cannot rename default branch.`
    );
  }

  const sourceBranch = headRef.slice(prefix.length);

  if (sourceBranch !== settings.defaultBranch) {
    await this.executor.exec(
      `git -C ${escapeShellArg(sourceDir)} branch -m ${escapeShellArg(sourceBranch)} ${escapeShellArg(settings.defaultBranch)}`,
      this.cwd
    );
    await this.executor.exec(
      `git -C ${escapeShellArg(sourceDir)} symbolic-ref HEAD refs/heads/${escapeShellArg(settings.defaultBranch)}`,
      this.cwd
    );
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run build && node --test test/unit/lifecycle/github-lifecycle-provider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lifecycle/github-lifecycle-provider.ts test/unit/lifecycle/github-lifecycle-provider.test.ts
git commit -m "feat(lifecycle): rename default branch in mirror clone during migration"
```

---

### Task 4: Fork ignores `defaultBranch` — unit test

**Files:**

- Modify: `test/unit/lifecycle/github-lifecycle-provider.test.ts`

**Step 1: Write the test**

Add inside the existing `describe("fork()")` block:

```ts
test("fork with defaultBranch set completes without rename", async () => {
  const { mock: executor, calls } = createMockExecutor({
    responses: new Map([
      ["users/", '{"type": "Organization"}'],
      ["gh repo fork", ""],
    ]),
    defaultResponse: "",
  });

  const provider = new GitHubLifecycleProvider({ executor, retries: 0 });
  await provider.fork!(upstreamRepoInfo, mockRepoInfo, {
    defaultBranch: "main",
  });

  // Should not call any branch rename API
  assert.ok(!calls.some((c) => c.command.includes("branches/")));
  assert.ok(!calls.some((c) => c.command.includes("branch -m")));
});
```

Note: `upstreamRepoInfo` is already defined in the fork describe block (line 330-336 of the test file).

**Step 2: Run test to verify it passes**

Run: `npm run build && node --test test/unit/lifecycle/github-lifecycle-provider.test.ts`
Expected: PASS (fork already ignores `defaultBranch` — this is a safety net test)

**Step 3: Commit**

```bash
git add test/unit/lifecycle/github-lifecycle-provider.test.ts
git commit -m "test(lifecycle): verify fork ignores defaultBranch setting"
```

---

### Task 5: Integration tests — create with defaultBranch

**Files:**

- Modify: `test/integration/github-lifecycle.test.ts`
- Modify: `test/integration/github-lifecycle-app.test.ts`

**Step 1: Add integration test to PAT file**

Add after the existing "create with settings: description is applied" test in `test/integration/github-lifecycle.test.ts`:

```ts
test("create with defaultBranch: renames default branch to desired name", async () => {
  const repoName = generateRepoName();
  reposToDelete.push(repoName);

  const configPath = writeConfig(
    tmpDir,
    `id: lifecycle-create-defaultbranch-test
settings:
  repo:
    defaultBranch: main
files:
  lifecycle-test.json:
    content:
      created: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
  );

  console.log(
    `\nCreating repo ${OWNER}/${repoName} with defaultBranch: main via xfg sync...`
  );
  const output = exec(
    `node dist/cli.js sync --config ${configPath} --merge direct`,
    { cwd: projectRoot }
  );
  console.log(output);

  assert.ok(
    repoExists(OWNER, repoName),
    `Repo ${repoName} should exist after sync`
  );

  const defaultBranch = exec(
    `gh api repos/${OWNER}/${repoName} --jq '.default_branch'`
  );
  assert.equal(defaultBranch, "main", "Default branch should be 'main'");

  console.log("  Create with defaultBranch test passed");
});
```

**Step 2: Add matching test to App auth file**

Add in `test/integration/github-lifecycle-app.test.ts` after "create with settings" test, using `xfgEnv`:

```ts
test("create with defaultBranch: renames default branch to desired name (App auth)", async () => {
  const repoName = generateRepoName();
  reposToDelete.push(repoName);

  const configPath = writeConfig(
    tmpDir,
    `id: lifecycle-create-defaultbranch-app-test
settings:
  repo:
    defaultBranch: main
files:
  lifecycle-test.json:
    content:
      created: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
  );

  console.log(
    `\nCreating repo ${OWNER}/${repoName} with defaultBranch: main via xfg sync (App)...`
  );
  const output = exec(
    `node dist/cli.js sync --config ${configPath} --merge direct`,
    xfgEnv
  );
  console.log(output);

  assert.ok(
    repoExists(OWNER, repoName),
    `Repo ${repoName} should exist after sync`
  );

  const defaultBranch = exec(
    `gh api repos/${OWNER}/${repoName} --jq '.default_branch'`
  );
  assert.equal(defaultBranch, "main", "Default branch should be 'main'");

  console.log("  Create with defaultBranch test (App) passed");
});
```

**Step 3: Commit**

```bash
git add test/integration/github-lifecycle.test.ts test/integration/github-lifecycle-app.test.ts
git commit -m "test(lifecycle): add integration tests for create with defaultBranch"
```

---

### Task 6: Integration tests — migrate with defaultBranch rename

**Files:**

- Modify: `test/integration/github-lifecycle.test.ts`
- Modify: `test/integration/github-lifecycle-app.test.ts`

**Step 1: Add integration test to PAT file**

Add after the create-with-defaultBranch test in `test/integration/github-lifecycle.test.ts`. The ADO source repo `fxg-test` has `master` as its default branch:

```ts
test(
  "migrate with defaultBranch: renames master to main during migration",
  { skip: !HAS_ADO_CREDS },
  async () => {
    const repoName = generateRepoName();
    reposToDelete.push(repoName);

    const configPath = writeConfig(
      tmpDir,
      `id: lifecycle-migrate-defaultbranch-test
settings:
  repo:
    defaultBranch: main
files:
  lifecycle-migrate-test.json:
    content:
      migrated: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    source: ${ADO_MIGRATE_SOURCE}
`
    );

    console.log(
      `\nMigrating from ADO to ${OWNER}/${repoName} with defaultBranch: main...`
    );
    const output = exec(
      `node dist/cli.js sync --config ${configPath} --merge direct`,
      { cwd: projectRoot }
    );
    console.log(output);

    assert.ok(
      repoExists(OWNER, repoName),
      `Repo ${repoName} should exist after migrate`
    );

    const defaultBranch = exec(
      `gh api repos/${OWNER}/${repoName} --jq '.default_branch'`
    );
    assert.equal(
      defaultBranch,
      "main",
      "Default branch should be 'main' after rename"
    );

    console.log("  Migrate with defaultBranch test passed");
  }
);
```

**Step 2: Add matching test to App auth file**

Add in `test/integration/github-lifecycle-app.test.ts` with `xfgEnv`:

```ts
test(
  "migrate with defaultBranch: renames master to main during migration (App auth)",
  { skip: !HAS_ADO_CREDS },
  async () => {
    const repoName = generateRepoName();
    reposToDelete.push(repoName);

    const configPath = writeConfig(
      tmpDir,
      `id: lifecycle-migrate-defaultbranch-app-test
settings:
  repo:
    defaultBranch: main
files:
  lifecycle-migrate-test.json:
    content:
      migrated: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    source: ${ADO_MIGRATE_SOURCE}
`
    );

    console.log(
      `\nMigrating from ADO to ${OWNER}/${repoName} with defaultBranch: main (App)...`
    );
    const output = exec(
      `node dist/cli.js sync --config ${configPath} --merge direct`,
      xfgEnv
    );
    console.log(output);

    assert.ok(
      repoExists(OWNER, repoName),
      `Repo ${repoName} should exist after migrate`
    );

    const defaultBranch = exec(
      `gh api repos/${OWNER}/${repoName} --jq '.default_branch'`
    );
    assert.equal(
      defaultBranch,
      "main",
      "Default branch should be 'main' after rename"
    );

    console.log("  Migrate with defaultBranch test (App) passed");
  }
);
```

**Step 3: Commit**

```bash
git add test/integration/github-lifecycle.test.ts test/integration/github-lifecycle-app.test.ts
git commit -m "test(lifecycle): add integration tests for migrate with defaultBranch rename"
```

---

### Task 7: Update lifecycle documentation

**Files:**

- Modify: `docs/configuration/lifecycle.md`

**Step 1: Update the Creation Settings table**

In `docs/configuration/lifecycle.md`, replace the table at lines 117-122 with:

```markdown
| Setting         | Description                                            |
| --------------- | ------------------------------------------------------ |
| `description`   | Repository description                                 |
| `visibility`    | `public`, `private`, or `internal`                     |
| `hasIssues`     | Enable/disable Issues (default: enabled)               |
| `hasWiki`       | Enable/disable Wiki (default: enabled)                 |
| `defaultBranch` | Rename the default branch during creation or migration |
```

**Step 2: Add defaultBranch section after the Empty Repository Initialization section (after line 126)**

````markdown
### Default Branch Renaming

When `settings.repo.defaultBranch` is set, xfg renames the default branch during lifecycle operations:

| Operation    | Behaviour                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------- |
| **Create**   | After creating the repo, detects the actual branch name and renames it via the GitHub API    |
| **Migrate**  | Before pushing the mirror clone, renames the source HEAD branch in git                       |
| **Fork**     | Ignored — forked repos inherit the upstream's branch structure                               |
| **Settings** | Existing behaviour — updates the GitHub API pointer (branch must already exist by that name) |

```yaml
# Migrate ADO repo with 'master', rename to 'main' on GitHub
repos:
  - git: git@github.com:my-org/migrated-app.git
    source: https://dev.azure.com/myorg/myproject/_git/legacy-app
    settings:
      repo:
        defaultBranch: main
```
````

**Step 3: Commit**

```bash
git add docs/configuration/lifecycle.md
git commit -m "docs(lifecycle): document defaultBranch rename during create and migrate"
```

---

### Task 8: Run full lint and unit test suite

**Step 1: Run linter**

Run: `./lint.sh`
Expected: PASS

**Step 2: Run full unit tests**

Run: `npm test`
Expected: PASS — all unit tests pass including the new tests

**Step 3: Fix any issues and commit**

If lint/test failures, fix and commit. Otherwise, no action needed.

---

### Task 9: Run integration tests locally (PAT)

**Step 1: Build**

Run: `npm run build`

**Step 2: Run GitHub lifecycle integration tests**

Run: `npm run test:integration:github-lifecycle`
Expected: PASS — both new tests pass. The migrate test requires `AZURE_DEVOPS_EXT_PAT`; it will be skipped automatically if not set.

**Step 3: Fix any issues and commit**

If integration test failures, fix and commit.
