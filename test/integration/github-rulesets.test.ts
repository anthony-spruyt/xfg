import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import {
  exec,
  projectRoot,
  waitForRulesetVisible as waitForRulesetVisibleBase,
} from "./test-helpers.js";

const fixturesDir = join(projectRoot, "test", "fixtures");

const TEST_REPO = "anthony-spruyt/xfg-test";
const RULESET_NAME = "xfg-test-ruleset";

function deleteRulesetIfExists(): void {
  try {
    const rulesets = exec(
      `gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}") | .id'`
    );
    if (rulesets) {
      for (const rulesetId of rulesets.split("\n").filter(Boolean)) {
        console.log(`  Deleting ruleset ID: ${rulesetId}`);
        exec(`gh api --method DELETE repos/${TEST_REPO}/rulesets/${rulesetId}`);
      }
    }
  } catch {
    console.log("  No existing rulesets to delete");
  }
}

// Wrapper to use TEST_REPO by default
async function waitForRulesetVisible(
  rulesetId: number,
  timeoutMs = 30000
): Promise<void> {
  return waitForRulesetVisibleBase(TEST_REPO, rulesetId, timeoutMs);
}

describe("GitHub Settings Integration Test", () => {
  before(() => {
    console.log("\n=== Setting up settings integration test ===\n");

    // Delete test ruleset if it exists from previous runs
    console.log("Cleaning up any existing test rulesets...");
    deleteRulesetIfExists();

    console.log("\n=== Setup complete ===\n");
  });

  after(() => {
    console.log("\n=== Cleaning up ===\n");

    // Delete test ruleset created during tests
    console.log("Deleting test ruleset...");
    deleteRulesetIfExists();

    console.log("\n=== Cleanup complete ===\n");
  });

  test("settings creates a ruleset in the test repository", async () => {
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-rulesets.yaml"
    );

    // Verify no ruleset exists before
    console.log("Verifying no ruleset exists...");
    const rulesetsBefore = exec(
      `gh api repos/${TEST_REPO}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsBefore, "0", "Expected no ruleset to exist before");

    // Run the settings command
    console.log("\nRunning xfg settings...");
    const output = exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify ruleset was created
    console.log("\nVerifying ruleset was created...");
    const rulesetsAfter = exec(
      `gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
    );

    assert.ok(rulesetsAfter, "Expected a ruleset to be created");

    const ruleset = JSON.parse(rulesetsAfter);
    console.log(`  Ruleset ID: ${ruleset.id}`);
    console.log(`  Ruleset name: ${ruleset.name}`);
    console.log(`  Enforcement: ${ruleset.enforcement}`);

    assert.equal(ruleset.name, RULESET_NAME, "Ruleset name should match");
    assert.equal(ruleset.enforcement, "active", "Ruleset should be active");
    assert.equal(ruleset.target, "branch", "Ruleset target should be branch");

    // Wait for API consistency before next test runs
    // GitHub API has eventual consistency - newly created rulesets may not
    // immediately appear in the list endpoint
    console.log("\nWaiting for API consistency...");
    await waitForRulesetVisible(ruleset.id);

    console.log("\n=== Settings integration test passed ===\n");
  });

  test("settings updates an existing ruleset", async () => {
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-rulesets.yaml"
    );

    // Setup: ensure clean state and create ruleset (self-contained test)
    console.log("Setting up: creating ruleset for update test...");
    deleteRulesetIfExists();

    // Create ruleset via xfg settings (mirrors real usage)
    console.log("\nCreating initial ruleset...");
    const createOutput = exec(
      `node dist/cli.js settings --config ${configPath}`,
      {
        cwd: projectRoot,
      }
    );
    console.log(createOutput);

    // Get the created ruleset and wait for visibility
    const rulesetCreated = exec(
      `gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
    );
    assert.ok(rulesetCreated, "Expected ruleset to be created");

    const rulesetBeforeParsed = JSON.parse(rulesetCreated);
    const rulesetIdBefore = rulesetBeforeParsed.id;
    console.log(`  Ruleset ID before update: ${rulesetIdBefore}`);

    // Wait for API consistency before update
    console.log("\nWaiting for API consistency...");
    await waitForRulesetVisible(rulesetIdBefore);

    // Run settings again - should update existing ruleset
    console.log("\nRunning xfg settings again (update)...");
    const output = exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify ruleset still exists with same ID (update, not recreate)
    console.log("\nVerifying ruleset was updated (same ID)...");
    const rulesetAfter = exec(
      `gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
    );

    const rulesetAfterParsed = JSON.parse(rulesetAfter);
    assert.equal(
      rulesetAfterParsed.id,
      rulesetIdBefore,
      "Ruleset ID should remain the same (update, not recreate)"
    );

    console.log("\n=== Update integration test passed ===\n");
  });

  test("settings dry-run shows changes without applying", async () => {
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-rulesets.yaml"
    );

    // Delete the ruleset first
    console.log("Deleting ruleset to test dry-run...");
    deleteRulesetIfExists();

    // Verify no ruleset exists
    const rulesetsBefore = exec(
      `gh api repos/${TEST_REPO}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsBefore, "0", "Expected no ruleset before dry-run");

    // Run settings with dry-run
    console.log("\nRunning xfg settings --dry-run...");
    const output = exec(
      `node dist/cli.js settings --config ${configPath} --dry-run`,
      {
        cwd: projectRoot,
      }
    );
    console.log(output);

    // Verify output indicates dry-run
    assert.ok(
      output.includes("DRY RUN") || output.includes("dry-run"),
      "Output should indicate dry-run mode"
    );

    // Verify no ruleset was actually created
    console.log("\nVerifying no ruleset was created...");
    const rulesetsAfter = exec(
      `gh api repos/${TEST_REPO}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsAfter, "0", "Dry-run should not create ruleset");

    console.log("\n=== Dry-run integration test passed ===\n");
  });
});
