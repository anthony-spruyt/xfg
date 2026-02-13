import { test, describe, afterEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exec, projectRoot } from "./test-helpers.js";

const OWNER = "anthony-spruyt";
const FORK_SOURCE = "anthony-spruyt/xfg-fork-source";

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

// Note: This file uses the exec() helper from test-helpers.ts which wraps
// execSync. All inputs are controlled test constants (repo names generated
// from randomBytes, not user input). This is the same pattern used by all
// existing integration tests in this codebase.

function generateRepoName(): string {
  return `xfg-lifecycle-test-${Date.now()}-${randomBytes(3).toString("hex")}`;
}

function deleteRepo(repoName: string): void {
  try {
    // Use GH_TOKEN (from process.env) for cleanup, not App credentials
    exec(`gh repo delete --yes ${OWNER}/${repoName}`);
    console.log(`  Cleaned up ${OWNER}/${repoName}`);
  } catch {
    console.log(
      `  Cleanup: ${OWNER}/${repoName} (already deleted or not found)`
    );
  }
}

function repoExists(repoName: string): boolean {
  try {
    // Use GH_TOKEN for verification
    exec(`gh api repos/${OWNER}/${repoName} --jq '.full_name'`);
    return true;
  } catch {
    return false;
  }
}

function isForkedFrom(repoName: string, upstreamFullName: string): boolean {
  try {
    const parentName = exec(
      `gh api repos/${OWNER}/${repoName} --jq '.parent.full_name'`
    );
    return parentName === upstreamFullName;
  } catch {
    return false;
  }
}

function writeConfig(tmpDir: string, configYaml: string): string {
  const configPath = join(tmpDir, "lifecycle-test-config.yaml");
  writeFileSync(configPath, configYaml);
  return configPath;
}

describe(
  "Lifecycle Integration Test (GitHub App)",
  { skip: SKIP_TESTS },
  () => {
    const reposToDelete: string[] = [];
    const tmpDir = join(tmpdir(), `xfg-lifecycle-app-${Date.now()}`);

    mkdirSync(tmpDir, { recursive: true });

    afterEach(() => {
      for (const repoName of reposToDelete) {
        deleteRepo(repoName);
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
        repoExists(repoName),
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
        repoExists(repoName),
        `Repo ${repoName} should exist after sync`
      );

      // Verify it's a fork of the source
      assert.ok(
        isForkedFrom(repoName, FORK_SOURCE),
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
        !repoExists(repoName),
        `Repo ${repoName} should NOT exist after dry-run`
      );

      console.log("  Dry-run lifecycle test (App) passed");
    });
  }
);
