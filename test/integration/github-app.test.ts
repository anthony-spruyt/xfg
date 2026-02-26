import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { exec, waitForCommitVerified, projectRoot } from "./test-helpers.js";

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

const SYNC_BRANCH = "chore/sync-github-app-test";
const DIRECT_FILE = "github-app-direct-test.json";

// Note: exec() here calls the test-helpers wrapper (not child_process.exec directly).
// All arguments are hardcoded test constants — no user input, no injection risk.
describe("GitHub App Integration Test", { skip: SKIP_TESTS }, () => {
  beforeEach(() => {
    resetTestRepo();
  });

  test("sync creates PR via GraphQL API with GitHub App credentials", async () => {
    const configPath = join(fixturesDir, "integration-test-github-app.yaml");
    console.log("Running xfg sync with GitHub App credentials...");
    const output = exec(`node dist/cli.js sync --config ${configPath}`, xfgEnv);
    console.log(output);

    // Assert: PR exists on the sync branch
    const prNumber = exec(
      `gh api repos/${TEST_REPO}/pulls --jq '.[] | select(.head.ref == "${SYNC_BRANCH}") | .number'`
    );
    assert.ok(prNumber, `Expected PR on ${SYNC_BRANCH}, found none`);
    console.log(`  PR #${prNumber} exists`);

    // Assert: commit author is App (not github-actions[bot] which would mean PAT leaked)
    const commitSha = exec(
      `gh api repos/${TEST_REPO}/commits/${SYNC_BRANCH} --jq '.sha'`
    );
    const author = exec(
      `gh api repos/${TEST_REPO}/commits/${commitSha} --jq '.commit.author.name'`
    );
    console.log(`  Commit author: ${author}`);
    assert.notStrictEqual(
      author,
      "github-actions[bot]",
      "Commit author is github-actions[bot] — PAT leaked into App test"
    );

    // Assert: commit is verified (poll for eventual consistency)
    await waitForCommitVerified(TEST_REPO, commitSha);
  });

  test("direct mode pushes verified commit to main", async () => {
    const configPath = join(
      fixturesDir,
      "integration-test-github-app-direct.yaml"
    );
    console.log("Running xfg sync with direct mode + GitHub App...");
    const output = exec(`node dist/cli.js sync --config ${configPath}`, xfgEnv);
    console.log(output);

    // Assert: file exists on main
    const fileSha = exec(
      `gh api repos/${TEST_REPO}/contents/${DIRECT_FILE} --jq '.sha'`
    );
    assert.ok(fileSha, `Expected ${DIRECT_FILE} to exist on main`);

    // Assert: latest main commit is authored by App (not github-actions[bot])
    const mainSha = exec(`gh api repos/${TEST_REPO}/commits/main --jq '.sha'`);
    const author = exec(
      `gh api repos/${TEST_REPO}/commits/${mainSha} --jq '.commit.author.name'`
    );
    console.log(`  Direct mode commit author: ${author}`);
    assert.notStrictEqual(
      author,
      "github-actions[bot]",
      "Direct mode commit author is github-actions[bot]"
    );

    // Assert: commit is verified (poll for eventual consistency)
    await waitForCommitVerified(TEST_REPO, mainSha);
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
    const output1 = exec(
      `node dist/cli.js sync --config ${configPath1}`,
      xfgEnv
    );
    console.log(output1);

    // Small delay for GitHub API eventual consistency
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Phase 2: Remove file from config (should trigger deletion)
    console.log(
      "\nPhase 2: Removing file from config (should delete orphan)..."
    );
    const output2 = exec(
      `node dist/cli.js sync --config ${configPath2}`,
      xfgEnv
    );
    console.log(output2);
  });
});

// Separate describe block — repo settings don't need full repo reset
describe("GitHub App Repo Settings Test", { skip: SKIP_TESTS }, () => {
  // Regression test for issue #418 - RepoSettingsProcessor missing GitHub App token support
  test("repo settings with GitHub App token is idempotent", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-github-app-repo-settings.yaml"
    );

    // Reset repo settings to defaults (uses gh CLI with GH_TOKEN for setup)
    // Note: This does NOT reset the repo content/commits, only settings
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

// Force PAT-only auth: strip App credentials so GH_TOKEN is used for admin operations
const patOnlyEnv = {
  env: {
    XFG_GITHUB_APP_ID: undefined,
    XFG_GITHUB_APP_PRIVATE_KEY: undefined,
  },
};

function setupSignedCommitRuleset(): void {
  console.log("  Applying required_signatures ruleset...");
  const configPath = join(
    fixturesDir,
    "integration-test-github-app-signed-refs-settings.yaml"
  );
  exec(`node dist/cli.js settings --config ${configPath}`, patOnlyEnv);
  console.log("  required_signatures ruleset active on all branches");
}

describe("GitHub App Signed Refs Test", { skip: SKIP_TESTS }, () => {
  beforeEach(() => {
    resetTestRepo();
    setupSignedCommitRuleset();
  });

  test("sync creates PR on repo with required_signatures on all branches", async () => {
    const configPath = join(fixturesDir, "integration-test-github-app.yaml");
    console.log("Running xfg sync with required_signatures active...");
    const output = exec(`node dist/cli.js sync --config ${configPath}`, xfgEnv);
    console.log(output);

    // Assert: PR exists and commit is verified despite required_signatures
    const prNumber = exec(
      `gh api repos/${TEST_REPO}/pulls --jq '.[] | select(.head.ref == "${SYNC_BRANCH}") | .number'`
    );
    assert.ok(prNumber, `Expected PR on ${SYNC_BRANCH}, found none`);

    const commitSha = exec(
      `gh api repos/${TEST_REPO}/commits/${SYNC_BRANCH} --jq '.sha'`
    );
    await waitForCommitVerified(TEST_REPO, commitSha);
  });
});
