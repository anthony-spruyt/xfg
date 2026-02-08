import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { exec, projectRoot } from "./test-helpers.js";

const fixturesDir = join(projectRoot, "test", "fixtures");

// Skip all tests if GitHub App credentials are not set
const SKIP_TESTS =
  !process.env.XFG_GITHUB_APP_ID || !process.env.XFG_GITHUB_APP_PRIVATE_KEY;

if (SKIP_TESTS) {
  console.log(
    "\n⚠️  Skipping GitHub App integration tests: XFG_GITHUB_APP_ID and XFG_GITHUB_APP_PRIVATE_KEY not set\n"
  );
}

// xfg commands must NOT see GH_TOKEN — only App credentials
const xfgEnv = { cwd: projectRoot, env: { GH_TOKEN: undefined } };

const RESET_SCRIPT = join(projectRoot, ".github/scripts/reset-test-repo.sh");
const TEST_REPO = "anthony-spruyt/xfg-test-2";

// GitHub default repo settings — used to reset between tests
const GITHUB_DEFAULTS = {
  has_wiki: true,
  has_projects: true,
  allow_squash_merge: true,
  allow_merge_commit: true,
  allow_rebase_merge: true,
  delete_branch_on_merge: false,
};

function resetTestRepo(): void {
  console.log("\n=== Resetting test repo to clean state ===\n");
  exec(`bash ${RESET_SCRIPT} ${TEST_REPO}`);
  console.log("\n=== Reset complete ===\n");
}

/**
 * Reset repo settings to GitHub defaults via PATCH API.
 * Uses gh CLI which has GH_TOKEN - this is intentional for setup.
 */
function resetRepoSettings(): void {
  console.log("  Resetting repo settings to defaults...");
  const fields = Object.entries(GITHUB_DEFAULTS)
    .map(([k, v]) => `-F ${k}=${v}`)
    .join(" ");
  exec(`gh api --method PATCH repos/${TEST_REPO} ${fields}`);
  console.log("  Settings reset to defaults");
}

// Act only — exec() throws on non-zero exit code.
// All assertions (commit verified, author is App) are in the Assert CI step.
describe("GitHub App Integration Test", { skip: SKIP_TESTS }, () => {
  beforeEach(() => {
    resetTestRepo();
  });

  test("sync creates PR via GraphQL API with GitHub App credentials", () => {
    const configPath = join(fixturesDir, "integration-test-github-app.yaml");
    console.log("Running xfg sync with GitHub App credentials...");
    const output = exec(`node dist/cli.js --config ${configPath}`, xfgEnv);
    console.log(output);
  });

  test("direct mode pushes verified commit to main", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-github-app-direct.yaml"
    );
    console.log("Running xfg sync with direct mode + GitHub App...");
    const output = exec(`node dist/cli.js --config ${configPath}`, xfgEnv);
    console.log(output);
  });

  test("settings command with bypass_actors is idempotent", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-github-app-settings.yaml"
    );

    // Create the ruleset
    console.log("Creating ruleset with bypass_actors...");
    const createOutput = exec(
      `node dist/cli.js settings --config ${configPath}`,
      xfgEnv
    );
    console.log(createOutput);

    // Run again in dry-run — should not fail
    console.log("\nRunning settings --dry-run (should be idempotent)...");
    const dryRunOutput = exec(
      `node dist/cli.js settings --config ${configPath} --dry-run`,
      xfgEnv
    );
    console.log(dryRunOutput);
  });

  test("deleteOrphaned removes orphan files", async () => {
    const configPath1 = join(
      fixturesDir,
      "integration-test-github-app-delete-phase1.yaml"
    );
    const configPath2 = join(
      fixturesDir,
      "integration-test-github-app-delete-phase2.yaml"
    );

    // Phase 1: Create files with deleteOrphaned config
    console.log("Phase 1: Creating files with deleteOrphaned: true...");
    const output1 = exec(`node dist/cli.js --config ${configPath1}`, xfgEnv);
    console.log(output1);

    // Small delay for GitHub API eventual consistency
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Phase 2: Remove file from config (should trigger deletion)
    console.log(
      "\nPhase 2: Removing file from config (should delete orphan)..."
    );
    const output2 = exec(`node dist/cli.js --config ${configPath2}`, xfgEnv);
    console.log(output2);
  });

  // Regression test for issue #418 - RepoSettingsProcessor missing GitHub App token support
  test("repo settings with GitHub App token is idempotent", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-github-app-repo-settings.yaml"
    );

    // Reset repo settings to defaults (uses gh CLI with GH_TOKEN for setup)
    resetRepoSettings();

    // Apply repo settings with GitHub App credentials (no GH_TOKEN)
    console.log("Applying repo settings with GitHub App credentials...");
    const applyOutput = exec(
      `node dist/cli.js settings --config ${configPath}`,
      xfgEnv
    );
    console.log(applyOutput);

    // Run again - should report no changes (idempotency check)
    // Before fix #418, this would show all settings as "additions" because
    // RepoSettingsProcessor couldn't fetch current settings without token
    console.log("\nRunning settings again (should report no changes)...");
    const secondOutput = exec(
      `node dist/cli.js settings --config ${configPath}`,
      xfgEnv
    );
    console.log(secondOutput);

    // Assert idempotency - second run should have no changes
    assert.ok(
      secondOutput.includes("No changes needed") ||
        secondOutput.includes("0 to add, 0 to change"),
      `Expected no changes on second run, got: ${secondOutput}`
    );
  });
});
