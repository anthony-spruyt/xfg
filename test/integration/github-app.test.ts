import { test, describe } from "node:test";
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

// Act only — exec() throws on non-zero exit code.
// All assertions (commit verified, author is App) are in the Assert CI step.
describe("GitHub App Integration Test", { skip: SKIP_TESTS }, () => {
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
});
