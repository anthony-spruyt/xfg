import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { exec, projectRoot } from "./test-helpers.js";

// Test constants - these are hardcoded and not derived from user input
const TEST_REPO_NAME = "xfg-test-repo-settings";
const TEST_OWNER = "anthony-spruyt";
const TEST_REPO = `${TEST_OWNER}/${TEST_REPO_NAME}`;

// Dynamic config file path (created during test)
const configPath = join(
  projectRoot,
  "test",
  "fixtures",
  "integration-test-config-repo-settings.yaml"
);

/**
 * Delete the test repository if it exists.
 * Note: Uses hardcoded TEST_REPO constant, not user input.
 */
function deleteRepoIfExists(): void {
  try {
    console.log(`  Checking if ${TEST_REPO} exists...`);
    exec(`gh repo view ${TEST_REPO} --json name`);
    console.log(`  Deleting ${TEST_REPO}...`);
    exec(`gh repo delete ${TEST_REPO} --yes`);
    console.log(`  Deleted ${TEST_REPO}`);
  } catch {
    console.log(`  Repository ${TEST_REPO} does not exist`);
  }
}

/**
 * Create a new test repository.
 * Note: Uses hardcoded TEST_REPO constant, not user input.
 */
function createTestRepo(): void {
  console.log(`  Creating ${TEST_REPO}...`);
  exec(`gh repo create ${TEST_REPO} --private --add-readme`);
  console.log(`  Created ${TEST_REPO}`);
}

/**
 * Wait for the repository to be fully available.
 * Note: Uses hardcoded TEST_REPO constant, not user input.
 */
async function waitForRepoReady(timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Try to fetch repo settings - this confirms API is ready
      exec(`gh api repos/${TEST_REPO} --jq '.id'`);
      console.log(`  Repository ready after ${Date.now() - startTime}ms`);
      return;
    } catch {
      // API not ready yet, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Repository ${TEST_REPO} not ready after ${timeoutMs}ms`);
}

/**
 * Get current repo settings from GitHub API.
 * Note: Uses hardcoded TEST_REPO constant, not user input.
 */
function getRepoSettings(): Record<string, unknown> {
  const result = exec(`gh api repos/${TEST_REPO}`);
  return JSON.parse(result);
}

/**
 * Create the test config file.
 */
function createConfigFile(): void {
  const config = `# yaml-language-server: $schema=https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json
# Integration test config for xfg repo settings
id: integration-test-repo-settings

settings:
  repo:
    hasWiki: false
    hasProjects: false
    allowSquashMerge: true
    allowMergeCommit: false
    allowRebaseMerge: false
    deleteBranchOnMerge: true
    allowAutoMerge: true

repos:
  - git: https://github.com/${TEST_REPO}.git
`;
  writeFileSync(configPath, config);
  console.log(`  Created config file: ${configPath}`);
}

/**
 * Clean up the config file.
 */
function deleteConfigFile(): void {
  try {
    unlinkSync(configPath);
    console.log(`  Deleted config file: ${configPath}`);
  } catch {
    // File doesn't exist, that's fine
  }
}

describe("GitHub Repo Settings Integration Test", () => {
  before(async () => {
    console.log("\n=== Setting up repo settings integration test ===\n");

    // Delete test repo if it exists from previous runs
    console.log("Cleaning up any existing test repository...");
    deleteRepoIfExists();

    // Create fresh test repo
    console.log("\nCreating test repository...");
    createTestRepo();

    // Wait for repo to be ready
    console.log("\nWaiting for repository to be ready...");
    await waitForRepoReady();

    // Create config file
    console.log("\nCreating config file...");
    createConfigFile();

    console.log("\n=== Setup complete ===\n");
  });

  after(() => {
    console.log("\n=== Cleaning up ===\n");

    // Delete config file
    console.log("Deleting config file...");
    deleteConfigFile();

    // Delete test repo
    console.log("Deleting test repository...");
    deleteRepoIfExists();

    console.log("\n=== Cleanup complete ===\n");
  });

  test("settings dry-run shows planned repo settings changes", async () => {
    // Get current settings before
    console.log("Getting current repo settings...");
    const settingsBefore = getRepoSettings();
    console.log(`  has_wiki: ${settingsBefore.has_wiki}`);
    console.log(`  has_projects: ${settingsBefore.has_projects}`);
    console.log(`  allow_squash_merge: ${settingsBefore.allow_squash_merge}`);

    // Run settings with dry-run
    console.log("\nRunning xfg settings --dry-run...");
    const output = exec(
      `node dist/cli.js settings --config ${configPath} --dry-run`,
      { cwd: projectRoot }
    );
    console.log(output);

    // Verify output indicates dry-run
    assert.ok(
      output.includes("DRY RUN") || output.includes("dry-run"),
      "Output should indicate dry-run mode"
    );

    // Verify settings were NOT changed
    console.log("\nVerifying settings were not changed...");
    const settingsAfter = getRepoSettings();
    assert.equal(
      settingsAfter.has_wiki,
      settingsBefore.has_wiki,
      "has_wiki should not change in dry-run"
    );

    console.log("\n=== Dry-run test passed ===\n");
  });

  test("settings applies repo settings changes", async () => {
    // Get current settings before
    console.log("Getting current repo settings before apply...");
    const settingsBefore = getRepoSettings();
    console.log(`  has_wiki: ${settingsBefore.has_wiki}`);
    console.log(`  allow_merge_commit: ${settingsBefore.allow_merge_commit}`);
    console.log(
      `  delete_branch_on_merge: ${settingsBefore.delete_branch_on_merge}`
    );

    // Run settings (apply)
    console.log("\nRunning xfg settings (apply)...");
    const output = exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify settings were applied
    console.log("\nVerifying settings were applied...");
    const settingsAfter = getRepoSettings();

    assert.equal(settingsAfter.has_wiki, false, "has_wiki should be false");
    assert.equal(
      settingsAfter.has_projects,
      false,
      "has_projects should be false"
    );
    assert.equal(
      settingsAfter.allow_squash_merge,
      true,
      "allow_squash_merge should be true"
    );
    assert.equal(
      settingsAfter.allow_merge_commit,
      false,
      "allow_merge_commit should be false"
    );
    assert.equal(
      settingsAfter.allow_rebase_merge,
      false,
      "allow_rebase_merge should be false"
    );
    assert.equal(
      settingsAfter.delete_branch_on_merge,
      true,
      "delete_branch_on_merge should be true"
    );
    assert.equal(
      settingsAfter.allow_auto_merge,
      true,
      "allow_auto_merge should be true"
    );

    console.log("  All settings verified!");
    console.log("\n=== Apply test passed ===\n");
  });

  test("settings reports no changes when already in desired state", async () => {
    // Run settings again - should report no changes
    console.log("Running xfg settings again (should report no changes)...");
    const output = exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify output indicates no changes needed
    assert.ok(
      output.includes("No changes needed") ||
        output.includes("0 to add, 0 to change"),
      "Output should indicate no changes needed"
    );

    console.log("\n=== No-changes test passed ===\n");
  });
});
