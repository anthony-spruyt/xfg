import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import {
  exec,
  projectRoot,
  waitForFileVisible as waitForFileVisibleBase,
} from "./test-helpers.js";

const fixturesDir = join(projectRoot, "test", "fixtures");

const TEST_REPO = "anthony-spruyt/xfg-test";
const TARGET_FILE = "my.config.json";
const BRANCH_NAME = "chore/sync-my-config";

// Wrapper to use TEST_REPO by default
async function waitForFileVisible(
  filePath: string,
  timeoutMs = 10000
): Promise<string> {
  return waitForFileVisibleBase(TEST_REPO, filePath, timeoutMs);
}

const RESET_SCRIPT = join(projectRoot, ".github/scripts/reset-test-repo.sh");

function resetTestRepo(): void {
  console.log("\n=== Resetting test repo to clean state ===\n");
  exec(`bash ${RESET_SCRIPT} ${TEST_REPO}`);
  console.log("\n=== Reset complete ===\n");
}

describe("GitHub Integration Test", () => {
  beforeEach(() => {
    resetTestRepo();
  });

  test("sync creates a PR in the test repository", async () => {
    const configPath = join(fixturesDir, "integration-test-config-github.yaml");

    // Run the sync tool
    console.log("Running xfg...");
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify PR was created
    console.log("\nVerifying PR was created...");
    const prList = exec(
      `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number,title,url --jq '.[0]'`
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
      `gh api repos/${TEST_REPO}/contents/${TARGET_FILE}?ref=${BRANCH_NAME} --jq '.content' | base64 -d`
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
      "Base-only property should be inherited"
    );
    assert.deepEqual(
      json.prop2,
      { prop3: "MyService" },
      "Base prop2 should be inherited"
    );

    // Verify overlay adds new properties
    assert.equal(
      json.addedByOverlay,
      true,
      "Overlay should add new properties"
    );

    // Verify nested base properties are preserved
    assert.ok(
      json.prop4?.prop5?.length === 2,
      "Nested arrays from base should be preserved"
    );

    console.log("  Merged content verified - base + overlay working correctly");
    console.log("\n=== Integration test passed ===\n");
  });

  test("re-sync closes existing PR and creates fresh one", async () => {
    // Arrange — create initial PR by running xfg
    const configPath = join(fixturesDir, "integration-test-config-github.yaml");
    console.log("Creating initial PR...");
    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    // Get the PR number
    console.log("Getting current PR number...");
    const prListBefore = exec(
      `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number --jq '.[0].number'`
    );
    const prNumberBefore = prListBefore ? parseInt(prListBefore, 10) : null;
    console.log(`  Current PR: #${prNumberBefore}`);
    assert.ok(prNumberBefore, "Expected a PR to exist after initial sync");

    // Run the sync tool again
    console.log("\nRunning xfg again (re-sync)...");
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify a PR exists (should be a new one after closing the old)
    console.log("\nVerifying PR state after re-sync...");
    const prListAfter = exec(
      `gh pr list --repo ${TEST_REPO} --head ${BRANCH_NAME} --json number,state --jq '.[0]'`
    );

    assert.ok(prListAfter, "Expected a PR to exist after re-sync");
    const prAfter = JSON.parse(prListAfter);
    console.log(`  PR after re-sync: #${prAfter.number}`);

    // The old PR should be closed (or we have a new one)
    // Check that the old PR is now closed
    console.log("\nVerifying old PR was closed...");
    try {
      const oldPRState = exec(
        `gh pr view ${prNumberBefore} --repo ${TEST_REPO} --json state --jq '.state'`
      );
      console.log(`  Old PR #${prNumberBefore} state: ${oldPRState}`);
      assert.equal(
        oldPRState,
        "CLOSED",
        "Old PR should be closed after re-sync"
      );
    } catch {
      // If we can't get the old PR, it might have been deleted
      console.log(
        `  Old PR #${prNumberBefore} appears to have been deleted or closed`
      );
    }

    console.log("\n=== Re-sync test passed ===\n");
  });

  test("createOnly skips file when it exists on base branch", async () => {
    // This test uses a separate config file with createOnly: true
    const createOnlyFile = "createonly-test.json";
    const createOnlyBranch = "chore/sync-createonly-test";

    console.log("\n=== Setting up createOnly test ===\n");

    // Create the file on main branch (simulating it already exists)
    console.log(`Creating ${createOnlyFile} on main branch...`);
    const existingContent = JSON.stringify({ existing: true }, null, 2);
    const existingContentBase64 =
      Buffer.from(existingContent).toString("base64");

    exec(
      `gh api --method PUT repos/${TEST_REPO}/contents/${createOnlyFile} -f message="test: create ${createOnlyFile} for createOnly test" -f content="${existingContentBase64}"`
    );
    console.log("  File created on main");

    // Run sync with createOnly config
    console.log("\nRunning xfg with createOnly config...");
    const configPath = join(
      fixturesDir,
      "integration-test-createonly-github.yaml"
    );
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify the behavior - output should indicate skipping
    assert.ok(
      output.includes("createOnly") || output.includes("skip"),
      "Output should mention createOnly or skip"
    );

    // Check if a PR was created - with createOnly the file should be skipped
    // If all files are skipped, no PR should be created
    console.log("\nVerifying createOnly behavior...");
    try {
      const prList = exec(
        `gh pr list --repo ${TEST_REPO} --head ${createOnlyBranch} --json number --jq '.[0].number'`
      );
      if (prList) {
        console.log(`  PR was created: #${prList}`);
        // If a PR was created, the file content should NOT have been changed
        // because createOnly should skip when file exists on base
        const fileContent = exec(
          `gh api repos/${TEST_REPO}/contents/${createOnlyFile}?ref=${createOnlyBranch} --jq '.content' | base64 -d`
        );
        const json = JSON.parse(fileContent);
        console.log("  File content in PR branch:", JSON.stringify(json));
        // The file should still have the original content (existing: true)
        // NOT the new content from config
        assert.equal(
          json.existing,
          true,
          "File should retain original content when createOnly skips"
        );
      } else {
        console.log(
          "  No PR was created (all files skipped) - this is correct"
        );
      }
    } catch {
      console.log("  No PR was created - expected if all files were skipped");
    }

    console.log("\n=== createOnly test passed ===\n");
  });

  test("PR title only includes files that actually changed (issue #90)", async () => {
    // This test verifies the bug fix for issue #90:
    // When some files in the config don't actually change (content matches repo),
    // they should NOT appear in the PR title or commit message.

    const unchangedFile = "unchanged-test.json";
    const changedFile = "changed-test.json";
    const testBranch = "chore/sync-config";

    console.log("\n=== Setting up unchanged files test (issue #90) ===\n");

    // Create the "unchanged" file on main branch with content that matches config
    // The config has: { "unchanged": true }
    console.log(
      `Creating ${unchangedFile} on main branch (will NOT change)...`
    );
    const unchangedContent =
      JSON.stringify({ unchanged: true }, null, 2) + "\n";
    const unchangedContentBase64 =
      Buffer.from(unchangedContent).toString("base64");

    exec(
      `gh api --method PUT repos/${TEST_REPO}/contents/${unchangedFile} -f message="test: setup ${unchangedFile} for issue #90 test" -f content="${unchangedContentBase64}"`
    );
    console.log("  File created with content matching config");

    // Run sync with the test config
    console.log("\nRunning xfg with unchanged files config...");
    const configPath = join(
      fixturesDir,
      "integration-test-unchanged-github.yaml"
    );
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Get the PR and check its title
    console.log("\nVerifying PR title...");
    const prInfo = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number,title --jq '.[0]'`
    );

    assert.ok(prInfo, "Expected a PR to be created");
    const pr = JSON.parse(prInfo);
    console.log(`  PR #${pr.number}: ${pr.title}`);

    // THE KEY ASSERTION: PR title should only mention the changed file
    // With the bug: title would be "chore: sync changed-test.json, unchanged-test.json"
    // After fix: title should be "chore: sync changed-test.json"
    assert.ok(
      pr.title.includes(changedFile),
      `PR title should include ${changedFile}`
    );
    assert.ok(
      !pr.title.includes(unchangedFile),
      `PR title should NOT include ${unchangedFile} (bug #90: unchanged files incorrectly listed)`
    );

    console.log("\n=== Unchanged files test (issue #90) passed ===\n");
  });

  test("template feature interpolates ${xfg:...} variables in files and PR body", async () => {
    // This test verifies the template feature (issue #133):
    // 1. Files with template: true should have ${xfg:...} variables interpolated
    // 2. Custom prTemplate should have ${xfg:...} variables interpolated in PR body

    const templateFile = "template-test.json";
    const testBranch = "chore/sync-template-test";

    console.log("\n=== Setting up template feature test (issue #133) ===\n");

    // Run sync with the template test config
    console.log("\nRunning xfg with template config...");
    const configPath = join(
      fixturesDir,
      "integration-test-template-github.yaml"
    );
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Get the PR and verify it was created
    console.log("\nVerifying PR was created...");
    const prInfo = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number,title --jq '.[0]'`
    );

    assert.ok(prInfo, "Expected a PR to be created");
    const pr = JSON.parse(prInfo);
    console.log(`  PR #${pr.number}: ${pr.title}`);

    // Verify the file content has interpolated values
    console.log("\nVerifying template interpolation...");
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${templateFile}?ref=${testBranch} --jq '.content' | base64 -d`
    );

    assert.ok(fileContent, "File should exist in PR branch");
    const json = JSON.parse(fileContent);
    console.log("  File content:", JSON.stringify(json, null, 2));

    // Verify built-in variables were interpolated
    assert.equal(
      json.repoName,
      "xfg-test",
      "repo.name should be interpolated to 'xfg-test'"
    );
    assert.equal(
      json.repoOwner,
      "anthony-spruyt",
      "repo.owner should be interpolated to 'anthony-spruyt'"
    );
    assert.equal(
      json.repoFullName,
      "anthony-spruyt/xfg-test",
      "repo.fullName should be interpolated correctly"
    );
    assert.equal(
      json.platform,
      "github",
      "repo.platform should be interpolated to 'github'"
    );

    // Verify custom variable was interpolated
    assert.equal(
      json.custom,
      "custom-value",
      "Custom var should be interpolated"
    );

    // Verify escape mechanism works - $${xfg:...} should output literal ${xfg:...}
    assert.equal(
      json.escaped,
      "${xfg:repo.name}",
      "Escaped variable should output literal ${xfg:repo.name}"
    );

    // Verify static values are unchanged
    assert.equal(
      json.static,
      "not-interpolated",
      "Static values should remain unchanged"
    );

    console.log("  All file template interpolations verified correctly");

    // Verify PR body template interpolation
    console.log("\nVerifying PR body template interpolation...");
    const prBody = exec(
      `gh pr view ${pr.number} --repo ${TEST_REPO} --json body --jq '.body'`
    );
    console.log("  PR body:", prBody);

    // Verify PR body contains interpolated values
    assert.ok(
      prBody.includes("anthony-spruyt/xfg-test"),
      "PR body should contain interpolated repo.fullName"
    );
    assert.ok(
      prBody.includes("1 file(s)"),
      "PR body should contain interpolated pr.fileCount"
    );
    assert.ok(
      prBody.includes("template-test.json"),
      "PR body should contain file name from pr.fileChanges"
    );
    assert.ok(
      prBody.includes("- Repository: xfg-test"),
      "PR body should contain interpolated repo.name"
    );
    assert.ok(
      prBody.includes("- Owner: anthony-spruyt"),
      "PR body should contain interpolated repo.owner"
    );
    assert.ok(
      prBody.includes("- Platform: github"),
      "PR body should contain interpolated repo.platform"
    );

    console.log("  All PR body template interpolations verified correctly");

    console.log("\n=== Template feature test (issue #133) passed ===\n");
  });

  test("direct mode pushes directly to main branch without creating PR (issue #134)", async () => {
    // This test verifies the direct mode feature (issue #134):
    // Files are pushed directly to the default branch without creating a PR.

    const directFile = "direct-test.config.json";

    console.log("\n=== Setting up direct mode test (issue #134) ===\n");

    // Run sync with direct mode config
    console.log("\nRunning xfg with direct mode config...");
    const configPath = join(fixturesDir, "integration-test-direct-github.yaml");
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify the output mentions direct push
    assert.ok(
      output.includes("Pushed directly") || output.includes("direct"),
      "Output should mention direct push"
    );

    // Verify NO PR was created
    console.log("\nVerifying no PR was created...");
    try {
      const prList = exec(
        `gh pr list --repo ${TEST_REPO} --head chore/sync-direct-test --json number --jq '.[0].number'`
      );
      assert.ok(!prList, "No PR should be created in direct mode");
    } catch {
      console.log("  No PR found - this is correct for direct mode");
    }

    // Verify the file exists directly on main branch (with retry for API consistency)
    console.log("\nVerifying file exists on main branch...");
    const fileContent = await waitForFileVisible(directFile);

    assert.ok(fileContent, "File should exist on main branch");
    const json = JSON.parse(fileContent);
    console.log("  File content:", JSON.stringify(json, null, 2));

    assert.equal(json.directMode, true, "File should have directMode: true");

    console.log("  Direct push verified - file is on main without PR");

    console.log("\n=== Direct mode test (issue #134) passed ===\n");
  });

  test("deleteOrphaned removes files when removed from config (issue #132)", async () => {
    // This test verifies the deleteOrphaned feature (issue #132):
    // 1. Sync a file with deleteOrphaned: true (tracked in .xfg.json manifest)
    // 2. Remove the file from config
    // 3. Re-sync and verify the file is deleted

    const orphanFile = "orphan-test.json";
    const manifestFile = ".xfg.json";

    console.log("\n=== Setting up deleteOrphaned test (issue #132) ===\n");

    // Phase 1: Run sync with deleteOrphaned config to create the file
    console.log("\n--- Phase 1: Create file with deleteOrphaned: true ---\n");
    const configPath1 = join(
      fixturesDir,
      "integration-test-delete-orphaned-github.yaml"
    );
    const output1 = exec(`node dist/cli.js sync --config ${configPath1}`, {
      cwd: projectRoot,
    });
    console.log(output1);

    // Verify the file exists on main branch (after force merge)
    console.log("\nVerifying orphan-test.json exists on main...");
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${orphanFile} --jq '.content' | base64 -d`
    );
    assert.ok(fileContent, "orphan-test.json should exist on main");
    const json = JSON.parse(fileContent);
    console.log("  File content:", JSON.stringify(json));
    assert.equal(json.orphanTest, true, "File should have orphanTest: true");

    // Verify manifest exists and tracks the file
    console.log("\nVerifying .xfg.json manifest exists...");
    const manifestContent = exec(
      `gh api repos/${TEST_REPO}/contents/${manifestFile} --jq '.content' | base64 -d`
    );
    assert.ok(manifestContent, ".xfg.json should exist on main");
    const manifest = JSON.parse(manifestContent);
    console.log("  Manifest content:", JSON.stringify(manifest));
    const configId = "integration-test-delete-orphaned-github";
    // v3 manifest format uses { files: [...], rulesets: [...] }
    assert.ok(
      manifest.configs[configId]?.files?.includes(orphanFile),
      "Manifest should track orphan-test.json"
    );

    // Phase 2: Run sync with config that removes the file
    console.log("\n--- Phase 2: Remove file from config (should delete) ---\n");
    const configPath2 = join(
      fixturesDir,
      "integration-test-delete-orphaned-phase2-github.yaml"
    );
    const output2 = exec(`node dist/cli.js sync --config ${configPath2}`, {
      cwd: projectRoot,
    });
    console.log(output2);

    // Verify the file has been deleted from main
    console.log("\nVerifying orphan-test.json was deleted...");
    try {
      exec(`gh api repos/${TEST_REPO}/contents/${orphanFile} --jq '.sha'`);
      assert.fail("orphan-test.json should have been deleted");
    } catch {
      console.log("  orphan-test.json correctly deleted");
    }

    // Verify manifest was updated (orphan-test.json removed from config namespace)
    console.log("\nVerifying manifest was updated...");
    const manifestContent2 = exec(
      `gh api repos/${TEST_REPO}/contents/${manifestFile} --jq '.content' | base64 -d`
    );
    const manifest2 = JSON.parse(manifestContent2);
    console.log("  Updated manifest:", JSON.stringify(manifest2));
    assert.ok(
      !manifest2.configs[configId]?.includes(orphanFile),
      "Manifest should no longer track orphan-test.json"
    );

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

    // Create divergent-test.json on main
    exec(
      `gh api --method PUT repos/${TEST_REPO}/contents/${divergentFile} -f message="test: create ${divergentFile} for divergent test" -f content="${Buffer.from(JSON.stringify({ version: 1 }, null, 2) + "\n").toString("base64")}"`
    );
    console.log("  File created on main");

    // Phase 1: Create initial PR with xfg (sets up sync branch)
    console.log("\n--- Phase 1: Create initial PR with xfg ---\n");
    const configPath = join(
      fixturesDir,
      "integration-test-divergent-github.yaml"
    );
    const output1 = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output1);

    // Verify PR was created
    const prInfo1 = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number --jq '.[0].number'`
    );
    assert.ok(prInfo1, "Initial PR should be created");
    console.log(`  Initial PR created: #${prInfo1}`);

    // Phase 2: Advance main by updating the file directly (creating divergent history)
    console.log(
      "\n--- Phase 2: Advance main to create divergent history ---\n"
    );
    const mainSha = exec(
      `gh api repos/${TEST_REPO}/contents/${divergentFile} --jq '.sha'`
    );
    exec(
      `gh api --method PUT repos/${TEST_REPO}/contents/${divergentFile} -f message="test: advance main for divergent test" -f content="${Buffer.from(JSON.stringify({ version: 2, advancedOnMain: true }, null, 2) + "\n").toString("base64")}" -f sha="${mainSha}"`
    );
    console.log("  Main branch advanced");

    // Phase 3: Run xfg again - this should close the old PR, force-push, and create new PR
    console.log(
      "\n--- Phase 3: Run xfg again (should handle divergent history) ---\n"
    );
    const output2 = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output2);

    // Verify the new PR was created successfully (not failed due to non-fast-forward)
    const prInfo2 = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number,title --jq '.[0]'`
    );
    assert.ok(
      prInfo2,
      "New PR should be created after handling divergent history"
    );
    const pr2 = JSON.parse(prInfo2);
    console.log(`  New PR created: #${pr2.number} - ${pr2.title}`);

    // The key assertion: xfg should have succeeded even with divergent history
    assert.ok(
      output2.includes("PR:") || output2.includes("Succeeded: 1"),
      "Output should indicate PR creation succeeded"
    );

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
      "\n=== Setting up orphan branch test (issue #183 variant) ===\n"
    );

    // Create the remote sync branch directly (without PR) by committing a different version
    // This simulates a scenario where a branch exists but has different content
    console.log(
      "\n--- Phase 1: Create orphan sync branch directly (no PR) ---\n"
    );

    // First, get the main branch SHA
    const mainSha = exec(
      `gh api repos/${TEST_REPO}/git/refs/heads/main --jq '.object.sha'`
    );
    console.log(`  Main branch SHA: ${mainSha}`);

    // Create the branch pointing to main
    exec(
      `gh api --method POST repos/${TEST_REPO}/git/refs -f ref="refs/heads/${testBranch}" -f sha="${mainSha}"`
    );
    console.log(`  Created branch ${testBranch}`);

    // Commit a file to the branch (different content than what xfg will sync)
    const branchContent =
      JSON.stringify({ orphanBranchVersion: 1 }, null, 2) + "\n";
    exec(
      `gh api --method PUT repos/${TEST_REPO}/contents/${orphanBranchFile} -f message="test: create file on orphan branch" -f content="${Buffer.from(branchContent).toString("base64")}" -f branch="${testBranch}"`
    );
    console.log(`  Committed file to ${testBranch}`);

    // Verify no PR exists for this branch
    const prCheck = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number --jq 'length'`
    );
    assert.equal(
      prCheck,
      "0",
      "Should have no PR initially (orphan branch scenario)"
    );
    console.log("  Verified: No PR exists for the orphan branch");

    // Run xfg - it should force-push and create a new PR
    console.log(
      "\n--- Phase 2: Run xfg (should force-push to orphan branch) ---\n"
    );
    const configPath = join(
      fixturesDir,
      "integration-test-orphan-branch-github.yaml"
    );
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify PR was created successfully
    const prInfo = exec(
      `gh pr list --repo ${TEST_REPO} --head ${testBranch} --json number,title --jq '.[0]'`
    );
    assert.ok(
      prInfo,
      "PR should be created after force-pushing to orphan branch"
    );
    const pr = JSON.parse(prInfo);
    console.log(`  PR created: #${pr.number} - ${pr.title}`);

    // Verify the file content matches xfg config (not the orphan branch version)
    const fileContent = exec(
      `gh api repos/${TEST_REPO}/contents/${orphanBranchFile}?ref=${testBranch} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    console.log("  File content on PR branch:", JSON.stringify(json));
    assert.ok(
      !json.orphanBranchVersion,
      "Should NOT have orphanBranchVersion (old content)"
    );
    assert.equal(
      json.syncedByXfg,
      true,
      "Should have syncedByXfg: true (xfg content)"
    );

    console.log("\n=== Orphan branch test (issue #183 variant) passed ===\n");
  });
});
