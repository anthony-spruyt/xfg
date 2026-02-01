import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "../..");
const fixturesDir = join(projectRoot, "fixtures");

const TEST_REPO = "anthony-spruyt/xfg-test";
const RULESET_NAME = "xfg-test-ruleset";

// This exec helper is only used in integration tests with hardcoded commands.
// The commands are controlled and not derived from external/user input.
function exec(command: string, options?: { cwd?: string }): string {
  try {
    return execSync(command, {
      // codeql-disable-next-line js/shell-command-injection-from-environment
      cwd: options?.cwd ?? projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string };
    console.error("Command failed:", command);
    console.error("stderr:", err.stderr);
    console.error("stdout:", err.stdout);
    throw error;
  }
}

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

describe("GitHub Protect Integration Test", () => {
  before(() => {
    console.log("\n=== Setting up protect integration test ===\n");

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

  test("protect creates a ruleset in the test repository", async () => {
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-protect.yaml"
    );

    // Verify no ruleset exists before
    console.log("Verifying no ruleset exists...");
    const rulesetsBefore = exec(
      `gh api repos/${TEST_REPO}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsBefore, "0", "Expected no ruleset to exist before");

    // Run the protect command
    console.log("\nRunning xfg protect...");
    const output = exec(`node dist/cli.js protect --config ${configPath}`, {
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

    console.log("\n=== Protect integration test passed ===\n");
  });

  test("protect updates an existing ruleset", async () => {
    // Create a modified config with different settings
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-protect.yaml"
    );

    // First verify the ruleset exists from previous test
    console.log("Verifying ruleset exists from previous test...");
    const rulesetBefore = exec(
      `gh api repos/${TEST_REPO}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
    );
    assert.ok(rulesetBefore, "Expected ruleset to exist from previous test");

    const rulesetBeforeParsed = JSON.parse(rulesetBefore);
    const rulesetIdBefore = rulesetBeforeParsed.id;
    console.log(`  Ruleset ID before: ${rulesetIdBefore}`);

    // Run protect again - should update existing ruleset
    console.log("\nRunning xfg protect again (update)...");
    const output = exec(`node dist/cli.js protect --config ${configPath}`, {
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

  test("protect dry-run shows changes without applying", async () => {
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-protect.yaml"
    );

    // Delete the ruleset first
    console.log("Deleting ruleset to test dry-run...");
    deleteRulesetIfExists();

    // Verify no ruleset exists
    const rulesetsBefore = exec(
      `gh api repos/${TEST_REPO}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsBefore, "0", "Expected no ruleset before dry-run");

    // Run protect with dry-run
    console.log("\nRunning xfg protect --dry-run...");
    const output = exec(
      `node dist/cli.js protect --config ${configPath} --dry-run`,
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
