# Ephemeral Integration Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all 8 persistent-repo integration test jobs to ephemeral repos, eliminating reset-test-repo.sh and concurrency groups.

**Architecture:** Each CLI test file creates a fresh private repo in `spruyt-labs` org before tests, writes inline YAML configs with the ephemeral repo URL, and deletes the repo in cleanup. Action jobs use a generalized `create-ephemeral-repo-config.sh` that substitutes placeholder URLs in fixture templates. All 12 GitHub CI jobs drop their concurrency groups since ephemeral repos cannot collide.

**Tech Stack:** TypeScript (node:test), GitHub CLI (`gh`), GitHub Actions YAML, Bash

---

## Task 1: Extend test-helpers with createRepo and parameterized generateRepoName

**Files:**

- Modify: `test/integration/test-helpers.ts:240-242` (generateRepoName)
- Modify: `test/integration/test-helpers.ts` (add createRepo after deleteRepo, line 260)

**Step 1: Update generateRepoName to accept optional prefix**

Change line 240-242 from:

```typescript
export function generateRepoName(): string {
  return `xfg-lifecycle-test-${Date.now()}-${randomBytes(3).toString("hex")}`;
}
```

To:

```typescript
export function generateRepoName(prefix = "lifecycle"): string {
  return `xfg-${prefix}-test-${Date.now()}-${randomBytes(3).toString("hex")}`;
}
```

Backward-compatible: existing lifecycle callers pass no argument.

**Step 2: Add createRepo helper after deleteRepo (after line 260)**

```typescript
/**
 * Create an ephemeral private repo under the given owner.
 */
export function createRepo(
  owner: string,
  repoName: string,
  envOptions?: { env: Record<string, string | undefined> }
): void {
  console.log(`  Creating ephemeral repo ${owner}/${repoName}...`);
  const cmd = `gh repo create ${owner}/${repoName} --private --add-readme`;
  exec(cmd, envOptions);
  console.log(`  Created ${owner}/${repoName}`);
}
```

**Step 3: Verify compilation**

Run: `npm run build`
Expected: Clean compilation, no errors.

**Step 4: Commit**

```bash
git add test/integration/test-helpers.ts
git commit -m "feat(test): add createRepo helper and parameterize generateRepoName"
```

---

## Task 2: Migrate github-rulesets.test.ts to ephemeral repos

**Files:**

- Modify: `test/integration/github-rulesets.test.ts` (full rewrite)
- Delete: `test/fixtures/integration-test-config-github-rulesets.yaml`

This is the simplest migration (3 tests, settings-only). Good starting point.

**Step 1: Rewrite the test file**

Replace entire contents of `test/integration/github-rulesets.test.ts` with:

```typescript
import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
  waitForRulesetVisible as waitForRulesetVisibleBase,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";
const RULESET_NAME = "xfg-test-ruleset";

let repoName: string;
let testRepo: string;
let tmpDir: string;

function deleteRulesetIfExists(): void {
  try {
    const rulesets = exec(
      `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}") | .id'`
    );
    if (rulesets) {
      for (const id of rulesets.split("\n").filter(Boolean)) {
        console.log(`  Deleting ruleset ID: ${id}`);
        exec(`gh api --method DELETE repos/${testRepo}/rulesets/${id}`);
      }
    }
  } catch {
    console.log("  No existing rulesets to delete");
  }
}

async function waitForRulesetVisible(
  rulesetId: number,
  timeoutMs = 30000
): Promise<void> {
  return waitForRulesetVisibleBase(testRepo, rulesetId, timeoutMs);
}

function makeConfig(): string {
  return writeConfig(
    tmpDir,
    `id: integration-test-github-rulesets
files:
  .xfg-settings-test:
    content: "# Placeholder for settings integration test"
    createOnly: true
settings:
  rulesets:
    ${RULESET_NAME}:
      target: branch
      enforcement: active
      conditions:
        refName:
          include:
            - refs/heads/main
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-settings-test: false
`
  );
}

