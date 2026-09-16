import { test, describe, before, afterEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  exec,
  execWithRetry,
  projectRoot,
  generateRepoName,
  deleteRepo,
  repoExists,
  repoExistsNoRetry,
  isForkedFrom,
  writeConfig,
  withTestRetry,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";
const FORK_SOURCE = "octocat/Spoon-Knife";
const ADO_MIGRATE_SOURCE = "https://dev.azure.com/aspruyt/fxg/_git/fxg-test";
const HAS_ADO_CREDS = !!process.env.AZURE_DEVOPS_EXT_PAT;

describe("Lifecycle Integration Test (PAT)", () => {
  const reposToDelete: string[] = [];
  const tmpDir = join(tmpdir(), `xfg-lifecycle-pat-${Date.now()}`);

  before(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    for (const repoName of reposToDelete) {
      await deleteRepo(OWNER, repoName);
    }
    reposToDelete.length = 0;
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("create: sync creates repo when it doesn't exist", async () => {
    const repoName = generateRepoName();
    reposToDelete.push(repoName);

    const configPath = writeConfig(
      tmpDir,
      `id: lifecycle-create-test
files:
  lifecycle-test.json:
    content:
      created: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
    );

    console.log(`\nCreating repo ${OWNER}/${repoName} via xfg sync...`);
    const output = await exec(
      `node dist/cli.js sync --config ${configPath} --merge direct`,
      { cwd: projectRoot }
    );
    console.log(output);

    // Verify repo was created
    assert.ok(
      await repoExists(OWNER, repoName),
      `Repo ${repoName} should exist after sync`
    );

    await withTestRetry(
      async () => {
        const fileContent = await execWithRetry(
          `gh api repos/${OWNER}/${repoName}/contents/lifecycle-test.json --jq '.content' | base64 -d`
        );
        assert.ok(fileContent, "lifecycle-test.json should exist");
        const json = JSON.parse(fileContent);
        assert.equal(json.created, true, "File should contain created: true");
      },
      {
        description: "file visible on default branch",
        retries: 5,
        baseDelayMs: 3000,
      }
    );

    console.log("  Create lifecycle test passed");
  });

  test("fork: sync forks upstream when repo doesn't exist", async () => {
    const repoName = generateRepoName();
    reposToDelete.push(repoName);

    const configPath = writeConfig(
      tmpDir,
      `id: lifecycle-fork-test
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
      `\nForking ${FORK_SOURCE} as ${OWNER}/${repoName} via xfg sync...`
    );
    const output = await exec(
      `node dist/cli.js sync --config ${configPath} --merge direct`,
      { cwd: projectRoot }
    );
    console.log(output);

    // Verify repo was created
    assert.ok(
      await repoExists(OWNER, repoName),
      `Repo ${repoName} should exist after sync`
    );

    // Verify it's a fork of the source
    assert.ok(
      await isForkedFrom(OWNER, repoName, FORK_SOURCE),
      `Repo ${repoName} should be a fork of ${FORK_SOURCE}`
    );

    console.log("  Fork lifecycle test passed");
  });

  test("create dry-run: shows CREATE but doesn't actually create repo", async () => {
    const repoName = generateRepoName();
    // Do NOT add to reposToDelete — repo should not exist

    const configPath = writeConfig(
      tmpDir,
      `id: lifecycle-dryrun-test
files:
  lifecycle-dryrun-test.json:
    content:
      dryRun: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
    );

    console.log(`\nDry-run create for ${OWNER}/${repoName} via xfg sync...`);
    const output = await exec(
      `node dist/cli.js sync --config ${configPath} --dry-run`,
      { cwd: projectRoot }
    );
    console.log(output);

    // Verify output shows CREATE
    assert.ok(
      output.includes("CREATE"),
      "Dry-run output should include CREATE"
    );

    // Verify repo was NOT actually created
    assert.ok(
      !(await repoExistsNoRetry(OWNER, repoName)),
      `Repo ${repoName} should NOT exist after dry-run`
    );

    console.log("  Dry-run lifecycle test passed");
  });

  test(
    "migrate: sync migrates from ADO source when repo doesn't exist",
    { skip: !HAS_ADO_CREDS },
    async () => {
      const repoName = generateRepoName();
      reposToDelete.push(repoName);

      const configPath = writeConfig(
        tmpDir,
        `id: lifecycle-migrate-test
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
        `\nMigrating from ADO to ${OWNER}/${repoName} via xfg sync...`
      );
      // Note: exec() here uses controlled test constants (repoName from randomBytes,
      // configPath from tmpDir), not user input. This is the standard integration test pattern.
      const output = await exec(
        `node dist/cli.js sync --config ${configPath} --merge direct`,
        { cwd: projectRoot }
      );
      console.log(output);

      // Verify repo was created
      assert.ok(
        await repoExists(OWNER, repoName),
        `Repo ${repoName} should exist after migrate`
      );

      // Verify it's NOT a fork (migrated repos are standalone)
      assert.ok(
        !(await isForkedFrom(OWNER, repoName, "aspruyt/fxg-test")),
        `Repo ${repoName} should not be a fork`
      );

      console.log("  Migrate lifecycle test passed");
    }
  );

  test("create with settings: description is applied", async () => {
    const repoName = generateRepoName();
    reposToDelete.push(repoName);

    const configPath = writeConfig(
      tmpDir,
      `id: lifecycle-create-settings-test
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
      `\nCreating repo ${OWNER}/${repoName} with settings via xfg sync...`
    );
    const output = await exec(
      `node dist/cli.js sync --config ${configPath} --merge direct`,
      { cwd: projectRoot }
    );
    console.log(output);

    // Verify repo was created
    assert.ok(
      await repoExists(OWNER, repoName),
      `Repo ${repoName} should exist after sync`
    );

    await withTestRetry(
      async () => {
        const description = await execWithRetry(
          `gh api repos/${OWNER}/${repoName} --jq '.description'`
        );
        assert.equal(
          description,
          "Created by xfg lifecycle test",
          "Repo description should match config"
        );
      },
      { description: "description applied", retries: 5, baseDelayMs: 3000 }
    );

    console.log("  Create with settings test passed");
  });

  test("create with defaultBranch: renames default branch to desired name", async () => {
    const repoName = generateRepoName();
    reposToDelete.push(repoName);

    const configPath = writeConfig(
      tmpDir,
      `id: lifecycle-create-defaultbranch-test
settings:
  repo:
    defaultBranch: develop
files:
  lifecycle-test.json:
    content:
      created: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
    );

    console.log(
      `\nCreating repo ${OWNER}/${repoName} with defaultBranch: develop via xfg sync...`
    );
    // Note: uses controlled test constants (repoName from randomBytes,
    // configPath from tmpDir), not user input. Standard integration test pattern.
    const output = await exec(
      `node dist/cli.js sync --config ${configPath} --merge direct`,
      { cwd: projectRoot }
    );
    console.log(output);

    assert.ok(
      await repoExists(OWNER, repoName),
      `Repo ${repoName} should exist after sync`
    );

    await withTestRetry(
      async () => {
        const defaultBranch = await execWithRetry(
          `gh api repos/${OWNER}/${repoName} --jq '.default_branch'`
        );
        assert.equal(
          defaultBranch,
          "develop",
          "Default branch should be 'develop'"
        );
      },
      { description: "default branch renamed", retries: 5, baseDelayMs: 3000 }
    );

    console.log("  Create with defaultBranch test passed");
  });

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
      // Note: uses controlled test constants (repoName from randomBytes,
      // configPath from tmpDir), not user input. Standard integration test pattern.
      const output = await exec(
        `node dist/cli.js sync --config ${configPath} --merge direct`,
        { cwd: projectRoot }
      );
      console.log(output);

      assert.ok(
        await repoExists(OWNER, repoName),
        `Repo ${repoName} should exist after migrate`
      );

      await withTestRetry(
        async () => {
          const defaultBranch = await execWithRetry(
            `gh api repos/${OWNER}/${repoName} --jq '.default_branch'`
          );
          assert.equal(
            defaultBranch,
            "main",
            "Default branch should be 'main' after rename"
          );
        },
        { description: "default branch renamed", retries: 5, baseDelayMs: 3000 }
      );

      console.log("  Migrate with defaultBranch test passed");
    }
  );

  test("already-existing repo: second sync shows existed", async () => {
    const repoName = generateRepoName();
    reposToDelete.push(repoName);

    const configPath = writeConfig(
      tmpDir,
      `id: lifecycle-existed-test
files:
  lifecycle-test.json:
    content:
      round: 1
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
    );

    console.log(`\nFirst sync: creating ${OWNER}/${repoName}...`);
    const firstOutput = await exec(
      `node dist/cli.js sync --config ${configPath} --merge direct`,
      { cwd: projectRoot }
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
      `id: lifecycle-existed-test
files:
  lifecycle-test.json:
    content:
      round: 2
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
`
    );

    console.log(`\nSecond sync: ${OWNER}/${repoName} should already exist...`);
    const secondOutput = await exec(
      `node dist/cli.js sync --config ${configPath2} --merge direct`,
      { cwd: projectRoot }
    );
    console.log(secondOutput);

    // Second run should NOT show CREATE (repo already exists)
    assert.ok(
      !secondOutput.includes("CREATE"),
      "Second sync should NOT include CREATE (repo already existed)"
    );

    console.log("  Already-existing repo test passed");
  });

  test("fork dry-run: shows FORK but doesn't create repo", async () => {
    const repoName = generateRepoName();
    // Do NOT add to reposToDelete — repo should not exist

    const configPath = writeConfig(
      tmpDir,
      `id: lifecycle-fork-dryrun-test
files:
  lifecycle-fork-test.json:
    content:
      forked: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    upstream: https://github.com/${FORK_SOURCE}.git
`
    );

    console.log(`\nDry-run fork for ${OWNER}/${repoName} via xfg sync...`);
    const output = await exec(
      `node dist/cli.js sync --config ${configPath} --dry-run`,
      { cwd: projectRoot }
    );
    console.log(output);

    // Verify output shows FORK
    assert.ok(output.includes("FORK"), "Dry-run output should include FORK");

    // Verify repo was NOT actually created
    assert.ok(
      !(await repoExistsNoRetry(OWNER, repoName)),
      `Repo ${repoName} should NOT exist after dry-run`
    );

    console.log("  Fork dry-run test passed");
  });

  test(
    "migrate dry-run: shows MIGRATE but doesn't create repo",
    { skip: !HAS_ADO_CREDS },
    async () => {
      const repoName = generateRepoName();
      // Do NOT add to reposToDelete — repo should not exist

      const configPath = writeConfig(
        tmpDir,
        `id: lifecycle-migrate-dryrun-test
files:
  lifecycle-migrate-test.json:
    content:
      migrated: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    source: ${ADO_MIGRATE_SOURCE}
`
      );

      console.log(`\nDry-run migrate for ${OWNER}/${repoName} via xfg sync...`);
      const output = await exec(
        `node dist/cli.js sync --config ${configPath} --dry-run`,
        { cwd: projectRoot }
      );
      console.log(output);

      // Verify output shows MIGRATE
      assert.ok(
        output.includes("MIGRATE"),
        "Dry-run output should include MIGRATE"
      );

      // Verify repo was NOT actually created
      assert.ok(
        !(await repoExistsNoRetry(OWNER, repoName)),
        `Repo ${repoName} should NOT exist after dry-run`
      );

      console.log("  Migrate dry-run test passed");
    }
  );
});
