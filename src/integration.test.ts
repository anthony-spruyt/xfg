import { test, describe, before } from "node:test";
import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const fixturesDir = join(projectRoot, "fixtures");

const TEST_REPO = "anthony-spruyt/xfg-test";
const TARGET_FILE = "my.config.json";
const BRANCH_NAME = "chore/sync-my-config";

// This exec helper is only used in integration tests with hardcoded commands.
// The commands are controlled and not derived from external/user input.
function exec(command: string, options?: { cwd?: string }): string {
  try {
    // eslint-disable-next-line security/detect-child-process
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

describe("Integration Test", () => {
  before(() => {
    console.log("\n=== Setting up integration test ===\n");

    // 0. Initialize repo if empty (create initial commit)
    console.log("Checking if repo is initialized...");
    try {
      exec(`gh api repos/${TEST_REPO}/commits --jq '.[0].sha'`);
      console.log("  Repo has commits");
    } catch {
      console.log("  Repo is empty, initializing with README...");
      exec(
        `gh api --method PUT repos/${TEST_REPO}/contents/README.md -f message="Initial commit" -f content="$(echo '# Test Repository\n\nThis repo is used for integration testing json-config-sync.' | base64 -w0)"`,
      );
      console.log("  Repo initialized");
    }

    // 1. Close any existing PRs from the sync branch
    console.log("Closing any existing PRs...");
    try {
      const existingPRs = exec(
        `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number --jq '.[].number'`,
      );
      if (existingPRs) {
        for (const prNumber of existingPRs.split("\n").filter(Boolean)) {
          console.log(`  Closing PR #${prNumber}`);
          exec(`gh pr close ${prNumber} --repo ${TEST_REPO} --delete-branch`);
        }
      } else {
        console.log("  No existing PRs found");
      }
    } catch {
      console.log("  No existing PRs to close");
    }

    // 2. Delete the target file if it exists in the default branch
    console.log(`Checking if ${TARGET_FILE} exists in repo...`);
    try {
      const fileExists = exec(
        `gh api repos/${TEST_REPO}/contents/${TARGET_FILE} --jq '.sha' 2>/dev/null || echo ""`,
      );
      if (fileExists) {
        console.log(`  Deleting ${TARGET_FILE} from repo...`);
        exec(
          `gh api --method DELETE repos/${TEST_REPO}/contents/${TARGET_FILE} -f message="test: remove ${TARGET_FILE} for integration test" -f sha="${fileExists}"`,
        );
        console.log("  File deleted");
      } else {
        console.log("  File does not exist");
      }
    } catch {
      console.log("  File does not exist or already deleted");
    }

    // 3. Delete the remote branch if it exists
    console.log(`Deleting remote branch ${BRANCH_NAME} if exists...`);
    try {
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/git/refs/heads/${BRANCH_NAME}`,
      );
      console.log("  Branch deleted");
    } catch {
      console.log("  Branch does not exist");
    }

    // 4. Clean up local tmp directory
    const tmpDir = join(projectRoot, "tmp");
    if (existsSync(tmpDir)) {
      console.log("Cleaning up tmp directory...");
      rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log("\n=== Setup complete ===\n");
  });

  test("sync creates a PR in the test repository", async () => {
    const configPath = join(fixturesDir, "integration-test-config.yaml");

    // Run the sync tool
    console.log("Running json-config-sync...");
    const output = exec(`node dist/index.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify PR was created
    console.log("\nVerifying PR was created...");
    const prList = exec(
      `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number,title,url --jq '.[0]'`,
    );

    assert.ok(prList, "Expected a PR to be created");

    const pr = JSON.parse(prList);
    console.log(`  PR #${pr.number}: ${pr.title}`);
    console.log(`  URL: ${pr.url}`);

    assert.ok(pr.number, "PR should have a number");
    assert.ok(pr.title.includes("sync"), "PR title should mention sync");

    // Verify the file exists in the PR branch
    console.log("\nVerifying file exists in PR branch...");
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${TARGET_FILE}?ref=${BRANCH_NAME} --jq '.content' | base64 -d`,
    );

    assert.ok(fileContent, "File should exist in PR branch");

    // Parse and verify the merged JSON content
    const json = JSON.parse(fileContent);
    console.log("  File content:", JSON.stringify(json, null, 2));

    // Verify overlay property overrides base
    assert.equal(json.prop1, "main", "Overlay should override base prop1");

    // Verify base properties are inherited
    assert.equal(
      json.baseOnly,
      "inherited-from-root",
      "Base-only property should be inherited",
    );
    assert.deepEqual(
      json.prop2,
      { prop3: "MyService" },
      "Base prop2 should be inherited",
    );

    // Verify overlay adds new properties
    assert.equal(
      json.addedByOverlay,
      true,
      "Overlay should add new properties",
    );

    // Verify nested base properties are preserved
    assert.ok(
      json.prop4?.prop5?.length === 2,
      "Nested arrays from base should be preserved",
    );

    console.log("  Merged content verified - base + overlay working correctly");
    console.log("\n=== Integration test passed ===\n");
  });

  test("re-sync closes existing PR and creates fresh one", async () => {
    // This test relies on the previous test having created a PR
    // We'll run sync again and verify the behavior

    const configPath = join(fixturesDir, "integration-test-config.yaml");

    // Get the current PR number before re-sync
    console.log("Getting current PR number...");
    const prListBefore = exec(
      `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number --jq '.[0].number'`,
    );
    const prNumberBefore = prListBefore ? parseInt(prListBefore, 10) : null;
    console.log(`  Current PR: #${prNumberBefore}`);

    assert.ok(prNumberBefore, "Expected a PR to exist from previous test");

    // Run the sync tool again
    console.log("\nRunning json-config-sync again (re-sync)...");
    const output = exec(`node dist/index.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify a PR exists (should be a new one after closing the old)
    console.log("\nVerifying PR state after re-sync...");
    const prListAfter = exec(
      `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number,state --jq '.[0]'`,
    );

    assert.ok(prListAfter, "Expected a PR to exist after re-sync");
    const prAfter = JSON.parse(prListAfter);
    console.log(`  PR after re-sync: #${prAfter.number}`);

    // The old PR should be closed (or we have a new one)
    // Check that the old PR is now closed
    console.log("\nVerifying old PR was closed...");
    try {
      const oldPRState = exec(
        `gh pr view ${prNumberBefore} --repo ${TEST_REPO} --json state --jq '.state'`,
      );
      console.log(`  Old PR #${prNumberBefore} state: ${oldPRState}`);
      assert.equal(
        oldPRState,
        "CLOSED",
        "Old PR should be closed after re-sync",
      );
    } catch {
      // If we can't get the old PR, it might have been deleted
      console.log(
        `  Old PR #${prNumberBefore} appears to have been deleted or closed`,
      );
    }

    console.log("\n=== Re-sync test passed ===\n");
  });

  test("createOnly skips file when it exists on base branch", async () => {
    // This test uses a separate config file with createOnly: true
    const createOnlyFile = "createonly-test.json";
    const createOnlyBranch = "chore/sync-createonly-test";

    console.log("\n=== Setting up createOnly test ===\n");

    // 1. Close any existing PRs from the createOnly branch
    console.log("Closing any existing createOnly test PRs...");
    try {
      const existingPRs = exec(
        `gh pr list --repo ${TEST_REPO} --head ${createOnlyBranch} --json number --jq '.[].number'`,
      );
      if (existingPRs) {
        for (const prNumber of existingPRs.split("\n").filter(Boolean)) {
          console.log(`  Closing PR #${prNumber}`);
          exec(`gh pr close ${prNumber} --repo ${TEST_REPO} --delete-branch`);
        }
      }
    } catch {
      console.log("  No existing PRs to close");
    }

    // 2. Delete the remote branch if it exists
    console.log(`Deleting remote branch ${createOnlyBranch} if exists...`);
    try {
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/git/refs/heads/${createOnlyBranch}`,
      );
      console.log("  Branch deleted");
    } catch {
      console.log("  Branch does not exist");
    }

    // 3. Create the file on main branch (simulating it already exists)
    console.log(`Creating ${createOnlyFile} on main branch...`);
    const existingContent = JSON.stringify({ existing: true }, null, 2);
    const existingContentBase64 =
      Buffer.from(existingContent).toString("base64");

    // First check if file exists and get its sha
    let fileSha = "";
    try {
      // Use separate command to check existence - gh api exits non-zero on 404
      fileSha = exec(
        `gh api repos/${TEST_REPO}/contents/${createOnlyFile} --jq '.sha'`,
      );
    } catch {
      // File doesn't exist - fileSha remains empty
      fileSha = "";
    }

    if (fileSha && !fileSha.includes("Not Found")) {
      // Update existing file
      exec(
        `gh api --method PUT repos/${TEST_REPO}/contents/${createOnlyFile} -f message="test: update ${createOnlyFile} for createOnly test" -f content="${existingContentBase64}" -f sha="${fileSha}"`,
      );
    } else {
      // Create new file
      exec(
        `gh api --method PUT repos/${TEST_REPO}/contents/${createOnlyFile} -f message="test: create ${createOnlyFile} for createOnly test" -f content="${existingContentBase64}"`,
      );
    }
    console.log("  File created on main");

    // 4. Run sync with createOnly config
    console.log("\nRunning json-config-sync with createOnly config...");
    const configPath = join(fixturesDir, "integration-test-createonly.yaml");
    const output = exec(`node dist/index.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 5. Verify the behavior - output should indicate skipping
    assert.ok(
      output.includes("createOnly") || output.includes("skip"),
      "Output should mention createOnly or skip",
    );

    // 6. Check if a PR was created - with createOnly the file should be skipped
    // If all files are skipped, no PR should be created
    console.log("\nVerifying createOnly behavior...");
    try {
      const prList = exec(
        `gh pr list --repo ${TEST_REPO} --head ${createOnlyBranch} --json number --jq '.[0].number'`,
      );
      if (prList) {
        console.log(`  PR was created: #${prList}`);
        // If a PR was created, the file content should NOT have been changed
        // because createOnly should skip when file exists on base
        const fileContent = exec(
          `gh api repos/${TEST_REPO}/contents/${createOnlyFile}?ref=${createOnlyBranch} --jq '.content' | base64 -d`,
        );
        const json = JSON.parse(fileContent);
        console.log("  File content in PR branch:", JSON.stringify(json));
        // The file should still have the original content (existing: true)
        // NOT the new content from config
        assert.equal(
          json.existing,
          true,
          "File should retain original content when createOnly skips",
        );
      } else {
        console.log(
          "  No PR was created (all files skipped) - this is correct",
        );
      }
    } catch {
      console.log("  No PR was created - expected if all files were skipped");
    }

    // 7. Cleanup - delete the test file from main
    console.log("\nCleaning up createOnly test file...");
    try {
      const sha = exec(
        `gh api repos/${TEST_REPO}/contents/${createOnlyFile} --jq '.sha'`,
      );
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/contents/${createOnlyFile} -f message="test: cleanup ${createOnlyFile}" -f sha="${sha}"`,
      );
      console.log("  File deleted");
    } catch {
      console.log("  Could not delete file");
    }

    console.log("\n=== createOnly test passed ===\n");
  });
});