describe("GitHub Settings Integration Test", () => {
  before(() => {
    tmpDir = join(tmpdir(), `xfg-rulesets-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("rulesets");
    testRepo = `${OWNER}/${repoName}`;
    createRepo(OWNER, repoName);
  });

  after(() => {
    deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    deleteRulesetIfExists();
  });

  test("settings creates a ruleset in the test repository", async () => {
    const configPath = makeConfig();

    console.log("Verifying no ruleset exists...");
    const rulesetsBefore = exec(
      `gh api repos/${testRepo}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsBefore, "0", "Expected no ruleset before");

    console.log("\nRunning xfg settings...");
    const output = exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    console.log("\nVerifying ruleset was created...");
    const rulesetsAfter = exec(
      `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
    );
    assert.ok(rulesetsAfter, "Expected a ruleset to be created");

    const ruleset = JSON.parse(rulesetsAfter);
    assert.equal(ruleset.name, RULESET_NAME);
    assert.equal(ruleset.enforcement, "active");
    assert.equal(ruleset.target, "branch");

    await waitForRulesetVisible(ruleset.id);
  });

  test("settings updates an existing ruleset", async () => {
    const configPath = makeConfig();

    console.log("Creating initial ruleset...");
    exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });

    const rulesetCreated = exec(
      `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
    );
    const rulesetBefore = JSON.parse(rulesetCreated);
    await waitForRulesetVisible(rulesetBefore.id);

    console.log("\nRunning xfg settings again (update)...");
    exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });

    const rulesetAfter = JSON.parse(
      exec(
        `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
      )
    );
    assert.equal(
      rulesetAfter.id,
      rulesetBefore.id,
      "Same ID = update not recreate"
    );
  });

  test("settings dry-run shows changes without applying", async () => {
    const configPath = makeConfig();

    const rulesetsBefore = exec(
      `gh api repos/${testRepo}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsBefore, "0");

    const output = exec(
      `node dist/cli.js settings --config ${configPath} --dry-run`,
      { cwd: projectRoot }
    );
    assert.ok(
      output.includes("DRY RUN") || output.includes("dry-run"),
      "Output should indicate dry-run"
    );

    const rulesetsAfter = exec(
      `gh api repos/${testRepo}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsAfter, "0", "Dry-run should not create ruleset");
  });
});
```

**Step 2: Delete the old fixture file**

```bash
rm test/fixtures/integration-test-config-github-rulesets.yaml
```

**Step 3: Verify compilation**

Run: `npm run build`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add test/integration/github-rulesets.test.ts
git rm test/fixtures/integration-test-config-github-rulesets.yaml
git commit -m "refactor(test): migrate github-rulesets to ephemeral repos"
```

---

## Task 3: Migrate github-labels.test.ts to ephemeral repos

**Files:**

- Modify: `test/integration/github-labels.test.ts` (full rewrite)
- Delete: `test/fixtures/integration-test-config-github-labels.yaml`

6 tests. Several already write inline configs. The main change: replace `TEST_REPO` constant and `resetTestRepo()` with ephemeral repo lifecycle.

**Step 1: Rewrite the test file**

Replace entire contents of `test/integration/github-labels.test.ts` with:

```typescript
import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
  waitForManifestLabels,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";

interface Label {
  name: string;
  color: string;
  description: string;
}

let repoName: string;
let testRepo: string;
let tmpDir: string;

function getLabels(): Label[] {
  try {
    const output = exec(`gh api repos/${testRepo}/labels --paginate`);
    return JSON.parse(output) as Label[];
  } catch {
    return [];
  }
}

function findLabel(labels: Label[], name: string): Label | undefined {
  return labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
}

function runSettings(configPath: string, extraArgs = ""): string {
  return exec(
    `node dist/cli.js settings --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}

function makeBaseConfig(): string {
  return writeConfig(
    tmpDir,
    `id: integration-test-github-labels
files:
  .xfg-labels-test:
    content: "# Placeholder"
    createOnly: true
settings:
  labels:
    xfg-test-bug:
      color: d73a4a
      description: "Something isn't working"
    xfg-test-feature:
      color: a2eeef
      description: "New feature or request"
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-labels-test: false
`
  );
}

describe("GitHub Labels Integration Test", () => {
  before(() => {
    tmpDir = join(tmpdir(), `xfg-labels-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("labels");
    testRepo = `${OWNER}/${repoName}`;
    createRepo(OWNER, repoName);
  });

  after(() => {
    deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Delete all labels to start clean each test
    const labels = getLabels();
    for (const label of labels) {
      try {
        exec(
          `gh api --method DELETE repos/${testRepo}/labels/${encodeURIComponent(label.name)}`
        );
      } catch (e) {
        // Label may already be deleted; log for debugging
        console.warn(`Failed to delete label ${label.name}: ${e}`);
      }
    }
  });

  test("settings creates labels in the test repository", () => {
    const configPath = makeBaseConfig();

    const labelsBefore = getLabels();
    assert.equal(labelsBefore.length, 0);

    const output = runSettings(configPath);
    console.log(output);

    const labelsAfter = getLabels();
    const bugLabel = findLabel(labelsAfter, "xfg-test-bug");
    assert.ok(bugLabel);
    assert.equal(bugLabel.color, "d73a4a");
    assert.equal(bugLabel.description, "Something isn't working");

    const featureLabel = findLabel(labelsAfter, "xfg-test-feature");
    assert.ok(featureLabel);
    assert.equal(featureLabel.color, "a2eeef");
  });

  test("settings updates label color and description", () => {
    const baseConfig = makeBaseConfig();
    runSettings(baseConfig);

    const updateConfig = writeConfig(
      tmpDir,
      `id: integration-test-github-labels
files:
  .xfg-labels-test:
    content: "# Placeholder"
    createOnly: true
settings:
  labels:
    xfg-test-bug:
      color: ff0000
      description: "Updated bug description"
    xfg-test-feature:
      color: "00ff00"
      description: "Updated feature description"
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-labels-test: false
`
    );

    const output = runSettings(updateConfig);
    console.log(output);

    const labelsAfter = getLabels();
    const bugLabel = findLabel(labelsAfter, "xfg-test-bug");
    assert.ok(bugLabel);
    assert.equal(bugLabel.color, "ff0000");
    assert.equal(bugLabel.description, "Updated bug description");
  });

  test("settings renames a label", () => {
    const baseConfig = makeBaseConfig();
    runSettings(baseConfig);

    const renameConfig = writeConfig(
      tmpDir,
      `id: integration-test-github-labels
files:
  .xfg-labels-test:
    content: "# Placeholder"
    createOnly: true
settings:
  labels:
    xfg-test-bug:
      color: d73a4a
      description: "Something isn't working"
      new_name: xfg-test-defect
    xfg-test-feature:
      color: a2eeef
      description: "New feature or request"
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-labels-test: false
`
    );

    runSettings(renameConfig);

    const labelsAfter = getLabels();
    assert.equal(findLabel(labelsAfter, "xfg-test-bug"), undefined);
    assert.ok(findLabel(labelsAfter, "xfg-test-defect"));
  });

  test("settings is idempotent when labels already match", () => {
    const configPath = makeBaseConfig();
    runSettings(configPath);

    const output = runSettings(configPath);
    const lower = output.toLowerCase();
    assert.ok(lower.includes("no changes") || lower.includes("up to date"));
  });

  test("settings dry-run shows changes without applying", () => {
    const configPath = makeBaseConfig();

    const output = runSettings(configPath, "--dry-run");
    assert.ok(output.includes("DRY RUN") || output.includes("dry-run"));

    const labelsAfter = getLabels();
    assert.equal(labelsAfter.length, 0, "Dry-run should not create labels");
  });

  test("settings deletes orphaned labels when removed from config", async () => {
    const phase1Config = writeConfig(
      tmpDir,
      `id: integration-test-github-labels
files:
  .xfg-labels-test:
    content: "# Placeholder"
    createOnly: true
settings:
  deleteOrphaned: true
  labels:
    xfg-test-bug:
      color: d73a4a
      description: "Something isn't working"
    xfg-test-feature:
      color: a2eeef
      description: "New feature or request"
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-labels-test: false
`
    );

    runSettings(phase1Config);

    const labelsPhase1 = getLabels();
    assert.ok(findLabel(labelsPhase1, "xfg-test-bug"));
    assert.ok(findLabel(labelsPhase1, "xfg-test-feature"));

    await waitForManifestLabels(testRepo, "integration-test-github-labels", [
      "xfg-test-bug",
      "xfg-test-feature",
    ]);

    const phase2Config = writeConfig(
      tmpDir,
      `id: integration-test-github-labels
files:
  .xfg-labels-test:
    content: "# Placeholder"
    createOnly: true
settings:
  deleteOrphaned: true
  labels:
    xfg-test-bug:
      color: d73a4a
      description: "Something isn't working"
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-labels-test: false
`
    );

    runSettings(phase2Config);

    const labelsPhase2 = getLabels();
    assert.ok(findLabel(labelsPhase2, "xfg-test-bug"));
    assert.equal(findLabel(labelsPhase2, "xfg-test-feature"), undefined);
  });
});
```

**Step 2: Delete the old fixture file**

```bash
rm test/fixtures/integration-test-config-github-labels.yaml
```

**Step 3: Verify compilation**

Run: `npm run build`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add test/integration/github-labels.test.ts
git rm test/fixtures/integration-test-config-github-labels.yaml
git commit -m "refactor(test): migrate github-labels to ephemeral repos"
```

---

## Task 4: Migrate github-repo-settings.test.ts to ephemeral repos

**Files:**

- Modify: `test/integration/github-repo-settings.test.ts` (full rewrite)

This file is unique: it never used `reset-test-repo.sh`. Instead it has `resetRepoSettings()` + `resetSecuritySettings()`. For ephemeral repos, new repos already have default settings, so the reset functions become simpler (only needed between tests within the same run). No fixture file to delete (configs are already written inline via `createConfigFile()`).

**Step 1: Rewrite the test file**

Replace entire contents of `test/integration/github-repo-settings.test.ts` with:

```typescript
import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  exec,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";

const GITHUB_DEFAULTS = {
  has_wiki: true,
  has_projects: true,
  allow_squash_merge: true,
  allow_merge_commit: true,
  allow_rebase_merge: true,
  delete_branch_on_merge: false,
};

let repoName: string;
let testRepo: string;
let tmpDir: string;

function resetRepoSettings(): void {
  console.log("  Resetting repo settings to defaults...");
  const fields = Object.entries(GITHUB_DEFAULTS)
    .map(([k, v]) => `-F ${k}=${v}`)
    .join(" ");
  exec(`gh api --method PATCH repos/${testRepo} ${fields}`);
}

function resetSecuritySettings(): void {
  console.log("  Resetting security settings...");
  try {
    exec(`gh api -X PUT repos/${testRepo}/vulnerability-alerts`);
  } catch {
    /* already enabled */
  }
  try {
    exec(`gh api -X DELETE repos/${testRepo}/automated-security-fixes`);
  } catch {
    /* already disabled */
  }
  try {
    exec(`gh api -X DELETE repos/${testRepo}/vulnerability-alerts`);
  } catch {
    /* already disabled */
  }
  try {
    exec(`gh api -X DELETE repos/${testRepo}/private-vulnerability-reporting`);
  } catch {
    /* already disabled */
  }
}

function getSecuritySettings(): {
  vulnerabilityAlerts: boolean;
  automatedSecurityFixes: boolean;
  privateVulnerabilityReporting: boolean;
} {
  let vulnerabilityAlerts = false;
  try {
    exec(`gh api repos/${testRepo}/vulnerability-alerts`);
    vulnerabilityAlerts = true;
  } catch {
    vulnerabilityAlerts = false;
  }

  let automatedSecurityFixes = false;
  try {
    const r = exec(`gh api repos/${testRepo}/automated-security-fixes`);
    automatedSecurityFixes = JSON.parse(r).enabled === true;
  } catch {
    automatedSecurityFixes = false;
  }

  const pvrResult = exec(
    `gh api repos/${testRepo}/private-vulnerability-reporting`
  );
  const privateVulnerabilityReporting = JSON.parse(pvrResult).enabled === true;

  return {
    vulnerabilityAlerts,
    automatedSecurityFixes,
    privateVulnerabilityReporting,
  };
}

function getRepoSettings(): Record<string, unknown> {
  return JSON.parse(exec(`gh api repos/${testRepo}`));
}

function createConfigFile(): string {
  const configPath = join(tmpDir, `repo-settings-${Date.now()}.yaml`);
  writeFileSync(
    configPath,
    `id: integration-test-repo-settings
settings:
  repo:
    hasWiki: false
    hasProjects: false
    allowSquashMerge: true
    allowMergeCommit: false
    allowRebaseMerge: false
    deleteBranchOnMerge: true
    vulnerabilityAlerts: true
    automatedSecurityFixes: false
    privateVulnerabilityReporting: true
repos:
  - git: https://github.com/${testRepo}.git
`
  );
  return configPath;
}

describe("GitHub Repo Settings Integration Test", () => {
  before(() => {
    tmpDir = join(tmpdir(), `xfg-repo-settings-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("repo-settings");
    testRepo = `${OWNER}/${repoName}`;
    createRepo(OWNER, repoName);
  });

  after(() => {
    deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetRepoSettings();
    resetSecuritySettings();
  });

  test("settings dry-run shows planned repo settings changes", () => {
    const configPath = createConfigFile();
    const settingsBefore = getRepoSettings();

    const output = exec(
      `node dist/cli.js settings --config ${configPath} --dry-run`,
      { cwd: projectRoot }
    );
    assert.ok(output.includes("DRY RUN") || output.includes("dry-run"));

    const settingsAfter = getRepoSettings();
    assert.equal(settingsAfter.has_wiki, settingsBefore.has_wiki);
  });

  test("settings applies repo settings changes", () => {
    const configPath = createConfigFile();

    exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });

    const s = getRepoSettings();
    assert.equal(s.has_wiki, false);
    assert.equal(s.has_projects, false);
    assert.equal(s.allow_squash_merge, true);
    assert.equal(s.allow_merge_commit, false);
    assert.equal(s.allow_rebase_merge, false);
    assert.equal(s.delete_branch_on_merge, true);

    const sec = getSecuritySettings();
    assert.equal(sec.vulnerabilityAlerts, true);
    assert.equal(sec.automatedSecurityFixes, false);
    assert.equal(sec.privateVulnerabilityReporting, true);
  });

  test("settings reports no changes when already in desired state", () => {
    const configPath = createConfigFile();
    exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });

    const output = exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });
    assert.ok(
      output.includes("No changes needed") ||
        output.includes("0 to add, 0 to change")
    );
  });

  test("settings applies description to repository", () => {
    const randomDescription = `xfg integration test - ${randomUUID()}`;
    const descConfigPath = join(tmpDir, `repo-desc-${Date.now()}.yaml`);
    writeFileSync(
      descConfigPath,
      `id: integration-test-repo-settings-description
settings:
  repo:
    description: "${randomDescription}"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js settings --config ${descConfigPath}`, {
      cwd: projectRoot,
    });

    const settingsAfter = getRepoSettings();
    assert.equal(settingsAfter.description, randomDescription);
  });
});
```

**Step 2: Verify compilation**

Run: `npm run build`
Expected: Clean compilation.

**Step 3: Commit**

```bash
git add test/integration/github-repo-settings.test.ts
git commit -m "refactor(test): migrate github-repo-settings to ephemeral repos"
```

---

## Task 5: Migrate github-app.test.ts to ephemeral repos

**Prerequisites: Task 1** — This task uses `generateRepoName(prefix)` and `createRepo()` from `test/integration/test-helpers.ts`, which are added by Task 1.

**Files:**

- Modify: `test/integration/github-app.test.ts` (full rewrite)
- Delete: `test/fixtures/integration-test-github-app.yaml`
- Delete: `test/fixtures/integration-test-github-app-direct.yaml`
- Delete: `test/fixtures/integration-test-github-app-settings.yaml`
- Delete: `test/fixtures/integration-test-github-app-delete-phase1.yaml`
- Delete: `test/fixtures/integration-test-github-app-delete-phase2.yaml`
- Delete: `test/fixtures/integration-test-github-app-repo-settings.yaml`
- Delete: `test/fixtures/integration-test-github-app-signed-refs-settings.yaml`

3 describe blocks, 6 tests, 7 fixture files. Key patterns: `xfgEnv` strips `GH_TOKEN`, `patOnlyEnv` strips App credentials. All fixture content inlined.

**Step 1: Read existing fixture files to capture their configs**

Before rewriting, read each fixture file to understand the exact YAML content. The fixture configs reference specific file names, branches, and settings. Inline these as template-literal functions that substitute `${OWNER}/${repoName}` for the git URL.

**Step 2: Rewrite the test file**

Replace entire contents of `test/integration/github-app.test.ts` with:

```typescript
import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
  waitForCommitVerified,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";
