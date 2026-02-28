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
