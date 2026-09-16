import { test, describe, before, after, beforeEach } from "node:test";
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
  resetTestRepo,
  waitForCommitVerified,
  waitForPrVisible,
  withTestRetry,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";
const SKIP_TESTS =
  !process.env.XFG_GITHUB_CLIENT_ID || !process.env.XFG_GITHUB_APP_PRIVATE_KEY;

if (SKIP_TESTS) {
  console.log(
    "\n  Skipping GitHub App integration tests: XFG_GITHUB_CLIENT_ID and XFG_GITHUB_APP_PRIVATE_KEY not set\n"
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

const SYNC_BRANCH = "chore/sync-my-config";
const DIRECT_FILE = "github-app-direct-test.json";

let repoName: string;
let testRepo: string;
let tmpDir: string;

describe("GitHub App Integration Test", { skip: SKIP_TESTS }, () => {
  before(async () => {
    tmpDir = join(tmpdir(), `xfg-app-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("app");
    testRepo = `${OWNER}/${repoName}`;
    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTestRepo(testRepo);
  });

  test("sync creates PR via GraphQL API with GitHub App credentials", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-app
files:
  my.config.json:
    content:
      prop1: main
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const output = await exec(
      `node dist/cli.js sync --config ${configPath}`,
      xfgEnv
    );
    console.log(output);

    const pr = await waitForPrVisible(testRepo, SYNC_BRANCH, "number");
    const prNumber = String(pr.number);
    assert.ok(prNumber, `Expected PR on ${SYNC_BRANCH}`);

    await withTestRetry(
      async () => {
        const commitSha = await execWithRetry(
          `gh api repos/${testRepo}/commits/${SYNC_BRANCH} --jq '.sha'`
        );
        const author = await execWithRetry(
          `gh api repos/${testRepo}/commits/${commitSha} --jq '.commit.author.name'`
        );
        assert.notStrictEqual(author, "github-actions[bot]");

        await waitForCommitVerified(testRepo, commitSha);
      },
      {
        description: "verify PR commit author and signature",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
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

    const output = await exec(
      `node dist/cli.js sync --config ${configPath}`,
      xfgEnv
    );
    console.log(output);

    await withTestRetry(
      async () => {
        const fileSha = await execWithRetry(
          `gh api repos/${testRepo}/contents/${DIRECT_FILE} --jq '.sha'`
        );
        assert.ok(fileSha, `Expected ${DIRECT_FILE} on main`);

        const mainSha = await execWithRetry(
          `gh api repos/${testRepo}/commits/main --jq '.sha'`
        );
        const author = await execWithRetry(
          `gh api repos/${testRepo}/commits/${mainSha} --jq '.commit.author.name'`
        );
        assert.notStrictEqual(author, "github-actions[bot]");

        await waitForCommitVerified(testRepo, mainSha);
      },
      {
        description: "verify direct push file, author, and signature",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });

  test("settings command with bypass_actors is idempotent", async () => {
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

    await exec(`node dist/cli.js sync --config ${configPath}`, xfgEnv);

    const dryRunOutput = await exec(
      `node dist/cli.js sync --config ${configPath} --dry-run`,
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

    await exec(`node dist/cli.js sync --config ${config1}`, xfgEnv);
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

    await exec(`node dist/cli.js sync --config ${config2}`, xfgEnv);
  });
});

describe("GitHub App Repo Settings Test", { skip: SKIP_TESTS }, () => {
  let settingsRepoName: string;
  let settingsTestRepo: string;
  let settingsTmpDir: string;

  before(async () => {
    settingsTmpDir = join(tmpdir(), `xfg-app-settings-test-${Date.now()}`);
    mkdirSync(settingsTmpDir, { recursive: true });
    settingsRepoName = generateRepoName("app-settings");
    settingsTestRepo = `${OWNER}/${settingsRepoName}`;
    await createRepo(OWNER, settingsRepoName);
  });

  after(async () => {
    await deleteRepo(OWNER, settingsRepoName);
    rmSync(settingsTmpDir, { recursive: true, force: true });
  });

  test("repo settings with GitHub App token is idempotent", async () => {
    // Reset repo settings to defaults
    const fields = Object.entries(GITHUB_DEFAULTS)
      .map(([k, v]) => `-F ${k}=${v}`)
      .join(" ");
    await execWithRetry(
      `gh api --method PATCH repos/${settingsTestRepo} ${fields}`
    );

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

    await exec(`node dist/cli.js sync --config ${configPath}`, xfgEnv);

    const secondOutput = await exec(
      `node dist/cli.js sync --config ${configPath}`,
      xfgEnv
    );
    assert.ok(
      secondOutput.includes("No changes needed") ||
        secondOutput.includes("0 to add, 0 to change")
    );
  });
});

describe("GitHub App Mode Drift Test", { skip: SKIP_TESTS }, () => {
  let modeRepoName: string;
  let modeTestRepo: string;
  let modeTmpDir: string;

  before(async () => {
    modeTmpDir = join(tmpdir(), `xfg-app-mode-drift-${Date.now()}`);
    mkdirSync(modeTmpDir, { recursive: true });
    modeRepoName = generateRepoName("app-mode");
    modeTestRepo = `${OWNER}/${modeRepoName}`;
    await createRepo(OWNER, modeRepoName);
  });

  after(async () => {
    await deleteRepo(OWNER, modeRepoName);
    rmSync(modeTmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTestRepo(modeTestRepo);
  });

  async function getTreeMode(
    repo: string,
    filePath: string
  ): Promise<string | undefined> {
    const treeJson = await execWithRetry(
      `gh api repos/${repo}/git/trees/HEAD?recursive=1`
    );
    const tree = JSON.parse(treeJson).tree as Array<{
      path: string;
      mode: string;
      type: string;
    }>;
    return tree.find((e) => e.path === filePath && e.type === "blob")?.mode;
  }

  test("mode-only upgrade: 100644 -> 100755 when content unchanged (App path)", async () => {
    const fileContent = "#!/bin/bash\necho hello\n";
    const seedConfig = writeConfig(
      modeTmpDir,
      `id: mode-drift-upgrade-seed
files:
  mode-test.sh:
    content: |
      ${fileContent.replace(/\n/g, "\n      ").trimEnd()}
    executable: false
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${modeTestRepo}.git
`
    );
    await exec(`node dist/cli.js sync --config ${seedConfig}`, xfgEnv);
    await withTestRetry(
      async () => {
        assert.equal(
          await getTreeMode(modeTestRepo, "mode-test.sh"),
          "100644",
          "seed: mode-test.sh should be 100644"
        );
      },
      {
        description: "verify seed mode 100644 for upgrade test",
        retries: 5,
        baseDelayMs: 3000,
      }
    );

    const upgradeConfig = writeConfig(
      modeTmpDir,
      `id: mode-drift-upgrade
files:
  mode-test.sh:
    content: |
      ${fileContent.replace(/\n/g, "\n      ").trimEnd()}
    executable: true
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${modeTestRepo}.git
`
    );
    const output = await exec(
      `node dist/cli.js sync --config ${upgradeConfig}`,
      xfgEnv
    );
    console.log(output);

    await withTestRetry(
      async () => {
        assert.equal(
          await getTreeMode(modeTestRepo, "mode-test.sh"),
          "100755",
          "after upgrade: mode-test.sh should be 100755"
        );
      },
      {
        description: "verify mode upgraded to 100755",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });

  test("mode-only downgrade: 100755 -> 100644 when content unchanged (App path)", async () => {
    const fileContent = "#!/bin/bash\necho downgrade\n";
    const seedConfig = writeConfig(
      modeTmpDir,
      `id: mode-drift-downgrade-seed
files:
  mode-test.sh:
    content: |
      ${fileContent.replace(/\n/g, "\n      ").trimEnd()}
    executable: true
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${modeTestRepo}.git
`
    );
    await exec(`node dist/cli.js sync --config ${seedConfig}`, xfgEnv);
    await withTestRetry(
      async () => {
        assert.equal(
          await getTreeMode(modeTestRepo, "mode-test.sh"),
          "100755",
          "seed: mode-test.sh should be 100755"
        );
      },
      {
        description: "verify seed mode 100755 for downgrade test",
        retries: 5,
        baseDelayMs: 3000,
      }
    );

    const downgradeConfig = writeConfig(
      modeTmpDir,
      `id: mode-drift-downgrade
files:
  mode-test.sh:
    content: |
      ${fileContent.replace(/\n/g, "\n      ").trimEnd()}
    executable: false
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${modeTestRepo}.git
`
    );
    const output = await exec(
      `node dist/cli.js sync --config ${downgradeConfig}`,
      xfgEnv
    );
    console.log(output);

    await withTestRetry(
      async () => {
        assert.equal(
          await getTreeMode(modeTestRepo, "mode-test.sh"),
          "100644",
          "after downgrade: mode-test.sh should be 100644"
        );
      },
      {
        description: "verify mode downgraded to 100644",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });

  test("mixed: content change + mode-only upgrade in same sync (App path)", async () => {
    const seedConfig = writeConfig(
      modeTmpDir,
      `id: mode-drift-mixed-seed
files:
  content-change-script:
    content: "old content"
    executable: false
  mode-only-script:
    content: "keep same"
    executable: false
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${modeTestRepo}.git
`
    );
    await exec(`node dist/cli.js sync --config ${seedConfig}`, xfgEnv);
    await withTestRetry(
      async () => {
        assert.equal(
          await getTreeMode(modeTestRepo, "content-change-script"),
          "100644"
        );
        assert.equal(
          await getTreeMode(modeTestRepo, "mode-only-script"),
          "100644"
        );
      },
      {
        description: "verify seed modes 100644 for mixed test",
        retries: 5,
        baseDelayMs: 3000,
      }
    );

    const mixedConfig = writeConfig(
      modeTmpDir,
      `id: mode-drift-mixed
files:
  content-change-script:
    content: "new content"
    executable: true
  mode-only-script:
    content: "keep same"
    executable: true
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${modeTestRepo}.git
`
    );
    const output = await exec(
      `node dist/cli.js sync --config ${mixedConfig}`,
      xfgEnv
    );
    console.log(output);

    await withTestRetry(
      async () => {
        assert.equal(
          await getTreeMode(modeTestRepo, "content-change-script"),
          "100755",
          "content-change-script should be 100755"
        );
        assert.equal(
          await getTreeMode(modeTestRepo, "mode-only-script"),
          "100755",
          "mode-only-script should be 100755"
        );
      },
      {
        description: "verify mixed modes upgraded to 100755",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });

  test("mode-only downgrade via PAT path: 100755 -> 100644 without App creds", async () => {
    const patOnlyEnv = {
      cwd: projectRoot,
      env: {
        XFG_GITHUB_CLIENT_ID: undefined,
        XFG_GITHUB_APP_PRIVATE_KEY: undefined,
      },
    };
    const fileContent = "#!/bin/bash\necho pat-downgrade\n";

    const seedConfig = writeConfig(
      modeTmpDir,
      `id: pat-mode-drift-seed
files:
  pat-mode-test.sh:
    content: |
      ${fileContent.replace(/\n/g, "\n      ").trimEnd()}
    executable: true
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${modeTestRepo}.git
`
    );
    await exec(`node dist/cli.js sync --config ${seedConfig}`, xfgEnv);
    await withTestRetry(
      async () => {
        assert.equal(
          await getTreeMode(modeTestRepo, "pat-mode-test.sh"),
          "100755",
          "seed: pat-mode-test.sh should be 100755"
        );
      },
      {
        description: "verify seed mode 100755 for PAT downgrade test",
        retries: 5,
        baseDelayMs: 3000,
      }
    );

    const downgradeConfig = writeConfig(
      modeTmpDir,
      `id: pat-mode-drift-downgrade
files:
  pat-mode-test.sh:
    content: |
      ${fileContent.replace(/\n/g, "\n      ").trimEnd()}
    executable: false
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${modeTestRepo}.git
`
    );
    const output = await exec(
      `node dist/cli.js sync --config ${downgradeConfig}`,
      patOnlyEnv
    );
    console.log(output);

    await withTestRetry(
      async () => {
        assert.equal(
          await getTreeMode(modeTestRepo, "pat-mode-test.sh"),
          "100644",
          "after PAT downgrade: pat-mode-test.sh should be 100644"
        );
      },
      {
        description: "verify PAT mode downgraded to 100644",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });
});

// Force PAT-only auth
const patOnlyEnv = {
  env: {
    XFG_GITHUB_CLIENT_ID: undefined,
    XFG_GITHUB_APP_PRIVATE_KEY: undefined,
  },
};

describe("GitHub App Signed Refs Test", { skip: SKIP_TESTS }, () => {
  let signedRepoName: string;
  let signedTestRepo: string;
  let signedTmpDir: string;

  before(async () => {
    signedTmpDir = join(tmpdir(), `xfg-app-signed-test-${Date.now()}`);
    mkdirSync(signedTmpDir, { recursive: true });
    signedRepoName = generateRepoName("app-signed");
    signedTestRepo = `${OWNER}/${signedRepoName}`;
    await createRepo(OWNER, signedRepoName);
  });

  after(async () => {
    await deleteRepo(OWNER, signedRepoName);
    rmSync(signedTmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTestRepo(signedTestRepo);

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
    await exec(`node dist/cli.js sync --config ${rulesetConfig}`, patOnlyEnv);
  });

  test("sync creates PR on repo with required_signatures on all branches", async () => {
    const configPath = writeConfig(
      signedTmpDir,
      `id: integration-test-github-app
files:
  my.config.json:
    content:
      prop1: main
repos:
  - git: https://github.com/${signedTestRepo}.git
`
    );

    const output = await exec(
      `node dist/cli.js sync --config ${configPath}`,
      xfgEnv
    );
    console.log(output);

    const pr = await waitForPrVisible(signedTestRepo, SYNC_BRANCH, "number");
    assert.ok(pr.number);

    await withTestRetry(
      async () => {
        const commitSha = await execWithRetry(
          `gh api repos/${signedTestRepo}/commits/${SYNC_BRANCH} --jq '.sha'`
        );
        await waitForCommitVerified(signedTestRepo, commitSha);
      },
      {
        description: "verify signed commit on PR branch",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });
});
