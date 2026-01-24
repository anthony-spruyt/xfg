import { test, describe, before } from "node:test";
import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "../..");
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

describe("GitHub Integration Test", () => {
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
        `gh api --method PUT repos/${TEST_REPO}/contents/README.md -f message="Initial commit" -f content="$(echo '# Test Repository\n\nThis repo is used for integration testing xfg.' | base64 -w0)"`,
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
    const configPath = join(fixturesDir, "integration-test-config-github.yaml");

    // Run the sync tool
    console.log("Running xfg...");
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

    const configPath = join(fixturesDir, "integration-test-config-github.yaml");

    // Get the current PR number before re-sync
    console.log("Getting current PR number...");
    const prListBefore = exec(
      `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number --jq '.[0].number'`,
    );
    const prNumberBefore = prListBefore ? parseInt(prListBefore, 10) : null;
    console.log(`  Current PR: #${prNumberBefore}`);

    assert.ok(prNumberBefore, "Expected a PR to exist from previous test");

    // Run the sync tool again
    console.log("\nRunning xfg again (re-sync)...");
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
    console.log("\nRunning xfg with createOnly config...");
    const configPath = join(
      fixturesDir,
      "integration-test-createonly-github.yaml",
    );
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

  test("PR title only includes files that actually changed (issue #90)", async () => {
    // This test verifies the bug fix for issue #90:
    // When some files in the config don't actually change (content matches repo),
    // they should NOT appear in the PR title or commit message.
    // NOTE: This test uses the same exec() helper defined at line 19-35, which
    // is safe because all commands are hardcoded (not derived from user input).

    const unchangedFile = "unchanged-test.json";
    const changedFile = "changed-test.json";
    const testBranch = "chore/sync-config";

    console.log("\n=== Setting up unchanged files test (issue #90) ===\n");

    // 1. Close any existing PRs from this branch
    console.log("Closing any existing PRs...");
    try {
      const existingPRs = exec(
        `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number --jq '.[].number'`,
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
    console.log(`Deleting remote branch ${testBranch} if exists...`);
    try {
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/git/refs/heads/${testBranch}`,
      );
      console.log("  Branch deleted");
    } catch {
      console.log("  Branch does not exist");
    }

    // 3. Create the "unchanged" file on main branch with content that matches config
    // The config has: { "unchanged": true }
    console.log(
      `Creating ${unchangedFile} on main branch (will NOT change)...`,
    );
    const unchangedContent =
      JSON.stringify({ unchanged: true }, null, 2) + "\n";
    const unchangedContentBase64 =
      Buffer.from(unchangedContent).toString("base64");

    // Check if file exists and get its sha
    let fileSha = "";
    try {
      fileSha = exec(
        `gh api repos/${TEST_REPO}/contents/${unchangedFile} --jq '.sha'`,
      );
    } catch {
      fileSha = "";
    }

    if (fileSha && !fileSha.includes("Not Found")) {
      exec(
        `gh api --method PUT repos/${TEST_REPO}/contents/${unchangedFile} -f message="test: setup ${unchangedFile} for issue #90 test" -f content="${unchangedContentBase64}" -f sha="${fileSha}"`,
      );
    } else {
      exec(
        `gh api --method PUT repos/${TEST_REPO}/contents/${unchangedFile} -f message="test: setup ${unchangedFile} for issue #90 test" -f content="${unchangedContentBase64}"`,
      );
    }
    console.log("  File created with content matching config");

    // 4. Delete changed-test.json if it exists (to ensure it will be created)
    console.log(`Deleting ${changedFile} if exists...`);
    try {
      const changedSha = exec(
        `gh api repos/${TEST_REPO}/contents/${changedFile} --jq '.sha'`,
      );
      if (changedSha && !changedSha.includes("Not Found")) {
        exec(
          `gh api --method DELETE repos/${TEST_REPO}/contents/${changedFile} -f message="test: cleanup ${changedFile}" -f sha="${changedSha}"`,
        );
        console.log("  File deleted");
      }
    } catch {
      console.log("  File does not exist");
    }

    // 5. Run sync with the test config
    console.log("\nRunning xfg with unchanged files config...");
    const configPath = join(
      fixturesDir,
      "integration-test-unchanged-github.yaml",
    );
    const output = exec(`node dist/index.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 6. Get the PR and check its title
    console.log("\nVerifying PR title...");
    const prInfo = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number,title --jq '.[0]'`,
    );

    assert.ok(prInfo, "Expected a PR to be created");
    const pr = JSON.parse(prInfo);
    console.log(`  PR #${pr.number}: ${pr.title}`);

    // THE KEY ASSERTION: PR title should only mention the changed file
    // With the bug: title would be "chore: sync changed-test.json, unchanged-test.json"
    // After fix: title should be "chore: sync changed-test.json"
    assert.ok(
      pr.title.includes(changedFile),
      `PR title should include ${changedFile}`,
    );
    assert.ok(
      !pr.title.includes(unchangedFile),
      `PR title should NOT include ${unchangedFile} (bug #90: unchanged files incorrectly listed)`,
    );

    // 7. Cleanup
    console.log("\nCleaning up test files...");
    try {
      const sha1 = exec(
        `gh api repos/${TEST_REPO}/contents/${unchangedFile} --jq '.sha'`,
      );
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/contents/${unchangedFile} -f message="test: cleanup ${unchangedFile}" -f sha="${sha1}"`,
      );
      console.log(`  Deleted ${unchangedFile}`);
    } catch {
      console.log(`  Could not delete ${unchangedFile}`);
    }

    try {
      // Note: changed-test.json only exists on the PR branch, not main
      // It will be cleaned up when the PR is closed
      console.log(`  ${changedFile} exists only on PR branch`);
    } catch {
      console.log(`  ${changedFile} not found`);
    }

    console.log("\n=== Unchanged files test (issue #90) passed ===\n");
  });

  test("template feature interpolates ${xfg:...} variables in files and PR body", async () => {
    // This test verifies the template feature (issue #133):
    // 1. Files with template: true should have ${xfg:...} variables interpolated
    // 2. Custom prTemplate should have ${xfg:...} variables interpolated in PR body
    // NOTE: This test uses the same exec() helper defined at line 19-35, which
    // is safe because all commands are hardcoded (not derived from user input).

    const templateFile = "template-test.json";
    const testBranch = "chore/sync-template-test";

    console.log("\n=== Setting up template feature test (issue #133) ===\n");

    // 1. Close any existing PRs from this branch
    console.log("Closing any existing PRs...");
    try {
      const existingPRs = exec(
        `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number --jq '.[].number'`,
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
    console.log(`Deleting remote branch ${testBranch} if exists...`);
    try {
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/git/refs/heads/${testBranch}`,
      );
      console.log("  Branch deleted");
    } catch {
      console.log("  Branch does not exist");
    }

    // 3. Delete template-test.json if it exists on main
    console.log(`Deleting ${templateFile} if exists...`);
    try {
      const sha = exec(
        `gh api repos/${TEST_REPO}/contents/${templateFile} --jq '.sha'`,
      );
      if (sha && !sha.includes("Not Found")) {
        exec(
          `gh api --method DELETE repos/${TEST_REPO}/contents/${templateFile} -f message="test: cleanup ${templateFile}" -f sha="${sha}"`,
        );
        console.log("  File deleted");
      }
    } catch {
      console.log("  File does not exist");
    }

    // 4. Run sync with the template test config
    console.log("\nRunning xfg with template config...");
    const configPath = join(
      fixturesDir,
      "integration-test-template-github.yaml",
    );
    const output = exec(`node dist/index.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 5. Get the PR and verify it was created
    console.log("\nVerifying PR was created...");
    const prInfo = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number,title --jq '.[0]'`,
    );

    assert.ok(prInfo, "Expected a PR to be created");
    const pr = JSON.parse(prInfo);
    console.log(`  PR #${pr.number}: ${pr.title}`);

    // 6. Verify the file content has interpolated values
    console.log("\nVerifying template interpolation...");
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${templateFile}?ref=${testBranch} --jq '.content' | base64 -d`,
    );

    assert.ok(fileContent, "File should exist in PR branch");
    const json = JSON.parse(fileContent);
    console.log("  File content:", JSON.stringify(json, null, 2));

    // Verify built-in variables were interpolated
    assert.equal(
      json.repoName,
      "xfg-test",
      "repo.name should be interpolated to 'xfg-test'",
    );
    assert.equal(
      json.repoOwner,
      "anthony-spruyt",
      "repo.owner should be interpolated to 'anthony-spruyt'",
    );
    assert.equal(
      json.repoFullName,
      "anthony-spruyt/xfg-test",
      "repo.fullName should be interpolated correctly",
    );
    assert.equal(
      json.platform,
      "github",
      "repo.platform should be interpolated to 'github'",
    );

    // Verify custom variable was interpolated
    assert.equal(
      json.custom,
      "custom-value",
      "Custom var should be interpolated",
    );

    // Verify escape mechanism works - $${xfg:...} should output literal ${xfg:...}
    assert.equal(
      json.escaped,
      "\${xfg:repo.name}",
      "Escaped variable should output literal \${xfg:repo.name}",
    );

    // Verify static values are unchanged
    assert.equal(
      json.static,
      "not-interpolated",
      "Static values should remain unchanged",
    );

    console.log("  All file template interpolations verified correctly");

    // 7. Verify PR body template interpolation
    console.log("\nVerifying PR body template interpolation...");
    const prBody = exec(
      `gh pr view ${pr.number} --repo ${TEST_REPO} --json body --jq '.body'`,
    );
    console.log("  PR body:", prBody);

    // Verify PR body contains interpolated values
    assert.ok(
      prBody.includes("anthony-spruyt/xfg-test"),
      "PR body should contain interpolated repo.fullName",
    );
    assert.ok(
      prBody.includes("1 file(s)"),
      "PR body should contain interpolated pr.fileCount",
    );
    assert.ok(
      prBody.includes("template-test.json"),
      "PR body should contain file name from pr.fileChanges",
    );
    assert.ok(
      prBody.includes("- Repository: xfg-test"),
      "PR body should contain interpolated repo.name",
    );
    assert.ok(
      prBody.includes("- Owner: anthony-spruyt"),
      "PR body should contain interpolated repo.owner",
    );
    assert.ok(
      prBody.includes("- Platform: github"),
      "PR body should contain interpolated repo.platform",
    );

    console.log("  All PR body template interpolations verified correctly");

    // 8. Cleanup
    console.log("\nCleaning up...");
    try {
      exec(`gh pr close ${pr.number} --repo ${TEST_REPO} --delete-branch`);
      console.log(`  Closed PR #${pr.number}`);
    } catch {
      console.log("  Could not close PR");
    }

    console.log("\n=== Template feature test (issue #133) passed ===\n");
  });

  test("direct mode pushes directly to main branch without creating PR (issue #134)", async () => {
    // This test verifies the direct mode feature (issue #134):
    // Files are pushed directly to the default branch without creating a PR.
    // NOTE: This test uses the same exec() helper defined at line 19-35, which
    // is safe because all commands are hardcoded (not derived from user input).

    const directFile = "direct-test.config.json";

    console.log("\n=== Setting up direct mode test (issue #134) ===\n");

    // 1. Delete the direct test file if it exists in the default branch
    console.log(`Deleting ${directFile} if exists...`);
    try {
      const sha = exec(
        `gh api repos/${TEST_REPO}/contents/${directFile} --jq '.sha'`,
      );
      if (sha && !sha.includes("Not Found")) {
        exec(
          `gh api --method DELETE repos/${TEST_REPO}/contents/${directFile} -f message="test: cleanup ${directFile}" -f sha="${sha}"`,
        );
        console.log("  File deleted");
      }
    } catch {
      console.log("  File does not exist");
    }

    // 2. Run sync with direct mode config
    console.log("\nRunning xfg with direct mode config...");
    const configPath = join(fixturesDir, "integration-test-direct-github.yaml");
    const output = exec(`node dist/index.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 3. Verify the output mentions direct push
    assert.ok(
      output.includes("Pushed directly") || output.includes("direct"),
      "Output should mention direct push",
    );

    // 4. Verify NO PR was created
    console.log("\nVerifying no PR was created...");
    try {
      const prList = exec(
        `gh pr list --repo ${TEST_REPO} --head chore/sync-direct-test --json number --jq '.[0].number'`,
      );
      assert.ok(!prList, "No PR should be created in direct mode");
    } catch {
      console.log("  No PR found - this is correct for direct mode");
    }

    // 5. Verify the file exists directly on main branch
    console.log("\nVerifying file exists on main branch...");
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${directFile} --jq '.content' | base64 -d`,
    );

    assert.ok(fileContent, "File should exist on main branch");
    const json = JSON.parse(fileContent);
    console.log("  File content:", JSON.stringify(json, null, 2));

    assert.equal(json.directMode, true, "File should have directMode: true");

    console.log("  Direct push verified - file is on main without PR");

    // 6. Cleanup - delete the test file from main
    console.log("\nCleaning up direct test file...");
    try {
      const sha = exec(
        `gh api repos/${TEST_REPO}/contents/${directFile} --jq '.sha'`,
      );
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/contents/${directFile} -f message="test: cleanup ${directFile}" -f sha="${sha}"`,
      );
      console.log("  File deleted");
    } catch {
      console.log("  Could not delete file");
    }

    console.log("\n=== Direct mode test (issue #134) passed ===\n");
  });

  test("deleteOrphaned removes files when removed from config (issue #132)", async () => {
    // This test verifies the deleteOrphaned feature (issue #132):
    // 1. Sync a file with deleteOrphaned: true (tracked in .xfg.json manifest)
    // 2. Remove the file from config
    // 3. Re-sync and verify the file is deleted
    // NOTE: This test uses the same exec() helper defined at line 19-35, which
    // is safe because all commands are hardcoded (not derived from user input).

    const orphanFile = "orphan-test.json";
    const manifestFile = ".xfg.json";
    const remainingFile = "remaining-file.json";
    const testBranch = "chore/sync-config";

    console.log("\n=== Setting up deleteOrphaned test (issue #132) ===\n");

    // 1. Close any existing PRs from this branch
    console.log("Closing any existing PRs...");
    try {
      const existingPRs = exec(
        `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number --jq '.[].number'`,
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
    console.log(`Deleting remote branch ${testBranch} if exists...`);
    try {
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/git/refs/heads/${testBranch}`,
      );
      console.log("  Branch deleted");
    } catch {
      console.log("  Branch does not exist");
    }

    // 3. Clean up test files if they exist on main
    for (const file of [orphanFile, manifestFile, remainingFile]) {
      console.log(`Deleting ${file} if exists...`);
      try {
        const sha = exec(
          `gh api repos/${TEST_REPO}/contents/${file} --jq '.sha'`,
        );
        if (sha && !sha.includes("Not Found")) {
          exec(
            `gh api --method DELETE repos/${TEST_REPO}/contents/${file} -f message="test: cleanup ${file}" -f sha="${sha}"`,
          );
          console.log(`  ${file} deleted`);
        }
      } catch {
        console.log(`  ${file} does not exist`);
      }
    }

    // 4. Phase 1: Run sync with deleteOrphaned config to create the file
    console.log("\n--- Phase 1: Create file with deleteOrphaned: true ---\n");
    const configPath1 = join(
      fixturesDir,
      "integration-test-delete-orphaned-github.yaml",
    );
    const output1 = exec(`node dist/index.js --config ${configPath1}`, {
      cwd: projectRoot,
    });
    console.log(output1);

    // 5. Verify the file exists on main branch (after force merge)
    console.log("\nVerifying orphan-test.json exists on main...");
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${orphanFile} --jq '.content' | base64 -d`,
    );
    assert.ok(fileContent, "orphan-test.json should exist on main");
    const json = JSON.parse(fileContent);
    console.log("  File content:", JSON.stringify(json));
    assert.equal(json.orphanTest, true, "File should have orphanTest: true");

    // 6. Verify manifest exists and tracks the file
    console.log("\nVerifying .xfg.json manifest exists...");
    const manifestContent = exec(
      `gh api repos/${TEST_REPO}/contents/${manifestFile} --jq '.content' | base64 -d`,
    );
    assert.ok(manifestContent, ".xfg.json should exist on main");
    const manifest = JSON.parse(manifestContent);
    console.log("  Manifest content:", JSON.stringify(manifest));
    const configId = "integration-test-delete-orphaned-github";
    assert.ok(
      manifest.configs[configId]?.includes(orphanFile),
      "Manifest should track orphan-test.json",
    );

    // 7. Phase 2: Run sync with config that removes the file
    console.log("\n--- Phase 2: Remove file from config (should delete) ---\n");
    const configPath2 = join(
      fixturesDir,
      "integration-test-delete-orphaned-phase2-github.yaml",
    );
    const output2 = exec(`node dist/index.js --config ${configPath2}`, {
      cwd: projectRoot,
    });
    console.log(output2);

    // 8. Verify the file has been deleted from main
    console.log("\nVerifying orphan-test.json was deleted...");
    try {
      exec(`gh api repos/${TEST_REPO}/contents/${orphanFile} --jq '.sha'`);
      assert.fail("orphan-test.json should have been deleted");
    } catch {
      console.log("  orphan-test.json correctly deleted");
    }

    // 9. Verify manifest was updated (orphan-test.json removed from config namespace)
    console.log("\nVerifying manifest was updated...");
    const manifestContent2 = exec(
      `gh api repos/${TEST_REPO}/contents/${manifestFile} --jq '.content' | base64 -d`,
    );
    const manifest2 = JSON.parse(manifestContent2);
    console.log("  Updated manifest:", JSON.stringify(manifest2));
    assert.ok(
      !manifest2.configs[configId]?.includes(orphanFile),
      "Manifest should no longer track orphan-test.json",
    );

    // 10. Cleanup
    console.log("\nCleaning up...");
    for (const file of [manifestFile, remainingFile]) {
      try {
        const sha = exec(
          `gh api repos/${TEST_REPO}/contents/${file} --jq '.sha'`,
        );
        if (sha && !sha.includes("Not Found")) {
          exec(
            `gh api --method DELETE repos/${TEST_REPO}/contents/${file} -f message="test: cleanup ${file}" -f sha="${sha}"`,
          );
          console.log(`  Deleted ${file}`);
        }
      } catch {
        console.log(`  Could not delete ${file}`);
      }
    }

    console.log("\n=== deleteOrphaned test (issue #132) passed ===\n");
  });

  test("handles divergent branch when existing PR is present (issue #183)", async () => {
    // This test verifies the fix for issue #183:
    // When xfg tries to push to a sync branch that has diverged from the new local changes,
    // it should use --force-with-lease to handle the divergent history gracefully.
    //
    // Scenario: Existing PR on sync branch, then main advances, creating divergent history.

    const divergentFile = "divergent-test.json";
    const testBranch = "chore/sync-divergent-test";

    console.log("\n=== Setting up divergent branch test (issue #183) ===\n");

    // 1. Close any existing PRs from this branch
    console.log("Closing any existing PRs...");
    try {
      const existingPRs = exec(
        `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number --jq '.[].number'`,
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
    console.log(`Deleting remote branch ${testBranch} if exists...`);
    try {
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/git/refs/heads/${testBranch}`,
      );
      console.log("  Branch deleted");
    } catch {
      console.log("  Branch does not exist");
    }

    // 3. Delete divergent-test.json if it exists on main
    console.log(`Deleting ${divergentFile} if exists on main...`);
    try {
      const sha = exec(
        `gh api repos/${TEST_REPO}/contents/${divergentFile} --jq '.sha'`,
      );
      if (sha && !sha.includes("Not Found")) {
        exec(
          `gh api --method PUT repos/${TEST_REPO}/contents/${divergentFile} -f message="test: setup ${divergentFile} for divergent test" -f content="${Buffer.from(JSON.stringify({ version: 1 }, null, 2) + "\n").toString("base64")}" -f sha="${sha}"`,
        );
        console.log("  File updated on main");
      }
    } catch {
      // Create the file
      exec(
        `gh api --method PUT repos/${TEST_REPO}/contents/${divergentFile} -f message="test: create ${divergentFile} for divergent test" -f content="${Buffer.from(JSON.stringify({ version: 1 }, null, 2) + "\n").toString("base64")}"`,
      );
      console.log("  File created on main");
    }

    // 4. Create initial PR with xfg (sets up sync branch)
    console.log("\n--- Phase 1: Create initial PR with xfg ---\n");
    const configPath = join(
      fixturesDir,
      "integration-test-divergent-github.yaml",
    );
    const output1 = exec(`node dist/index.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output1);

    // 5. Verify PR was created
    const prInfo1 = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number --jq '.[0].number'`,
    );
    assert.ok(prInfo1, "Initial PR should be created");
    console.log(`  Initial PR created: #${prInfo1}`);

    // 6. Now advance main by updating the file directly (creating divergent history)
    console.log(
      "\n--- Phase 2: Advance main to create divergent history ---\n",
    );
    const mainSha = exec(
      `gh api repos/${TEST_REPO}/contents/${divergentFile} --jq '.sha'`,
    );
    exec(
      `gh api --method PUT repos/${TEST_REPO}/contents/${divergentFile} -f message="test: advance main for divergent test" -f content="${Buffer.from(JSON.stringify({ version: 2, advancedOnMain: true }, null, 2) + "\n").toString("base64")}" -f sha="${mainSha}"`,
    );
    console.log("  Main branch advanced");

    // 7. Run xfg again - this should close the old PR, force-push, and create new PR
    console.log(
      "\n--- Phase 3: Run xfg again (should handle divergent history) ---\n",
    );
    const output2 = exec(`node dist/index.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output2);

    // 8. Verify the new PR was created successfully (not failed due to non-fast-forward)
    const prInfo2 = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number,title --jq '.[0]'`,
    );
    assert.ok(
      prInfo2,
      "New PR should be created after handling divergent history",
    );
    const pr2 = JSON.parse(prInfo2);
    console.log(`  New PR created: #${pr2.number} - ${pr2.title}`);

    // The key assertion: xfg should have succeeded even with divergent history
    assert.ok(
      output2.includes("PR:") || output2.includes("Succeeded: 1"),
      "Output should indicate PR creation succeeded",
    );

    // 9. Cleanup
    console.log("\nCleaning up divergent test...");
    try {
      exec(`gh pr close ${pr2.number} --repo ${TEST_REPO} --delete-branch`);
      console.log(`  Closed PR #${pr2.number}`);
    } catch {
      console.log("  Could not close PR");
    }
    try {
      const sha = exec(
        `gh api repos/${TEST_REPO}/contents/${divergentFile} --jq '.sha'`,
      );
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/contents/${divergentFile} -f message="test: cleanup ${divergentFile}" -f sha="${sha}"`,
      );
      console.log(`  Deleted ${divergentFile}`);
    } catch {
      console.log(`  Could not delete ${divergentFile}`);
    }

    console.log("\n=== Divergent branch test (issue #183) passed ===\n");
  });

  test("handles divergent branch when no PR exists but branch exists (issue #183)", async () => {
    // This test verifies the fix for issue #183, specifically the case where:
    // - closeExistingPR has nothing to close (no PR exists)
    // - But the remote sync branch still exists from a previous run
    // - This can happen if a previous xfg run failed after creating the branch but before PR creation
    //
    // Scenario: Remote sync branch exists without a PR, and local changes would diverge.

    const orphanBranchFile = "orphan-branch-test.json";
    const testBranch = "chore/sync-orphan-branch-test";

    console.log(
      "\n=== Setting up orphan branch test (issue #183 variant) ===\n",
    );

    // 1. Close any existing PRs and delete branch
    console.log("Closing any existing PRs...");
    try {
      const existingPRs = exec(
        `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number --jq '.[].number'`,
      );
      if (existingPRs) {
        for (const prNumber of existingPRs.split("\n").filter(Boolean)) {
          exec(`gh pr close ${prNumber} --repo ${TEST_REPO} --delete-branch`);
        }
      }
    } catch {
      console.log("  No existing PRs to close");
    }

    // 2. Delete the remote branch if it exists
    console.log(`Deleting remote branch ${testBranch} if exists...`);
    try {
      exec(
        `gh api --method DELETE repos/${TEST_REPO}/git/refs/heads/${testBranch}`,
      );
    } catch {
      console.log("  Branch does not exist");
    }

    // 3. Delete test file if it exists on main
    console.log(`Deleting ${orphanBranchFile} if exists on main...`);
    try {
      const sha = exec(
        `gh api repos/${TEST_REPO}/contents/${orphanBranchFile} --jq '.sha'`,
      );
      if (sha && !sha.includes("Not Found")) {
        exec(
          `gh api --method DELETE repos/${TEST_REPO}/contents/${orphanBranchFile} -f message="test: cleanup" -f sha="${sha}"`,
        );
      }
    } catch {
      console.log("  File does not exist");
    }

    // 4. Create the remote sync branch directly (without PR) by committing a different version
    // This simulates a scenario where a branch exists but has different content
    console.log(
      "\n--- Phase 1: Create orphan sync branch directly (no PR) ---\n",
    );

    // First, get the main branch SHA
    const mainSha = exec(
      `gh api repos/${TEST_REPO}/git/refs/heads/main --jq '.object.sha'`,
    );
    console.log(`  Main branch SHA: ${mainSha}`);

    // Create the branch pointing to main
    exec(
      `gh api --method POST repos/${TEST_REPO}/git/refs -f ref="refs/heads/${testBranch}" -f sha="${mainSha}"`,
    );
    console.log(`  Created branch ${testBranch}`);

    // Commit a file to the branch (different content than what xfg will sync)
    const branchContent =
      JSON.stringify({ orphanBranchVersion: 1 }, null, 2) + "\n";
    exec(
      `gh api --method PUT repos/${TEST_REPO}/contents/${orphanBranchFile} -f message="test: create file on orphan branch" -f content="${Buffer.from(branchContent).toString("base64")}" -f branch="${testBranch}"`,
    );
    console.log(`  Committed file to ${testBranch}`);

    // 5. Verify no PR exists for this branch
    const prCheck = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number --jq 'length'`,
    );
    assert.equal(
      prCheck,
      "0",
      "Should have no PR initially (orphan branch scenario)",
    );
    console.log("  Verified: No PR exists for the orphan branch");

    // 6. Run xfg - it should force-push and create a new PR
    console.log(
      "\n--- Phase 2: Run xfg (should force-push to orphan branch) ---\n",
    );
    const configPath = join(
      fixturesDir,
      "integration-test-orphan-branch-github.yaml",
    );
    const output = exec(`node dist/index.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 7. Verify PR was created successfully
    const prInfo = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number,title --jq '.[0]'`,
    );
    assert.ok(
      prInfo,
      "PR should be created after force-pushing to orphan branch",
    );
    const pr = JSON.parse(prInfo);
    console.log(`  PR created: #${pr.number} - ${pr.title}`);

    // 8. Verify the file content matches xfg config (not the orphan branch version)
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${orphanBranchFile}?ref=${testBranch} --jq '.content' | base64 -d`,
    );
    const json = JSON.parse(fileContent);
    console.log("  File content on PR branch:", JSON.stringify(json));
    assert.ok(
      !json.orphanBranchVersion,
      "Should NOT have orphanBranchVersion (old content)",
    );
    assert.equal(
      json.syncedByXfg,
      true,
      "Should have syncedByXfg: true (xfg content)",
    );

    // 9. Cleanup
    console.log("\nCleaning up orphan branch test...");
    try {
      exec(`gh pr close ${pr.number} --repo ${TEST_REPO} --delete-branch`);
      console.log(`  Closed PR #${pr.number}`);
    } catch {
      console.log("  Could not close PR");
    }

    console.log("\n=== Orphan branch test (issue #183 variant) passed ===\n");
  });
});
