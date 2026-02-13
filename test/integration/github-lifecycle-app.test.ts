import { test, describe, before, afterEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  exec,
  projectRoot,
  generateRepoName,
  deleteRepo,
  repoExists,
  isForkedFrom,
  writeConfig,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";
const FORK_SOURCE = "octocat/Spoon-Knife";
const ADO_MIGRATE_SOURCE = "https://dev.azure.com/aspruyt/fxg/_git/fxg-test";
const HAS_ADO_CREDS = !!process.env.AZURE_DEVOPS_EXT_PAT;

// Skip all tests if GitHub App credentials are not set
const SKIP_TESTS =
  !process.env.XFG_GITHUB_APP_ID || !process.env.XFG_GITHUB_APP_PRIVATE_KEY;

if (SKIP_TESTS) {
  console.log(
    "\n  Skipping GitHub App lifecycle tests: XFG_GITHUB_APP_ID and XFG_GITHUB_APP_PRIVATE_KEY not set\n"
  );
}

// xfg commands must NOT see GH_TOKEN — only App credentials
const xfgEnv = { cwd: projectRoot, env: { GH_TOKEN: undefined } };

// Note: This file uses shared helpers from test-helpers.ts.
// All inputs are controlled test constants (repo names generated
// from randomBytes, not user input). This is the same pattern used by all
// existing integration tests in this codebase.

describe(
  "Lifecycle Integration Test (GitHub App)",
  { skip: SKIP_TESTS },
  () => {
    const reposToDelete: string[] = [];
    const tmpDir = join(tmpdir(), `xfg-lifecycle-app-${Date.now()}`);

    before(() => {
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      for (const repoName of reposToDelete) {
        deleteRepo(OWNER, repoName);
      }
      reposToDelete.length = 0;
    });

    after(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("create: sync creates repo when it doesn't exist (App auth)", async () => {
      const repoName = generateRepoName();
      reposToDelete.push(repoName);

      const configPath = writeConfig(
        tmpDir,
        `id: lifecycle-create-app-test
files:
  lifecycle-test.json:
    content:
      created: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
      );

      console.log(`\nCreating repo ${OWNER}/${repoName} via xfg sync (App)...`);
      const output = exec(
        `node dist/cli.js sync --config ${configPath} --merge direct`,
        xfgEnv
      );
      console.log(output);

      // Verify repo was created (using GH_TOKEN for verification)
      assert.ok(
        repoExists(OWNER, repoName),
        `Repo ${repoName} should exist after sync`
      );

      // Verify file was pushed
      const fileContent = exec(
        `gh api repos/${OWNER}/${repoName}/contents/lifecycle-test.json --jq '.content' | base64 -d`
      );
      assert.ok(
        fileContent,
        "lifecycle-test.json should exist on default branch"
      );
      const json = JSON.parse(fileContent);
      assert.equal(json.created, true, "File should contain created: true");

      console.log("  Create lifecycle test (App) passed");
    });

    test("fork: sync forks upstream when repo doesn't exist (App auth)", async () => {
      const repoName = generateRepoName();
      reposToDelete.push(repoName);

      const configPath = writeConfig(
        tmpDir,
        `id: lifecycle-fork-app-test
files:
  lifecycle-fork-test.json:
    content:
      forked: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    upstream: https://github.com/${FORK_SOURCE}.git
`
      );

      console.log(
        `\nForking ${FORK_SOURCE} as ${OWNER}/${repoName} via xfg sync (App)...`
      );
      const output = exec(
        `node dist/cli.js sync --config ${configPath} --merge direct`,
        xfgEnv
      );
      console.log(output);

      // Verify repo was created
      assert.ok(
        repoExists(OWNER, repoName),
        `Repo ${repoName} should exist after sync`
      );

      // Verify it's a fork of the source
      assert.ok(
        isForkedFrom(OWNER, repoName, FORK_SOURCE),
        `Repo ${repoName} should be a fork of ${FORK_SOURCE}`
      );

      console.log("  Fork lifecycle test (App) passed");
    });

    test("create dry-run: shows CREATE but doesn't actually create repo (App auth)", async () => {
      const repoName = generateRepoName();
      // Do NOT add to reposToDelete — repo should not exist

      const configPath = writeConfig(
        tmpDir,
        `id: lifecycle-dryrun-app-test
files:
  lifecycle-dryrun-test.json:
    content:
      dryRun: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
      );

      console.log(
        `\nDry-run create for ${OWNER}/${repoName} via xfg sync (App)...`
      );
      const output = exec(
        `node dist/cli.js sync --config ${configPath} --dry-run`,
        xfgEnv
      );
      console.log(output);

      // Verify output shows CREATE
      assert.ok(
        output.includes("CREATE"),
        "Dry-run output should include CREATE"
      );

      // Verify repo was NOT actually created
      assert.ok(
        !repoExists(OWNER, repoName),
        `Repo ${repoName} should NOT exist after dry-run`
      );

      console.log("  Dry-run lifecycle test (App) passed");
    });

    test(
      "migrate: sync migrates from ADO source when repo doesn't exist (App auth)",
      { skip: !HAS_ADO_CREDS },
      async () => {
        const repoName = generateRepoName();
        reposToDelete.push(repoName);

        const configPath = writeConfig(
          tmpDir,
          `id: lifecycle-migrate-app-test
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
          `\nMigrating from ADO to ${OWNER}/${repoName} via xfg sync (App)...`
        );
        // Note: exec() here uses controlled test constants (repoName from randomBytes,
        // configPath from tmpDir), not user input. This is the standard integration test pattern.
        const output = exec(
          `node dist/cli.js sync --config ${configPath} --merge direct`,
          xfgEnv
        );
        console.log(output);

        // Verify repo was created (using GH_TOKEN for verification)
        assert.ok(
          repoExists(OWNER, repoName),
          `Repo ${repoName} should exist after migrate`
        );

        // Verify it's NOT a fork (migrated repos are standalone)
        assert.ok(
          !isForkedFrom(OWNER, repoName, "aspruyt/fxg-test"),
          `Repo ${repoName} should not be a fork`
        );

        console.log("  Migrate lifecycle test (App) passed");
      }
    );

    test("create with settings: description is applied (App auth)", async () => {
      const repoName = generateRepoName();
      reposToDelete.push(repoName);

      const configPath = writeConfig(
        tmpDir,
        `id: lifecycle-create-settings-app-test
settings:
  repo:
    description: "Created by xfg lifecycle test"
files:
  lifecycle-test.json:
    content:
      created: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
      );

      console.log(
        `\nCreating repo ${OWNER}/${repoName} with settings via xfg sync (App)...`
      );
      const output = exec(
        `node dist/cli.js sync --config ${configPath} --merge direct`,
        xfgEnv
      );
      console.log(output);

      // Verify repo was created (using GH_TOKEN for verification)
      assert.ok(
        repoExists(OWNER, repoName),
        `Repo ${repoName} should exist after sync`
      );

      // Verify description was applied (using GH_TOKEN for verification)
      const description = exec(
        `gh api repos/${OWNER}/${repoName} --jq '.description'`
      );
      assert.equal(
        description,
        "Created by xfg lifecycle test",
        "Repo description should match config"
      );

      console.log("  Create with settings test (App) passed");
    });

    test("already-existing repo: second sync shows existed (App auth)", async () => {
      const repoName = generateRepoName();
      reposToDelete.push(repoName);

      const configPath = writeConfig(
        tmpDir,
        `id: lifecycle-existed-app-test
files:
  lifecycle-test.json:
    content:
      round: 1
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
      );

      console.log(`\nFirst sync: creating ${OWNER}/${repoName} (App)...`);
      const firstOutput = exec(
        `node dist/cli.js sync --config ${configPath} --merge direct`,
        xfgEnv
      );
      console.log(firstOutput);

      // First run should show CREATE
      assert.ok(
        firstOutput.includes("CREATE"),
        "First sync should include CREATE"
      );

      // Second run - update file content to trigger a change
      const configPath2 = writeConfig(
        tmpDir,
        `id: lifecycle-existed-app-test
files:
  lifecycle-test.json:
    content:
      round: 2
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
      );

      console.log(
        `\nSecond sync: ${OWNER}/${repoName} should already exist (App)...`
      );
      const secondOutput = exec(
        `node dist/cli.js sync --config ${configPath2} --merge direct`,
        xfgEnv
      );
      console.log(secondOutput);

      // Second run should NOT show CREATE (repo already exists)
      assert.ok(
        !secondOutput.includes("CREATE"),
        "Second sync should NOT include CREATE (repo already existed)"
      );

      console.log("  Already-existing repo test (App) passed");
    });

    test("fork dry-run: shows FORK but doesn't create repo (App auth)", async () => {
      const repoName = generateRepoName();
      // Do NOT add to reposToDelete — repo should not exist

      const configPath = writeConfig(
        tmpDir,
        `id: lifecycle-fork-dryrun-app-test
files:
  lifecycle-fork-test.json:
    content:
      forked: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    upstream: https://github.com/${FORK_SOURCE}.git
`
      );

      console.log(
        `\nDry-run fork for ${OWNER}/${repoName} via xfg sync (App)...`
      );
      const output = exec(
        `node dist/cli.js sync --config ${configPath} --dry-run`,
        xfgEnv
      );
      console.log(output);

      // Verify output shows FORK
      assert.ok(output.includes("FORK"), "Dry-run output should include FORK");

      // Verify repo was NOT actually created
      assert.ok(
        !repoExists(OWNER, repoName),
        `Repo ${repoName} should NOT exist after dry-run`
      );

      console.log("  Fork dry-run test (App) passed");
    });

    test(
      "migrate dry-run: shows MIGRATE but doesn't create repo (App auth)",
      { skip: !HAS_ADO_CREDS },
      async () => {
        const repoName = generateRepoName();
        // Do NOT add to reposToDelete — repo should not exist

        const configPath = writeConfig(
          tmpDir,
          `id: lifecycle-migrate-dryrun-app-test
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
          `\nDry-run migrate for ${OWNER}/${repoName} via xfg sync (App)...`
        );
        const output = exec(
          `node dist/cli.js sync --config ${configPath} --dry-run`,
          xfgEnv
        );
        console.log(output);

        // Verify output shows MIGRATE
        assert.ok(
          output.includes("MIGRATE"),
          "Dry-run output should include MIGRATE"
        );

        // Verify repo was NOT actually created
        assert.ok(
          !repoExists(OWNER, repoName),
          `Repo ${repoName} should NOT exist after dry-run`
        );

        console.log("  Migrate dry-run test (App) passed");
      }
    );
  }
);
