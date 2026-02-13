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

const OWNER = "anthony-spruyt";
const FORK_SOURCE = "anthony-spruyt/xfg-fork-source";
const FORK_SOURCE_OWNER = FORK_SOURCE.split("/")[0];
const ADO_MIGRATE_SOURCE = "https://dev.azure.com/aspruyt/fxg/_git/fxg-test";
const HAS_ADO_CREDS = !!process.env.AZURE_DEVOPS_EXT_PAT;
// Fork requires different owner — skip if upstream and target share the same owner
const CAN_FORK = FORK_SOURCE_OWNER !== OWNER;

describe("Lifecycle Integration Test (PAT)", () => {
  const reposToDelete: string[] = [];
  const tmpDir = join(tmpdir(), `xfg-lifecycle-pat-${Date.now()}`);

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
    const output = exec(
      `node dist/cli.js sync --config ${configPath} --merge direct`,
      { cwd: projectRoot }
    );
    console.log(output);

    // Verify repo was created
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

    console.log("  Create lifecycle test passed");
  });

  test(
    "fork: sync forks upstream when repo doesn't exist",
    { skip: !CAN_FORK },
    async () => {
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
      const output = exec(
        `node dist/cli.js sync --config ${configPath} --merge direct`,
        { cwd: projectRoot }
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

      console.log("  Fork lifecycle test passed");
    }
  );

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
    const output = exec(
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
      !repoExists(OWNER, repoName),
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
      const output = exec(
        `node dist/cli.js sync --config ${configPath} --merge direct`,
        { cwd: projectRoot }
      );
      console.log(output);

      // Verify repo was created
      assert.ok(
        repoExists(OWNER, repoName),
        `Repo ${repoName} should exist after migrate`
      );

      // Verify it's NOT a fork (migrated repos are standalone)
      assert.ok(
        !isForkedFrom(OWNER, repoName, "aspruyt/fxg-test"),
        `Repo ${repoName} should not be a fork`
      );

      console.log("  Migrate lifecycle test passed");
    }
  );
});