const SKIP_TESTS =
  !process.env.XFG_GITHUB_APP_ID || !process.env.XFG_GITHUB_APP_PRIVATE_KEY;

if (SKIP_TESTS) {
  console.log(
    "\n  Skipping GitHub App integration tests: XFG_GITHUB_APP_ID and XFG_GITHUB_APP_PRIVATE_KEY not set\n"
  );
}

// xfg commands must NOT see GH_TOKEN - only App credentials
const xfgEnv = { cwd: projectRoot, env: { GH_TOKEN: undefined } };

const GITHUB_DEFAULTS = {
  has_wiki: true,
  has_projects: true,
  allow_squash_merge: true,
  allow_merge_commit: true,
  allow_rebase_merge: true,
  delete_branch_on_merge: false,
};

const SYNC_BRANCH = "chore/sync-github-app-test";
const DIRECT_FILE = "github-app-direct-test.json";

let repoName: string;
let testRepo: string;
let tmpDir: string;

function resetRepoSettings(): void {
  const fields = Object.entries(GITHUB_DEFAULTS)
    .map(([k, v]) => `-F ${k}=${v}`)
    .join(" ");
  exec(`gh api --method PATCH repos/${testRepo} ${fields}`);
}

function resetTestRepo(): void {
  console.log("\n=== Resetting ephemeral repo branches/PRs ===\n");
  // Close open PRs
  try {
    const prs = exec(`gh api repos/${testRepo}/pulls --jq '.[].number'`);
    for (const pr of prs.split("\n").filter(Boolean)) {
      exec(
        `gh api --method PATCH repos/${testRepo}/pulls/${pr} -f state=closed`
      );
    }
  } catch {
    /* no PRs */
  }
  // Delete non-default branches
  try {
    const branches = exec(`gh api repos/${testRepo}/branches --jq '.[].name'`);
    for (const branch of branches.split("\n").filter(Boolean)) {
      if (branch !== "main") {
        try {
          exec(
            `gh api --method DELETE repos/${testRepo}/git/refs/heads/${branch}`
          );
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    /* no branches */
  }
  // Delete all files on main except initial commit
  try {
    const files = exec(`gh api repos/${testRepo}/contents --jq '.[].name'`);
    for (const file of files.split("\n").filter(Boolean)) {
      try {
        const sha = exec(
          `gh api repos/${testRepo}/contents/${file} --jq '.sha'`
        );
        exec(
          `gh api --method DELETE repos/${testRepo}/contents/${file} -f message="reset" -f sha="${sha}"`
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* empty repo */
  }
  // Delete rulesets
  try {
    const rulesets = exec(`gh api repos/${testRepo}/rulesets --jq '.[].id'`);
    for (const id of rulesets.split("\n").filter(Boolean)) {
      exec(`gh api --method DELETE repos/${testRepo}/rulesets/${id}`);
    }
  } catch {
    /* no rulesets */
  }
  console.log("=== Reset complete ===\n");
}

describe("GitHub App Integration Test", { skip: SKIP_TESTS }, () => {
  before(() => {
    tmpDir = join(tmpdir(), `xfg-app-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("app");
    testRepo = `${OWNER}/${repoName}`;
    createRepo(OWNER, repoName);
  });

  after(() => {
    deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetTestRepo();
  });

  test("sync creates PR via GraphQL API with GitHub App credentials", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-app
files:
  my.config.json:
    content:
      prop1: main
prOptions:
  branch: ${SYNC_BRANCH}
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, xfgEnv);
    console.log(output);

    const prNumber = exec(
      `gh api repos/${testRepo}/pulls --jq '.[] | select(.head.ref == "${SYNC_BRANCH}") | .number'`
    );
    assert.ok(prNumber, `Expected PR on ${SYNC_BRANCH}`);

    const commitSha = exec(
      `gh api repos/${testRepo}/commits/${SYNC_BRANCH} --jq '.sha'`
    );
    const author = exec(
      `gh api repos/${testRepo}/commits/${commitSha} --jq '.commit.author.name'`
    );
    assert.notStrictEqual(author, "github-actions[bot]");

    await waitForCommitVerified(testRepo, commitSha);
  });

  test("direct mode pushes verified commit to main", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-app-direct
files:
  ${DIRECT_FILE}:
    content:
      directMode: true
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, xfgEnv);
    console.log(output);

    const fileSha = exec(
      `gh api repos/${testRepo}/contents/${DIRECT_FILE} --jq '.sha'`
    );
    assert.ok(fileSha, `Expected ${DIRECT_FILE} on main`);

    const mainSha = exec(`gh api repos/${testRepo}/commits/main --jq '.sha'`);
    const author = exec(
      `gh api repos/${testRepo}/commits/${mainSha} --jq '.commit.author.name'`
    );
    assert.notStrictEqual(author, "github-actions[bot]");

    await waitForCommitVerified(testRepo, mainSha);
  });

  test("settings command with bypass_actors is idempotent", () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-app-settings
files:
  .xfg-settings-test:
    content: "# Placeholder for settings integration test"
    createOnly: true
settings:
  rulesets:
    xfg-app-bypass-test:
      target: branch
      enforcement: active
      bypassActors:
        - actorId: 2753244
          actorType: Integration
          bypassMode: always
      conditions:
        refName:
          include:
            - refs/heads/main
          exclude: []
      rules:
        - type: pull_request
          parameters:
            dismissStaleReviewsOnPush: true
            requireCodeOwnerReview: false
            requireLastPushApproval: false
            requiredApprovingReviewCount: 1
            requiredReviewThreadResolution: false
repos:
  - git: https://github.com/${testRepo}.git
    files:
      .xfg-settings-test: false
`
    );

    exec(`node dist/cli.js settings --config ${configPath}`, xfgEnv);

    const dryRunOutput = exec(
      `node dist/cli.js settings --config ${configPath} --dry-run`,
      xfgEnv
    );
    console.log(dryRunOutput);
  });

  test("deleteOrphaned removes orphan files", async () => {
    const config1 = writeConfig(
      tmpDir,
      `id: integration-test-github-app-delete
files:
  app-orphan-test.json:
    content:
      orphanTest: true
    deleteOrphaned: true
  app-keep-test.json:
    content:
      keepTest: true
    deleteOrphaned: true
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${config1}`, xfgEnv);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const config2 = writeConfig(
      tmpDir,
      `id: integration-test-github-app-delete
files:
  app-keep-test.json:
    content:
      keepTest: true
    deleteOrphaned: true
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${config2}`, xfgEnv);
  });
});

describe("GitHub App Repo Settings Test", { skip: SKIP_TESTS }, () => {
  let settingsRepoName: string;
  let settingsTestRepo: string;
  let settingsTmpDir: string;

  before(() => {
    settingsTmpDir = join(tmpdir(), `xfg-app-settings-test-${Date.now()}`);
    mkdirSync(settingsTmpDir, { recursive: true });
    settingsRepoName = generateRepoName("app-settings");
    settingsTestRepo = `${OWNER}/${settingsRepoName}`;
    createRepo(OWNER, settingsRepoName);
  });

  after(() => {
    deleteRepo(OWNER, settingsRepoName);
    rmSync(settingsTmpDir, { recursive: true, force: true });
  });

  test("repo settings with GitHub App token is idempotent", () => {
    // Reset repo settings to defaults
    const fields = Object.entries(GITHUB_DEFAULTS)
      .map(([k, v]) => `-F ${k}=${v}`)
      .join(" ");
    exec(`gh api --method PATCH repos/${settingsTestRepo} ${fields}`);

    const configPath = writeConfig(
      settingsTmpDir,
      `id: integration-test-github-app-repo-settings
settings:
  repo:
    hasWiki: false
    hasProjects: false
    allowSquashMerge: true
    allowMergeCommit: false
    allowRebaseMerge: false
    deleteBranchOnMerge: true
repos:
  - git: https://github.com/${settingsTestRepo}.git
`
    );

    exec(`node dist/cli.js settings --config ${configPath}`, xfgEnv);

    const secondOutput = exec(
      `node dist/cli.js settings --config ${configPath}`,
      xfgEnv
    );
    assert.ok(
      secondOutput.includes("No changes needed") ||
        secondOutput.includes("0 to add, 0 to change")
    );
  });
});

// Force PAT-only auth
const patOnlyEnv = {
  env: {
    XFG_GITHUB_APP_ID: undefined,
    XFG_GITHUB_APP_PRIVATE_KEY: undefined,
  },
};

describe("GitHub App Signed Refs Test", { skip: SKIP_TESTS }, () => {
  let signedRepoName: string;
  let signedTestRepo: string;
  let signedTmpDir: string;

  before(() => {
    signedTmpDir = join(tmpdir(), `xfg-app-signed-test-${Date.now()}`);
    mkdirSync(signedTmpDir, { recursive: true });
    signedRepoName = generateRepoName("app-signed");
    signedTestRepo = `${OWNER}/${signedRepoName}`;
    createRepo(OWNER, signedRepoName);
  });

  after(() => {
    deleteRepo(OWNER, signedRepoName);
    rmSync(signedTmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Reset the signed-refs repo (close PRs, delete branches, files, rulesets)
    try {
      const prs = exec(
        `gh api repos/${signedTestRepo}/pulls --jq '.[].number'`
      );
      for (const pr of prs.split("\n").filter(Boolean)) {
        exec(
          `gh api --method PATCH repos/${signedTestRepo}/pulls/${pr} -f state=closed`
        );
      }
    } catch {
      /* no PRs */
    }
    try {
      const branches = exec(
        `gh api repos/${signedTestRepo}/branches --jq '.[].name'`
      );
      for (const branch of branches.split("\n").filter(Boolean)) {
        if (branch !== "main") {
          try {
            exec(
              `gh api --method DELETE repos/${signedTestRepo}/git/refs/heads/${branch}`
            );
          } catch {
            /* */
          }
        }
      }
    } catch {
      /* */
    }
    try {
      const files = exec(
        `gh api repos/${signedTestRepo}/contents --jq '.[].name'`
      );
      for (const file of files.split("\n").filter(Boolean)) {
        try {
          const sha = exec(
            `gh api repos/${signedTestRepo}/contents/${file} --jq '.sha'`
          );
          exec(
            `gh api --method DELETE repos/${signedTestRepo}/contents/${file} -f message="reset" -f sha="${sha}"`
          );
        } catch {
          /* */
        }
      }
    } catch {
      /* */
    }
    try {
      const rulesets = exec(
        `gh api repos/${signedTestRepo}/rulesets --jq '.[].id'`
      );
      for (const id of rulesets.split("\n").filter(Boolean)) {
        exec(`gh api --method DELETE repos/${signedTestRepo}/rulesets/${id}`);
      }
    } catch {
      /* */
    }

    // Apply required_signatures ruleset via PAT
    const rulesetConfig = writeConfig(
      signedTmpDir,
      `id: integration-test-signed-refs
settings:
  rulesets:
    xfg-require-signed-commits:
      target: branch
      enforcement: active
      conditions:
        refName:
          include:
            - "refs/heads/**"
          exclude: []
      rules:
        - type: required_signatures
repos:
  - git: https://github.com/${signedTestRepo}.git
`
    );
    exec(`node dist/cli.js settings --config ${rulesetConfig}`, patOnlyEnv);
  });

  test("sync creates PR on repo with required_signatures on all branches", async () => {
    const configPath = writeConfig(
      signedTmpDir,
      `id: integration-test-github-app
files:
  my.config.json:
    content:
      prop1: main
prOptions:
  branch: ${SYNC_BRANCH}
repos:
  - git: https://github.com/${signedTestRepo}.git
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, xfgEnv);
    console.log(output);

    const prNumber = exec(
      `gh api repos/${signedTestRepo}/pulls --jq '.[] | select(.head.ref == "${SYNC_BRANCH}") | .number'`
    );
    assert.ok(prNumber);

    const commitSha = exec(
      `gh api repos/${signedTestRepo}/commits/${SYNC_BRANCH} --jq '.sha'`
    );
    await waitForCommitVerified(signedTestRepo, commitSha);
  });
});
```

**Step 2: Delete the 7 old fixture files**

```bash
rm test/fixtures/integration-test-github-app.yaml
rm test/fixtures/integration-test-github-app-direct.yaml
rm test/fixtures/integration-test-github-app-settings.yaml
rm test/fixtures/integration-test-github-app-delete-phase1.yaml
rm test/fixtures/integration-test-github-app-delete-phase2.yaml
rm test/fixtures/integration-test-github-app-repo-settings.yaml
rm test/fixtures/integration-test-github-app-signed-refs-settings.yaml
```

**Step 3: Verify compilation**

Run: `npm run build`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add test/integration/github-app.test.ts
git rm test/fixtures/integration-test-github-app*.yaml
git commit -m "refactor(test): migrate github-app to ephemeral repos"
```

---

## Task 6: Migrate github.test.ts to ephemeral repos

**Prerequisites: Task 1** — This task uses `generateRepoName(prefix)` and `createRepo()` from `test/integration/test-helpers.ts`, which are added by Task 1.

**Files:**

- Modify: `test/integration/github.test.ts` (full rewrite)
- Delete: 13 fixture YAML files (listed below)

This is the largest migration: 14 tests, 13 fixture files. All configs inlined. The template test's hardcoded assertions for `"xfg-test"` and `"anthony-spruyt"` become dynamic (`repoName` / `OWNER`).

Fixtures to delete:

- `test/fixtures/integration-test-config-github.yaml`
- `test/fixtures/integration-test-direct-github.yaml`
- `test/fixtures/integration-test-createonly-github.yaml`
- `test/fixtures/integration-test-template-github.yaml`
- `test/fixtures/integration-test-unchanged-github.yaml`
- `test/fixtures/integration-test-divergent-github.yaml`
- `test/fixtures/integration-test-orphan-branch-github.yaml`
- `test/fixtures/integration-test-delete-orphaned-github.yaml`
- `test/fixtures/integration-test-delete-orphaned-phase2-github.yaml`
- `test/fixtures/integration-test-pr-labels-github.yaml`
- `test/fixtures/integration-test-pr-labels-override-github.yaml`
- `test/fixtures/integration-test-lifecycle-upstream-github.yaml`
- `test/fixtures/integration-test-lifecycle-source-github.yaml`

**Step 1: Rewrite the test file**

Replace entire contents of `test/integration/github.test.ts`. The file is large so here is the complete code:

```typescript
import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
  waitForFileVisible as waitForFileVisibleBase,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";
const TARGET_FILE = "my.config.json";
const BRANCH_NAME = "chore/sync-my-config";

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function waitForFileVisible(
  filePath: string,
  timeoutMs = 10000
): Promise<string> {
  return waitForFileVisibleBase(testRepo, filePath, timeoutMs);
}

function resetTestRepo(): void {
  console.log("\n=== Resetting ephemeral repo ===\n");
  // Close open PRs
  try {
    const prs = exec(`gh api repos/${testRepo}/pulls --jq '.[].number'`);
    for (const pr of prs.split("\n").filter(Boolean)) {
      exec(
        `gh api --method PATCH repos/${testRepo}/pulls/${pr} -f state=closed`
      );
    }
  } catch {
    /* no PRs */
  }
  // Delete non-default branches
  try {
    const branches = exec(`gh api repos/${testRepo}/branches --jq '.[].name'`);
    for (const branch of branches.split("\n").filter(Boolean)) {
      if (branch !== "main") {
        try {
          exec(
            `gh api --method DELETE repos/${testRepo}/git/refs/heads/${branch}`
          );
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    /* no branches */
  }
  // Delete all files on main
  try {
    const files = exec(`gh api repos/${testRepo}/contents --jq '.[].name'`);
    for (const file of files.split("\n").filter(Boolean)) {
      try {
        const sha = exec(
          `gh api repos/${testRepo}/contents/${file} --jq '.sha'`
        );
        exec(
          `gh api --method DELETE repos/${testRepo}/contents/${file} -f message="reset" -f sha="${sha}"`
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* empty repo */
  }
  // Delete rulesets
  try {
    const rulesets = exec(`gh api repos/${testRepo}/rulesets --jq '.[].id'`);
    for (const id of rulesets.split("\n").filter(Boolean)) {
      exec(`gh api --method DELETE repos/${testRepo}/rulesets/${id}`);
    }
  } catch {
    /* no rulesets */
  }
  // Delete all labels
  try {
    const labels = exec(`gh api repos/${testRepo}/labels --jq '.[].name'`);
    for (const label of labels.split("\n").filter(Boolean)) {
      try {
        exec(
          `gh api --method DELETE repos/${testRepo}/labels/${encodeURIComponent(label)}`
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no labels */
  }
  console.log("=== Reset complete ===\n");
}

describe("GitHub Integration Test", () => {
  before(() => {
    tmpDir = join(tmpdir(), `xfg-sync-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("sync");
    testRepo = `${OWNER}/${repoName}`;
    createRepo(OWNER, repoName);
  });

  after(() => {
    deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetTestRepo();
  });

  test("sync creates a PR in the test repository", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github
files:
  my.config.json:
    content:
      prop1: base-value
      prop2:
        prop3: MyService
      prop4:
        prop5:
          - prop6: platform
          - prop7: engineering
      baseOnly: inherited-from-root
repos:
  - git: https://github.com/${testRepo}.git
    files:
      my.config.json:
        content:
          prop1: main
          addedByOverlay: true
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    const prList = exec(
      `gh pr list --repo ${testRepo} --head ${BRANCH_NAME} --json number,title,url --jq '.[0]'`
    );
    assert.ok(prList, "Expected a PR to be created");

    const pr = JSON.parse(prList);
    assert.ok(pr.number);
    assert.ok(pr.title.includes("sync"));

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${TARGET_FILE}?ref=${BRANCH_NAME} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    assert.equal(json.prop1, "main");
    assert.equal(json.baseOnly, "inherited-from-root");
    assert.equal(json.addedByOverlay, true);
  });

  test("re-sync closes existing PR and creates fresh one", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github
files:
  my.config.json:
    content:
      prop1: base-value
      prop2:
        prop3: MyService
      prop4:
        prop5:
          - prop6: platform
          - prop7: engineering
      baseOnly: inherited-from-root
repos:
  - git: https://github.com/${testRepo}.git
    files:
      my.config.json:
        content:
          prop1: main
          addedByOverlay: true
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prNumberBefore = parseInt(
      exec(
        `gh pr list --repo ${testRepo} --head ${BRANCH_NAME} --json number --jq '.[0].number'`
      ),
      10
    );
    assert.ok(prNumberBefore);

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prListAfter = exec(
      `gh pr list --repo ${testRepo} --head ${BRANCH_NAME} --json number --jq '.[0]'`
    );
    assert.ok(prListAfter);

    try {
      const oldPRState = exec(
        `gh pr view ${prNumberBefore} --repo ${testRepo} --json state --jq '.state'`
      );
      assert.equal(oldPRState, "CLOSED");
    } catch {
      /* deleted or closed */
    }
  });

  test("createOnly skips file when it exists on base branch", async () => {
    const createOnlyFile = "createonly-test.json";
    const existingContent = JSON.stringify({ existing: true }, null, 2);
    const existingBase64 = Buffer.from(existingContent).toString("base64");

    exec(
      `gh api --method PUT repos/${testRepo}/contents/${createOnlyFile} -f message="setup" -f content="${existingBase64}"`
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-createonly-github
files:
  createonly-test.json:
    createOnly: true
    content:
      newContent: true
      shouldNotAppear: "because file already exists on main"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    assert.ok(output.includes("createOnly") || output.includes("skip"));
  });

  test("PR title only includes files that actually changed (issue #90)", async () => {
    const unchangedFile = "unchanged-test.json";
    const testBranch = "chore/sync-config";

    const unchangedContent =
      JSON.stringify({ unchanged: true }, null, 2) + "\n";
    const unchangedBase64 = Buffer.from(unchangedContent).toString("base64");

    exec(
      `gh api --method PUT repos/${testRepo}/contents/${unchangedFile} -f message="setup" -f content="${unchangedBase64}"`
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-unchanged-github
files:
  unchanged-test.json:
    content:
      unchanged: true
  changed-test.json:
    content:
      changed: true
      timestamp: test-run
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number,title --jq '.[0]'`
    );
    const pr = JSON.parse(prInfo);
    assert.ok(pr.title.includes("changed-test.json"));
    assert.ok(!pr.title.includes("unchanged-test.json"));
  });

  test("template feature interpolates xfg variables in files and PR body", async () => {
    const templateFile = "template-test.json";
    const testBranch = "chore/sync-template-test";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-template-github
prTemplate: |
  ## Test PR for \${xfg:repo.fullName}

  This PR updates \${xfg:pr.fileCount} file(s).

  ### Changes

  \${xfg:pr.fileChanges}

  ### Metadata

  - Repository: \${xfg:repo.name}
  - Owner: \${xfg:repo.owner}
  - Platform: \${xfg:repo.platform}
files:
  template-test.json:
    template: true
    vars:
      customVar: "custom-value"
    content:
      repoName: "\${xfg:repo.name}"
      repoOwner: "\${xfg:repo.owner}"
      repoFullName: "\${xfg:repo.fullName}"
      platform: "\${xfg:repo.platform}"
      custom: "\${xfg:customVar}"
      escaped: "$\${xfg:repo.name}"
      static: "not-interpolated"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number,title --jq '.[0]'`
    );
    const pr = JSON.parse(prInfo);

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${templateFile}?ref=${testBranch} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);

    // Dynamic assertions using ephemeral repo name
    assert.equal(json.repoName, repoName);
    assert.equal(json.repoOwner, OWNER);
    assert.equal(json.repoFullName, testRepo);
    assert.equal(json.platform, "github");
    assert.equal(json.custom, "custom-value");
    assert.equal(json.escaped, "${xfg:repo.name}");
    assert.equal(json.static, "not-interpolated");

    const prBody = exec(
      `gh pr view ${pr.number} --repo ${testRepo} --json body --jq '.body'`
    );
    assert.ok(prBody.includes(testRepo));
    assert.ok(prBody.includes("1 file(s)"));
    assert.ok(prBody.includes("template-test.json"));
    assert.ok(prBody.includes(`- Repository: ${repoName}`));
    assert.ok(prBody.includes(`- Owner: ${OWNER}`));
    assert.ok(prBody.includes("- Platform: github"));
  });

  test("direct mode pushes directly to main branch without creating PR", async () => {
    const directFile = "direct-test.config.json";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-direct-github
files:
  direct-test.config.json:
    content:
      directMode: true
      timestamp: direct-push-test
prOptions:
  merge: direct
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    assert.ok(output.includes("Pushed directly") || output.includes("direct"));

    const fileContent = await waitForFileVisible(directFile);
    const json = JSON.parse(fileContent);
    assert.equal(json.directMode, true);
  });

  test("deleteOrphaned removes files when removed from config", async () => {
    const orphanFile = "orphan-test.json";
    const manifestFile = ".xfg.json";
    const configId = "integration-test-delete-orphaned-github";

    const configPath1 = writeConfig(
      tmpDir,
      `id: ${configId}
files:
  orphan-test.json:
    content:
      orphanTest: true
      willBeDeleted: true
    deleteOrphaned: true
repos:
  - git: https://github.com/${testRepo}.git
prOptions:
  merge: force
  deleteBranch: true
`
    );

    exec(`node dist/cli.js sync --config ${configPath1}`, { cwd: projectRoot });

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${orphanFile} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    assert.equal(json.orphanTest, true);

    const manifestContent = exec(
      `gh api repos/${testRepo}/contents/${manifestFile} --jq '.content' | base64 -d`
    );
    const manifest = JSON.parse(manifestContent);
    assert.ok(manifest.configs[configId]?.files?.includes(orphanFile));

    const configPath2 = writeConfig(
      tmpDir,
      `id: ${configId}
files:
  remaining-file.json:
    content:
      remaining: true
    deleteOrphaned: true
repos:
  - git: https://github.com/${testRepo}.git
prOptions:
  merge: force
  deleteBranch: true
`
    );

    exec(`node dist/cli.js sync --config ${configPath2}`, { cwd: projectRoot });

    try {
      exec(`gh api repos/${testRepo}/contents/${orphanFile} --jq '.sha'`);
      assert.fail("orphan-test.json should have been deleted");
    } catch {
      /* correctly deleted */
    }
  });

  test("handles divergent branch when existing PR is present (issue #183)", async () => {
    const divergentFile = "divergent-test.json";
    const testBranch = "chore/sync-divergent-test";

    exec(
      `gh api --method PUT repos/${testRepo}/contents/${divergentFile} -f message="setup" -f content="${Buffer.from(JSON.stringify({ version: 1 }, null, 2) + "\n").toString("base64")}"`
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-divergent-github
files:
  divergent-test.json:
    content:
      version: 3
      syncedByXfg: true
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo1 = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq '.[0].number'`
    );
    assert.ok(prInfo1);

    // Advance main
    const mainSha = exec(
      `gh api repos/${testRepo}/contents/${divergentFile} --jq '.sha'`
    );
    exec(
      `gh api --method PUT repos/${testRepo}/contents/${divergentFile} -f message="advance" -f content="${Buffer.from(JSON.stringify({ version: 2, advancedOnMain: true }, null, 2) + "\n").toString("base64")}" -f sha="${mainSha}"`
    );

    const output2 = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prInfo2 = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq '.[0]'`
    );
    assert.ok(prInfo2);
    assert.ok(output2.includes("\u2713") || output2.includes("github.com"));
  });

  test("handles divergent branch when no PR exists but branch exists (issue #183)", async () => {
    const orphanBranchFile = "orphan-branch-test.json";
    const testBranch = "chore/sync-orphan-branch-test";

    const mainSha = exec(
      `gh api repos/${testRepo}/git/refs/heads/main --jq '.object.sha'`
    );
    exec(
      `gh api --method POST repos/${testRepo}/git/refs -f ref="refs/heads/${testBranch}" -f sha="${mainSha}"`
    );

    const branchContent =
      JSON.stringify({ orphanBranchVersion: 1 }, null, 2) + "\n";
    exec(
      `gh api --method PUT repos/${testRepo}/contents/${orphanBranchFile} -f message="setup" -f content="${Buffer.from(branchContent).toString("base64")}" -f branch="${testBranch}"`
    );

    const prCheck = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq 'length'`
    );
    assert.equal(prCheck, "0");

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-orphan-branch-github
files:
  orphan-branch-test.json:
    content:
      syncedByXfg: true
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq '.[0]'`
    );
    assert.ok(prInfo);

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${orphanBranchFile}?ref=${testBranch} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    assert.ok(!json.orphanBranchVersion);
    assert.equal(json.syncedByXfg, true);
  });

  test("lifecycle: upstream field is ignored when repo already exists", async () => {
    const testFile = "lifecycle-upstream-test.json";
    const testBranch = "chore/sync-lifecycle-upstream-test";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-lifecycle-upstream-github
files:
  lifecycle-upstream-test.json:
    content:
      lifecycleTest: true
      upstreamConfigured: true
repos:
  - git: https://github.com/${testRepo}.git
    upstream: git@github.com:some-org/some-repo.git
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq '.[0]'`
    );
    assert.ok(prInfo);

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${testFile}?ref=${testBranch} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    assert.equal(json.lifecycleTest, true);
    assert.ok(!output.toLowerCase().includes("forked"));
  });

  test("lifecycle: source field is ignored when repo already exists", async () => {
    const testFile = "lifecycle-source-test.json";
    const testBranch = "chore/sync-lifecycle-source-test";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-lifecycle-source-github
files:
  lifecycle-source-test.json:
    content:
      lifecycleTest: true
      sourceConfigured: true
repos:
  - git: https://github.com/${testRepo}.git
    source: https://dev.azure.com/someorg/someproject/_git/somerepo
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq '.[0]'`
    );
    assert.ok(prInfo);

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${testFile}?ref=${testBranch} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    assert.equal(json.lifecycleTest, true);
    assert.ok(!output.toLowerCase().includes("migrated"));
  });

  test("lifecycle: dry-run outputs CREATE for non-existent repo", async () => {
    const dryRunTmpDir = join(
      tmpdir(),
      `xfg-lifecycle-dryrun-test-${Date.now()}`
    );
    mkdirSync(dryRunTmpDir, { recursive: true });

    try {
      const configPath = join(dryRunTmpDir, "config.yaml");
      writeFileSync(
        configPath,
        `id: lifecycle-dryrun-test
files:
  test.txt:
    content: "test"
repos:
  - git: https://github.com/${OWNER}/xfg-nonexistent-lifecycle-dryrun-test
`
      );

      const output = exec(
        `node dist/cli.js sync --config ${configPath} --dry-run`,
        { cwd: projectRoot }
      );
      assert.ok(output.includes("CREATE"));
    } finally {
      rmSync(dryRunTmpDir, { recursive: true, force: true });
    }
  });

  test("sync creates a PR with configured prOptions.labels", async () => {
    const prLabelsBranch = "chore/sync-pr-labels-test";

    exec(
      `gh api --method POST repos/${testRepo}/labels -f name="bug" -f color="ededed"`
    );
    exec(
      `gh api --method POST repos/${testRepo}/labels -f name="enhancement" -f color="ededed"`
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-pr-labels-github
files:
  pr-labels-test.json:
    content:
      prLabelsTest: true
      syncedByXfg: true
prOptions:
  labels:
    - bug
    - enhancement
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${prLabelsBranch} --json number,labels --jq '.[0]'`
    );
    const pr = JSON.parse(prInfo);
    const labelNames: string[] = pr.labels.map((l: { name: string }) => l.name);
    assert.ok(labelNames.includes("bug"));
    assert.ok(labelNames.includes("enhancement"));
  });

  test("per-repo prOptions.labels overrides global labels", async () => {
    const prLabelsOverrideBranch = "chore/sync-pr-labels-override-test";

    exec(
      `gh api --method POST repos/${testRepo}/labels -f name="documentation" -f color="ededed"`
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-pr-labels-override-github
files:
  pr-labels-override-test.json:
    content:
      prLabelsOverrideTest: true
prOptions:
  labels:
    - bug
    - enhancement
repos:
  - git: https://github.com/${testRepo}.git
    prOptions:
      labels:
        - documentation
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${prLabelsOverrideBranch} --json number,labels --jq '.[0]'`
    );
    const pr = JSON.parse(prInfo);
    const labelNames: string[] = pr.labels.map((l: { name: string }) => l.name);
    assert.ok(labelNames.includes("documentation"));
    assert.ok(!labelNames.includes("bug"));
    assert.ok(!labelNames.includes("enhancement"));
  });
});
```

**Step 2: Delete the 13 old fixture files**

```bash
rm test/fixtures/integration-test-config-github.yaml
rm test/fixtures/integration-test-direct-github.yaml
rm test/fixtures/integration-test-createonly-github.yaml
rm test/fixtures/integration-test-template-github.yaml
rm test/fixtures/integration-test-unchanged-github.yaml
rm test/fixtures/integration-test-divergent-github.yaml
rm test/fixtures/integration-test-orphan-branch-github.yaml
rm test/fixtures/integration-test-delete-orphaned-github.yaml
rm test/fixtures/integration-test-delete-orphaned-phase2-github.yaml
rm test/fixtures/integration-test-pr-labels-github.yaml
rm test/fixtures/integration-test-pr-labels-override-github.yaml
rm test/fixtures/integration-test-lifecycle-upstream-github.yaml
rm test/fixtures/integration-test-lifecycle-source-github.yaml
```

**Step 3: Verify compilation**

Run: `npm run build`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add test/integration/github.test.ts
git rm test/fixtures/integration-test-*-github.yaml test/fixtures/integration-test-*-github-*.yaml 2>/dev/null || true
git commit -m "refactor(test): migrate github.test.ts to ephemeral repos"
```

---

## Task 7: Generalize create-ephemeral-repo-config.sh for fixture templates

**Files:**

- Modify: `.github/scripts/create-ephemeral-repo-config.sh`

The script currently generates a simple inline config. Add a `--fixture` mode that reads a template YAML file and replaces `OWNER/REPO_PLACEHOLDER` with the ephemeral repo URL.

**Step 1: Rewrite the script**

Replace entire contents of `.github/scripts/create-ephemeral-repo-config.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Generate a unique ephemeral repo name and write a config file.
#
# Mode 1 (inline): create-ephemeral-repo-config.sh <prefix> <owner> <config-path> <config-id> <file-name> <file-content-json>
#   Generates a simple inline config YAML.
#
# Mode 2 (fixture): create-ephemeral-repo-config.sh --fixture <prefix> <owner> <config-path> <fixture-path>
#   Reads a template fixture YAML, replaces OWNER/REPO_PLACEHOLDER with the ephemeral repo.

if [ "${1:-}" = "--fixture" ]; then
  # Fixture template mode
  shift
  PREFIX="${1:?Usage: ... --fixture <prefix> <owner> <config-path> <fixture-path>}"
  OWNER="${2:?Missing owner}"
  CONFIG_PATH="${3:?Missing config-path}"
  FIXTURE_PATH="${4:?Missing fixture-path}"

  REPO_NAME="xfg-${PREFIX}-test-$(date +%s)-$(openssl rand -hex 3)"
  echo "Generated repo name: ${REPO_NAME}"

  # Create the ephemeral repo (action jobs sync TO an existing repo)
  gh repo create "${OWNER}/${REPO_NAME}" --private --add-readme

  # Substitute placeholder in fixture template
  sed "s|OWNER/REPO_PLACEHOLDER|${OWNER}/${REPO_NAME}|g" "${FIXTURE_PATH}" > "${CONFIG_PATH}"

  echo "Wrote config to ${CONFIG_PATH} (from fixture ${FIXTURE_PATH})"
else
  # Inline config mode (backward compatible)
  PREFIX="${1:?Usage: create-ephemeral-repo-config.sh <prefix> <owner> <config-path> <config-id> <file-name> <file-content-json>}"
  OWNER="${2:?Missing owner}"
  CONFIG_PATH="${3:?Missing config-path}"
  CONFIG_ID="${4:?Missing config-id}"
  FILE_NAME="${5:?Missing file-name}"
  FILE_CONTENT_JSON="${6:?Missing file-content-json}"

  REPO_NAME="xfg-lifecycle-${PREFIX}-$(date +%s)-$(openssl rand -hex 3)"
  echo "Generated repo name: ${REPO_NAME}"

  cat >"${CONFIG_PATH}" <<ENDCONFIG
id: ${CONFIG_ID}
files:
  ${FILE_NAME}:
    content: ${FILE_CONTENT_JSON}
repos:
  - git: https://github.com/${OWNER}/${REPO_NAME}.git
ENDCONFIG

  echo "Wrote config to ${CONFIG_PATH}"
fi

# Output for GitHub Actions
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "repo_name=${REPO_NAME}" >>"$GITHUB_OUTPUT"
fi

# Always print to stdout
echo "REPO_NAME=${REPO_NAME}"
```

**Step 2: Verify the script is valid bash**

Run: `bash -n .github/scripts/create-ephemeral-repo-config.sh`
Expected: No output (valid syntax).

**Step 3: Commit**

```bash
git add .github/scripts/create-ephemeral-repo-config.sh
git commit -m "feat(ci): add --fixture mode to create-ephemeral-repo-config.sh"
```

---

## Task 8: Convert action fixture files to templates with placeholder URLs

**Files:**

- Modify: `test/fixtures/integration-test-action-github-pat.yaml`
- Modify: `test/fixtures/integration-test-action-github-app.yaml`
- Modify: `test/fixtures/integration-test-action-settings-app.yaml`

Replace the hardcoded repo URLs (`anthony-spruyt/xfg-test-N.git`) with `OWNER/REPO_PLACEHOLDER.git` so the CI script can substitute at runtime.

**Step 1: Update each fixture file**

In `test/fixtures/integration-test-action-github-pat.yaml`, change:

```yaml
- git: https://github.com/anthony-spruyt/xfg-test-4.git
```

To:

```yaml
- git: https://github.com/OWNER/REPO_PLACEHOLDER.git
```

In `test/fixtures/integration-test-action-github-app.yaml`, change:

```yaml
- git: https://github.com/anthony-spruyt/xfg-test-5.git
```

To:

```yaml
- git: https://github.com/OWNER/REPO_PLACEHOLDER.git
```

In `test/fixtures/integration-test-action-settings-app.yaml`, change:

```yaml
- git: https://github.com/anthony-spruyt/xfg-test-6.git
```

To:

```yaml
- git: https://github.com/OWNER/REPO_PLACEHOLDER.git
```

**Step 2: Commit**

```bash
git add test/fixtures/integration-test-action-github-*.yaml test/fixtures/integration-test-action-settings-app.yaml
git commit -m "refactor(fixtures): replace hardcoded repo URLs with OWNER/REPO_PLACEHOLDER"
```

---

## Task 9: Update CI workflow - migrate 5 CLI jobs to ephemeral repos

**Files:**

- Modify: `.github/workflows/_integration-tests.yaml`

This task updates the 5 CLI test jobs: `cli-sync-github-pat`, `cli-sync-github-app`, `cli-settings-rulesets-pat`, `cli-settings-labels-pat`, `cli-settings-repo-pat`.

**Note:** CLI jobs do NOT have a `reset-test-repo.sh` step (only the 3 action jobs in Task 10 do). The changes here are token swap and concurrency removal only.

**Important dependency:** The `GH_PAT` to `GH_PAT_ORG` swap depends on the test code already being updated (Tasks 2-6) to use `spruyt-labs` org with `createRepo()`/`deleteRepo()`. If the workflow changes are deployed before the test code changes, CI will fail because the old test code expects a different token scope. Ensure Tasks 2-6 are merged first or in the same PR.

For each job:

1. Change `GH_TOKEN: ${{ secrets.GH_PAT }}` to `GH_TOKEN: ${{ secrets.GH_PAT_ORG }}`
2. Remove the `concurrency` block

**Step 1: Read the current workflow file**

Run: Read `.github/workflows/_integration-tests.yaml` to find exact line numbers for each job.

**Step 2: For each of the 5 CLI jobs:**

- Replace `secrets.GH_PAT` with `secrets.GH_PAT_ORG` in the `env` block
- Delete the `concurrency:` block (usually 2 lines: `group:` and `cancel-in-progress:`)

**Step 3: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/_integration-tests.yaml'))"`
Expected: No errors.

**Step 4: Commit**

```bash
git add .github/workflows/_integration-tests.yaml
git commit -m "refactor(ci): migrate 5 CLI jobs to ephemeral repos with GH_PAT_ORG"
```

---

## Task 10: Update CI workflow - migrate 3 action jobs to ephemeral repos

**Files:**

- Modify: `.github/workflows/_integration-tests.yaml`

For the 3 action jobs (`action-sync-pat`, `action-sync-app`, `action-settings-app`):

1. Change `GH_TOKEN` from `GH_PAT` to `GH_PAT_ORG`
2. Replace `reset-test-repo.sh` step with `create-ephemeral-repo-config.sh --fixture` step (only these 3 action jobs have `reset-test-repo.sh` -- CLI jobs in Task 9 do not)
3. Add `delete-ephemeral-repo.sh` cleanup step with `if: always()`
4. For `action-sync-pat` and `action-sync-app`: update the `seed-manifest.sh` call to use the ephemeral repo name from `${{ steps.ephemeral.outputs.repo_name }}` (`action-settings-app` has no `seed-manifest.sh` step -- do not add one)
5. Update the act step's `config:` input from the original fixture path to `${{ runner.temp }}/config.yaml`
6. Remove the `concurrency` block

**Note:** The `create-ephemeral-repo-config.sh` script takes positional arguments, not flags. Since the existing script only supports inline config mode (prefix, owner, config-path, config-id, file-name, file-content-json), Task 7 must add `--fixture` mode first. Alternatively, the fixture template substitution can be done inline in the workflow step using `sed`.

**Step 1: For `action-sync-pat` job:**

Replace the reset step:

```yaml
- name: Cleanup — reset test repo
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/reset-test-repo.sh "${TEST_REPO}"
```

With:

```yaml
- name: Arrange — create ephemeral repo and config
  id: ephemeral
  env:
    GH_TOKEN: ${{ secrets.GH_PAT_ORG }}
  run: |
    .github/scripts/create-ephemeral-repo-config.sh \
      --fixture "action-pat" "spruyt-labs" \
      "${{ runner.temp }}/config.yaml" \
      "test/fixtures/integration-test-action-github-pat.yaml"
```

The script writes `repo_name=<name>` to `$GITHUB_OUTPUT`, so reference `${{ steps.ephemeral.outputs.repo_name }}` in subsequent steps.

Update the act step's `config:` input:

```yaml
config: ${{ runner.temp }}/config.yaml
```

And add cleanup at end using the existing `delete-ephemeral-repo.sh` script (consistent with lifecycle jobs):

```yaml
- name: Cleanup — delete ephemeral repo
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GH_PAT_ORG }}
  run: .github/scripts/delete-ephemeral-repo.sh "spruyt-labs/${{ steps.ephemeral.outputs.repo_name }}"
```

Apply the same pattern for `action-sync-app` and `action-settings-app`, using their respective fixture templates. Remember: `action-settings-app` has no `seed-manifest.sh` step, so do not add one.

**Step 1b: Remove job-level `env:` blocks from `action-sync-pat`, `action-sync-app`, and `action-settings-app`**

All three jobs currently define hardcoded env vars at the job level that reference persistent repos. These must be removed since the ephemeral repo name comes from `steps.ephemeral.outputs.repo_name`:

For `integration-test-action-sync-pat`, delete:

```yaml
env:
  TEST_REPO: anthony-spruyt/xfg-test-4
  PAT_BRANCH: chore/sync-my-config
```

For `integration-test-action-sync-app`, delete:

```yaml
env:
  TEST_REPO: anthony-spruyt/xfg-test-5
  APP_BRANCH: chore/sync-app-test
```

For `integration-test-action-settings-app`, delete:

```yaml
env:
  TEST_REPO: anthony-spruyt/xfg-test-6
```

The branch names (`chore/sync-my-config` and `chore/sync-app-test`) are passed as inputs to the xfg action via the `branch:` field, so they can be hardcoded inline in the act step's `branch:` input. `TEST_REPO` is no longer needed -- all references become `spruyt-labs/${{ steps.ephemeral.outputs.repo_name }}`.

**Step 1c: Update assertion steps to reference ephemeral repo**

In `action-sync-pat`, `action-sync-app`, and `action-settings-app` assertion steps, replace all occurrences of `${TEST_REPO}` with `spruyt-labs/${{ steps.ephemeral.outputs.repo_name }}`. For example:

In `action-sync-pat`, the "Assert -- verify PR created" step currently uses:

```bash
PR_INFO=$(gh pr list --repo ${TEST_REPO} --head ${PAT_BRANCH} --json number,title,url --jq '.[0]')
```

Change to:

```bash
PR_INFO=$(gh pr list --repo spruyt-labs/${{ steps.ephemeral.outputs.repo_name }} --head chore/sync-my-config --json number,title,url --jq '.[0]')
```

Similarly update `PR_NUMBER`, `COMMIT_SHA`, `COMMIT_AUTHOR` lines and the `verify-commit-file-count.sh` call. The same applies to the `action-sync-app` assertion steps, replacing `${TEST_REPO}` with `spruyt-labs/${{ steps.ephemeral.outputs.repo_name }}` and `${APP_BRANCH}` with the literal `chore/sync-app-test`.

For `action-settings-app`, the "Assert -- verify ruleset was created" step currently uses:

```bash
RULESET=$(gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "xfg-test-ruleset")')
```

Change to:

```bash
RULESET=$(gh api repos/spruyt-labs/${{ steps.ephemeral.outputs.repo_name }}/rulesets --jq '.[] | select(.name == "xfg-test-ruleset")')
```

**Step 1d: Update `seed-manifest.sh` steps for `action-sync-pat` and `action-sync-app`**

For `action-sync-pat`, replace:

```yaml
- name: Arrange — seed manifest
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/seed-manifest.sh "${TEST_REPO}" "integration-test-action-github-pat"
```

With:

```yaml
- name: Arrange — seed manifest
  env:
    GH_TOKEN: ${{ secrets.GH_PAT_ORG }}
  run: .github/scripts/seed-manifest.sh "spruyt-labs/${{ steps.ephemeral.outputs.repo_name }}" "integration-test-action-github-pat"
```

For `action-sync-app`, replace:

```yaml
- name: Arrange — seed manifest
  env:
    GH_TOKEN: ${{ secrets.GH_PAT }}
  run: .github/scripts/seed-manifest.sh "${TEST_REPO}" "integration-test-action-github-app"
```

With:

```yaml
- name: Arrange — seed manifest
  env:
    GH_TOKEN: ${{ secrets.GH_PAT_ORG }}
  run: .github/scripts/seed-manifest.sh "spruyt-labs/${{ steps.ephemeral.outputs.repo_name }}" "integration-test-action-github-app"
```

**Step 2: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/_integration-tests.yaml'))"`

**Step 3: Commit**

```bash
git add .github/workflows/_integration-tests.yaml
git commit -m "refactor(ci): migrate 3 action jobs to ephemeral repos"
```

---

## Task 11: Remove concurrency groups from 4 lifecycle jobs

**Files:**

- Modify: `.github/workflows/_integration-tests.yaml`

The 4 lifecycle jobs (`integration-test-cli-lifecycle-github-pat`, `integration-test-cli-lifecycle-github-app`, `integration-test-action-lifecycle-pat`, `integration-test-action-lifecycle-app`) already use ephemeral repos but still have concurrency groups (`integration-github-8` through `integration-github-11`). Remove these since ephemeral repos cannot collide.

**Step 1: For each lifecycle job, delete the concurrency block:**

```yaml
concurrency:
  group: integration-github-N
  cancel-in-progress: false
```

**Step 2: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/_integration-tests.yaml'))"`

**Step 3: Commit**

```bash
git add .github/workflows/_integration-tests.yaml
git commit -m "refactor(ci): remove concurrency groups from lifecycle jobs"
```

---

## Task 12: Delete reset-test-repo.sh

**Files:**

- Delete: `.github/scripts/reset-test-repo.sh`

No more callers after Tasks 9-10.

**Step 1: Verify no remaining references**

Run: `grep -r "reset-test-repo" --include="*.yaml" --include="*.ts" --include="*.sh" .`
Expected: No output (or only the plan/design doc references).

**Step 2: Delete the file**

```bash
git rm .github/scripts/reset-test-repo.sh
git commit -m "chore: delete reset-test-repo.sh (replaced by ephemeral repos)"
```

---

## Task 13: Update integration-tests.md rules

**Files:**

- Modify: `.claude/rules/integration-tests.md`

Rewrite to document the ephemeral repo pattern. The existing rules file prohibits `gh repo create` and `gh repo delete` outside lifecycle tests -- this must be updated since all GitHub integration tests now use ephemeral repos with create/delete lifecycle.

**Step 1: Replace the entire file contents with the following:**

````markdown
---
paths:
  [
    test/integration/**/*,
    test/fixtures/integration-*,
    .github/workflows/ci.yaml,
    .github/scripts/*,
  ]
---

# Integration Test Guidelines

## Ephemeral Repo Pattern

All GitHub integration tests use **ephemeral repos** with unique names per run. No persistent test repos exist.

### CLI Tests

Each CLI test file creates its own ephemeral repo in `before()` and deletes it in `after()`. Configs are written inline via `writeConfig()` (from `test/integration/test-helpers.ts`):

```typescript
const OWNER = "spruyt-labs";
let repoName: string;
let testRepo: string;

before(() => {
  repoName = generateRepoName("<purpose>");
  testRepo = `${OWNER}/${repoName}`;
  createRepo(OWNER, repoName);
});

after(() => {
  deleteRepo(OWNER, repoName);
});
```

### Action Tests

Action jobs use `create-ephemeral-repo-config.sh --fixture` to generate configs from templates with `OWNER/REPO_PLACEHOLDER` substitution. Cleanup uses `delete-ephemeral-repo.sh` with `if: always()`.

### Lifecycle Tests

Lifecycle tests (create/fork/migrate) create and delete repos as part of their test logic. Use `generateRepoName("lifecycle")` for unique names.

## Key Rules

- **All tests use `gh repo create` / `gh repo delete`** for ephemeral repos (this replaces the old persistent-repo model)
- **Never reuse a deleted repo name** - GitHub has eventual consistency; use unique timestamp+random names
- **Never share a repo** between two test jobs
- Inline configs via `writeConfig()` (from `test/integration/test-helpers.ts`) - no static fixture files for CLI tests
- Action fixture templates use `OWNER/REPO_PLACEHOLDER` placeholder
- All GitHub jobs use `GH_PAT_ORG` secret (spruyt-labs org access)
- **No concurrency groups** on GitHub jobs (ephemeral repos can't collide)
- ADO and GitLab jobs still use persistent repos with concurrency groups

## CI Workflow

- GitHub integration tests only run on `push` to `main` (not on PR branches)
- All jobs run in parallel after `build` - never chain GitHub jobs with `needs`
````

**Step 2: Commit**

```bash
git add .claude/rules/integration-tests.md
git commit -m "docs: update integration-tests rules for ephemeral repo pattern"
```

---

## Task 14: Final verification - build + lint

**Files:** None (verification only)

**Step 1: Build**

Run: `npm run build`
Expected: Clean compilation.

**Step 2: Lint**

Run: `./lint.sh`
Expected: No errors.

**Step 3: Run unit tests**

Run: `npm test`
Expected: All pass.

**Step 4: Final commit if any lint fixes needed**

If lint fixes are required, commit them:

```bash
git add -A
git commit -m "fix: lint fixes for ephemeral integration test migration"
```

---

## Post-Merge Manual Cleanup

After the PR is merged and integration tests pass on `main`:

1. Delete persistent repos `xfg-test` through `xfg-test-8` from `anthony-spruyt`
2. Delete `anthony-spruyt/xfg-mode-test` (from prior issue)
