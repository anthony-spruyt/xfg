import { test, describe } from "node:test";
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

describe("GitHub App Integration Test", { skip: SKIP_TESTS }, () => {
  test("creates verified commit via GraphQL API with GitHub App credentials", () => {
    const configPath = join(fixturesDir, "integration-test-github-app.yaml");

    console.log("Running xfg sync with GitHub App credentials...");
    const output = exec(`node dist/cli.js --config ${configPath}`, xfgEnv);
    console.log(output);

    // xfg should complete successfully (PR created)
    assert.ok(
      output.includes("PR") ||
        output.includes("pull request") ||
        output.includes("created"),
      "xfg should report PR creation"
    );
  });

  test("direct mode with GitHub App creates verified commit on main", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-github-app-direct.yaml"
    );

    console.log("Running xfg sync with direct mode + GitHub App...");
    const output = exec(`node dist/cli.js --config ${configPath}`, xfgEnv);
    console.log(output);

    // exec throws on non-zero exit code, so reaching here means success.
    // Verify xfg reported a successful outcome.
    assert.ok(
      output.includes("succeeded"),
      "xfg direct mode should report success"
    );
  });

  test("settings command uses App token — bypass_actors diff is stable (no false update)", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-github-app-settings.yaml"
    );

    // 1. Create the ruleset
    console.log("Creating ruleset with bypass_actors...");
    const createOutput = exec(
      `node dist/cli.js settings --config ${configPath}`,
      xfgEnv
    );
    console.log(createOutput);

    // 2. Run again in dry-run — should show UNCHANGED, not UPDATE
    console.log("\nRunning settings --dry-run (should be stable/unchanged)...");
    const dryRunOutput = exec(
      `node dist/cli.js settings --config ${configPath} --dry-run`,
      xfgEnv
    );
    console.log(dryRunOutput);

    assert.ok(
      !dryRunOutput.includes("update") || dryRunOutput.includes("0 to update"),
      "Dry-run should show no updates (bypass_actors should not cause false diff). " +
        "If this fails, the settings command is not using the App token for API calls. " +
        "See issue #378."
    );
  });

  test("deleteOrphaned removes files via GraphQL API with verified commit", async () => {
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

    assert.ok(
      output2.includes("deleted") ||
        output2.includes("removed") ||
        output2.includes("orphan"),
      "Phase 2 should report orphan file deletion"
    );
  });
});
