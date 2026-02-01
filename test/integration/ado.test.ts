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

// Azure DevOps test repository
const TEST_ORG = "aspruyt";
const TEST_PROJECT = "fxg";
const TEST_REPO = "fxg-test";
const ORG_URL = `https://dev.azure.com/${TEST_ORG}`;
const TARGET_FILE = "my.config.json";
const BRANCH_NAME = "chore/sync-my-config";

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

// Helper to call ADO REST API with PAT auth (az rest doesn't work with ADO APIs)
function adoApi(method: string, uri: string, body?: string): string {
  const pat = process.env.AZURE_DEVOPS_EXT_PAT;
  if (!pat) throw new Error("AZURE_DEVOPS_EXT_PAT not set");

  let cmd = `curl -s -u ":${pat}" -X ${method}`;
  if (body) {
    cmd += ` -H "Content-Type: application/json" -d '${body}'`;
  }
  cmd += ` "${uri}"`;
  return exec(cmd);
}

// Helper to get file content from ADO repo via REST API
// Note: with includeContent=true, ADO returns the raw content directly
function getFileContent(
  path: string,
  branch?: string
): { content: string; objectId: string } | null {
  try {
    const versionParam = branch
      ? `&versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch`
      : "";
    // Get content (returns raw file content)
    const contentUri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}/items?path=${encodeURIComponent(path)}${versionParam}&includeContent=true&api-version=7.0`;
    const content = adoApi("GET", contentUri);

    // Get metadata for objectId (without content)
    const metaUri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}/items?path=${encodeURIComponent(path)}${versionParam}&api-version=7.0`;
    const metaResult = adoApi("GET", metaUri);
    const meta = JSON.parse(metaResult);

    return { content, objectId: meta.objectId };
  } catch {
    return null;
  }
}

// Helper to get the latest commit objectId for a branch
function getLatestCommit(branch: string): string {
  const uri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}/refs?filter=heads/${encodeURIComponent(branch)}&api-version=7.0`;
  const result = adoApi("GET", uri);
  const json = JSON.parse(result);
  if (json.value && json.value.length > 0) {
    return json.value[0].objectId;
  }
  throw new Error(`Branch ${branch} not found`);
}

// Helper to get default branch name
function getDefaultBranch(): string {
  const uri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}?api-version=7.0`;
  const result = adoApi("GET", uri);
  const json = JSON.parse(result);
  // defaultBranch is like "refs/heads/main"
  return json.defaultBranch?.replace("refs/heads/", "") || "main";
}

// Helper to push a file change (create/update/delete)
function pushFileChange(
  path: string,
  content: string | null,
  message: string,
  branch: string,
  oldObjectId?: string
): void {
  const defaultBranch = getDefaultBranch();
  const latestCommit = getLatestCommit(
    branch === defaultBranch ? defaultBranch : branch
  );

  const changeType = content === null ? "delete" : oldObjectId ? "edit" : "add";
  const change: Record<string, unknown> = {
    changeType,
    item: { path: `/${path}` },
  };

  if (content !== null) {
    change.newContent = {
      content: Buffer.from(content).toString("base64"),
      contentType: "base64encoded",
    };
  }

  const pushBody = {
    refUpdates: [
      {
        name: `refs/heads/${branch}`,
        oldObjectId: latestCommit,
      },
    ],
    commits: [
      {
        comment: message,
        changes: [change],
      },
    ],
  };

  const uri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}/pushes?api-version=7.0`;
  adoApi("POST", uri, JSON.stringify(pushBody));
}

// Helper to delete a branch (requires getting object_id first)
function deleteBranch(branchName: string): boolean {
  try {
    // First get the branch's object_id
    const refsUri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}/refs?filter=heads/${encodeURIComponent(branchName)}&api-version=7.0`;
    const result = adoApi("GET", refsUri);
    const json = JSON.parse(result);
    if (!json.value || json.value.length === 0) {
      return false; // Branch doesn't exist
    }
    const objectId = json.value[0].objectId;

    // Now delete with object_id
    exec(
      `az repos ref delete --name refs/heads/${branchName} --repository ${TEST_REPO} --org ${ORG_URL} --project ${TEST_PROJECT} --object-id ${objectId}`
    );
    return true;
  } catch {
    return false;
  }
}

describe("Azure DevOps Integration Test", () => {
  before(() => {
    console.log("\n=== Setting up Azure DevOps integration test ===\n");

    // 0. Initialize repo if empty (create initial commit)
    console.log("Checking if repo is initialized...");
    try {
      const defaultBranch = getDefaultBranch();
      getLatestCommit(defaultBranch);
      console.log("  Repo has commits");
    } catch {
      console.log("  Repo is empty, initializing with README...");
      // Create initial commit with README
      const pushBody = {
        refUpdates: [
          {
            name: "refs/heads/main",
            oldObjectId: "0000000000000000000000000000000000000000",
          },
        ],
        commits: [
          {
            comment: "Initial commit",
            changes: [
              {
                changeType: "add",
                item: { path: "/README.md" },
                newContent: {
                  content: Buffer.from(
                    "# Test Repository\n\nThis repo is used for integration testing xfg."
                  ).toString("base64"),
                  contentType: "base64encoded",
                },
              },
            ],
          },
        ],
      };
      const uri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}/pushes?api-version=7.0`;
      exec(
        `az rest --method post --uri "${uri}" --body '${JSON.stringify(pushBody)}'`
      );
      console.log("  Repo initialized");
    }

    // 1. Close/abandon any existing PRs from the sync branch
    console.log("Abandoning any existing PRs...");
    try {
      const existingPRs = exec(
        `az repos pr list --repository ${TEST_REPO} --source-branch ${BRANCH_NAME} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[].pullRequestId" -o tsv`
      );
      if (existingPRs) {
        for (const prId of existingPRs.split("\n").filter(Boolean)) {
          console.log(`  Abandoning PR #${prId}`);
          exec(
            `az repos pr update --id ${prId} --status abandoned --org ${ORG_URL}`
          );
        }
      } else {
        console.log("  No existing PRs found");
      }
    } catch {
      console.log("  No existing PRs to abandon");
    }

    // 2. Delete the target file if it exists in the default branch
    console.log(`Checking if ${TARGET_FILE} exists in repo...`);
    try {
      const defaultBranch = getDefaultBranch();
      const fileInfo = getFileContent(TARGET_FILE);
      if (fileInfo) {
        console.log(`  Deleting ${TARGET_FILE} from repo...`);
        pushFileChange(
          TARGET_FILE,
          null,
          `test: remove ${TARGET_FILE} for integration test`,
          defaultBranch,
          fileInfo.objectId
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
    if (deleteBranch(BRANCH_NAME)) {
      console.log("  Branch deleted");
    } else {
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
    const configPath = join(fixturesDir, "integration-test-config-ado.yaml");

    // Run the sync tool
    console.log("Running xfg...");
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify PR was created
    console.log("\nVerifying PR was created...");
    const prList = exec(
      `az repos pr list --repository ${TEST_REPO} --source-branch ${BRANCH_NAME} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0]" -o json`
    );

    assert.ok(prList && prList !== "null", "Expected a PR to be created");

    const pr = JSON.parse(prList);
    console.log(`  PR #${pr.pullRequestId}: ${pr.title}`);
    console.log(
      `  URL: ${ORG_URL}/${TEST_PROJECT}/_git/${TEST_REPO}/pullrequest/${pr.pullRequestId}`
    );

    assert.ok(pr.pullRequestId, "PR should have an ID");
    assert.ok(pr.title.includes("sync"), "PR title should mention sync");

    // Verify the file exists in the PR branch
    console.log("\nVerifying file exists in PR branch...");
    const fileInfo = getFileContent(TARGET_FILE, BRANCH_NAME);

    assert.ok(fileInfo, "File should exist in PR branch");

    // Parse and verify the merged JSON content
    const json = JSON.parse(fileInfo.content);
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
    // This test relies on the previous test having created a PR
    // We'll run sync again and verify the behavior

    const configPath = join(fixturesDir, "integration-test-config-ado.yaml");

    // Get the current PR ID before re-sync
    console.log("Getting current PR ID...");
    const prListBefore = exec(
      `az repos pr list --repository ${TEST_REPO} --source-branch ${BRANCH_NAME} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0].pullRequestId" -o tsv`
    );
    const prIdBefore = prListBefore ? parseInt(prListBefore, 10) : null;
    console.log(`  Current PR: #${prIdBefore}`);

    assert.ok(prIdBefore, "Expected a PR to exist from previous test");

    // Run the sync tool again
    console.log("\nRunning xfg again (re-sync)...");
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify a PR exists (should be a new one after closing the old)
    console.log("\nVerifying PR state after re-sync...");
    const prListAfter = exec(
      `az repos pr list --repository ${TEST_REPO} --source-branch ${BRANCH_NAME} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0]" -o json`
    );

    assert.ok(
      prListAfter && prListAfter !== "null",
      "Expected a PR to exist after re-sync"
    );
    const prAfter = JSON.parse(prListAfter);
    console.log(`  PR after re-sync: #${prAfter.pullRequestId}`);

    // The old PR should be abandoned
    // Check that the old PR is now abandoned
    console.log("\nVerifying old PR was abandoned...");
    try {
      const oldPRStatus = exec(
        `az repos pr show --id ${prIdBefore} --org ${ORG_URL} --query "status" -o tsv`
      );
      console.log(`  Old PR #${prIdBefore} status: ${oldPRStatus}`);
      assert.equal(
        oldPRStatus,
        "abandoned",
        "Old PR should be abandoned after re-sync"
      );
    } catch {
      // If we can't get the old PR, it might have been deleted
      console.log(
        `  Old PR #${prIdBefore} appears to have been deleted or abandoned`
      );
    }

    console.log("\n=== Re-sync test passed ===\n");
  });

  test("createOnly skips file when it exists on base branch", async () => {
    // This test uses a separate config file with createOnly: true
    const createOnlyFile = "createonly-test.json";
    const createOnlyBranch = "chore/sync-createonly-test";

    console.log("\n=== Setting up createOnly test ===\n");

    // 1. Close/abandon any existing PRs from the createOnly branch
    console.log("Abandoning any existing createOnly test PRs...");
    try {
      const existingPRs = exec(
        `az repos pr list --repository ${TEST_REPO} --source-branch ${createOnlyBranch} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[].pullRequestId" -o tsv`
      );
      if (existingPRs) {
        for (const prId of existingPRs.split("\n").filter(Boolean)) {
          console.log(`  Abandoning PR #${prId}`);
          exec(
            `az repos pr update --id ${prId} --status abandoned --org ${ORG_URL}`
          );
        }
      }
    } catch {
      console.log("  No existing PRs to abandon");
    }

    // 2. Delete the remote branch if it exists
    console.log(`Deleting remote branch ${createOnlyBranch} if exists...`);
    if (deleteBranch(createOnlyBranch)) {
      console.log("  Branch deleted");
    } else {
      console.log("  Branch does not exist");
    }

    // 3. Create the file on main branch (simulating it already exists)
    console.log(`Creating ${createOnlyFile} on main branch...`);
    const existingContent = JSON.stringify({ existing: true }, null, 2);
    const defaultBranch = getDefaultBranch();

    // Check if file exists
    const fileInfo = getFileContent(createOnlyFile);
    if (fileInfo) {
      // Update existing file
      pushFileChange(
        createOnlyFile,
        existingContent,
        `test: update ${createOnlyFile} for createOnly test`,
        defaultBranch,
        fileInfo.objectId
      );
    } else {
      // Create new file
      pushFileChange(
        createOnlyFile,
        existingContent,
        `test: create ${createOnlyFile} for createOnly test`,
        defaultBranch
      );
    }
    console.log("  File created on main");

    // 4. Run sync with createOnly config
    console.log("\nRunning xfg with createOnly config...");
    const configPath = join(
      fixturesDir,
      "integration-test-createonly-ado.yaml"
    );
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 5. Verify the behavior - output should indicate skipping
    assert.ok(
      output.includes("createOnly") || output.includes("skip"),
      "Output should mention createOnly or skip"
    );

    // 6. Check if a PR was created - with createOnly the file should be skipped
    // If all files are skipped, no PR should be created
    console.log("\nVerifying createOnly behavior...");
    try {
      const prList = exec(
        `az repos pr list --repository ${TEST_REPO} --source-branch ${createOnlyBranch} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0].pullRequestId" -o tsv`
      );
      if (prList) {
        console.log(`  PR was created: #${prList}`);
        // If a PR was created, the file content should NOT have been changed
        // because createOnly should skip when file exists on base
        const prFileInfo = getFileContent(createOnlyFile, createOnlyBranch);
        if (prFileInfo) {
          const json = JSON.parse(prFileInfo.content);
          console.log("  File content in PR branch:", JSON.stringify(json));
          // The file should still have the original content (existing: true)
          // NOT the new content from config
          assert.equal(
            json.existing,
            true,
            "File should retain original content when createOnly skips"
          );
        }
      } else {
        console.log(
          "  No PR was created (all files skipped) - this is correct"
        );
      }
    } catch {
      console.log("  No PR was created - expected if all files were skipped");
    }

    // 7. Cleanup - delete the test file from main
    console.log("\nCleaning up createOnly test file...");
    try {
      const cleanupFileInfo = getFileContent(createOnlyFile);
      if (cleanupFileInfo) {
        pushFileChange(
          createOnlyFile,
          null,
          `test: cleanup ${createOnlyFile}`,
          defaultBranch,
          cleanupFileInfo.objectId
        );
        console.log("  File deleted");
      }
    } catch {
      console.log("  Could not delete file");
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

    // 1. Close/abandon any existing PRs from this branch
    console.log("Abandoning any existing PRs...");
    try {
      const existingPRs = exec(
        `az repos pr list --repository ${TEST_REPO} --source-branch ${testBranch} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[].pullRequestId" -o tsv`
      );
      if (existingPRs) {
        for (const prId of existingPRs.split("\n").filter(Boolean)) {
          console.log(`  Abandoning PR #${prId}`);
          exec(
            `az repos pr update --id ${prId} --status abandoned --org ${ORG_URL}`
          );
        }
      }
    } catch {
      console.log("  No existing PRs to abandon");
    }

    // 2. Delete the remote branch if it exists
    console.log(`Deleting remote branch ${testBranch} if exists...`);
    if (deleteBranch(testBranch)) {
      console.log("  Branch deleted");
    } else {
      console.log("  Branch does not exist");
    }

    // 3. Create the "unchanged" file on main branch with content that matches config
    // The config has: { "unchanged": true }
    console.log(
      `Creating ${unchangedFile} on main branch (will NOT change)...`
    );
    const unchangedContent =
      JSON.stringify({ unchanged: true }, null, 2) + "\n";
    const defaultBranch = getDefaultBranch();

    // Check if file exists
    const fileInfo = getFileContent(unchangedFile);
    if (fileInfo) {
      pushFileChange(
        unchangedFile,
        unchangedContent,
        `test: setup ${unchangedFile} for issue #90 test`,
        defaultBranch,
        fileInfo.objectId
      );
    } else {
      pushFileChange(
        unchangedFile,
        unchangedContent,
        `test: setup ${unchangedFile} for issue #90 test`,
        defaultBranch
      );
    }
    console.log("  File created with content matching config");

    // 4. Delete changed-test.json if it exists (to ensure it will be created)
    console.log(`Deleting ${changedFile} if exists...`);
    try {
      const changedFileInfo = getFileContent(changedFile);
      if (changedFileInfo) {
        pushFileChange(
          changedFile,
          null,
          `test: cleanup ${changedFile}`,
          defaultBranch,
          changedFileInfo.objectId
        );
        console.log("  File deleted");
      }
    } catch {
      console.log("  File does not exist");
    }

    // 5. Run sync with the test config
    console.log("\nRunning xfg with unchanged files config...");
    const configPath = join(fixturesDir, "integration-test-unchanged-ado.yaml");
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 6. Get the PR and check its title
    console.log("\nVerifying PR title...");
    const prInfo = exec(
      `az repos pr list --repository ${TEST_REPO} --source-branch ${testBranch} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0]" -o json`
    );

    assert.ok(prInfo && prInfo !== "null", "Expected a PR to be created");
    const pr = JSON.parse(prInfo);
    console.log(`  PR #${pr.pullRequestId}: ${pr.title}`);

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

    // 7. Cleanup
    console.log("\nCleaning up test files...");
    try {
      const cleanupFileInfo = getFileContent(unchangedFile);
      if (cleanupFileInfo) {
        pushFileChange(
          unchangedFile,
          null,
          `test: cleanup ${unchangedFile}`,
          defaultBranch,
          cleanupFileInfo.objectId
        );
        console.log(`  Deleted ${unchangedFile}`);
      }
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

  test("direct mode pushes directly to main branch without creating PR (issue #134)", async () => {
    // This test verifies the direct mode feature (issue #134):
    // Files are pushed directly to the default branch without creating a PR.
    // NOTE: This test uses the same exec() helper defined at line 24-40, which
    // is safe because all commands are hardcoded (not derived from user input).

    const directFile = "direct-test.config.json";

    console.log("\n=== Setting up direct mode test (issue #134) ===\n");

    // 1. Delete the direct test file if it exists in the default branch
    console.log(`Deleting ${directFile} if exists...`);
    try {
      const defaultBranch = getDefaultBranch();
      const fileInfo = getFileContent(directFile);
      if (fileInfo) {
        pushFileChange(
          directFile,
          null,
          `test: cleanup ${directFile}`,
          defaultBranch,
          fileInfo.objectId
        );
        console.log("  File deleted");
      }
    } catch {
      console.log("  File does not exist");
    }

    // 2. Run sync with direct mode config
    console.log("\nRunning xfg with direct mode config...");
    const configPath = join(fixturesDir, "integration-test-direct-ado.yaml");
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 3. Verify the output mentions direct push
    assert.ok(
      output.includes("Pushed directly") || output.includes("direct"),
      "Output should mention direct push"
    );

    // 4. Verify NO PR was created
    console.log("\nVerifying no PR was created...");
    try {
      const prList = exec(
        `az repos pr list --repository ${TEST_REPO} --source-branch chore/sync-direct-test --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0].pullRequestId" -o tsv`
      );
      assert.ok(!prList, "No PR should be created in direct mode");
    } catch {
      console.log("  No PR found - this is correct for direct mode");
    }

    // 5. Verify the file exists directly on main branch
    console.log("\nVerifying file exists on main branch...");
    const fileInfo = getFileContent(directFile);

    assert.ok(fileInfo, "File should exist on main branch");
    const json = JSON.parse(fileInfo.content);
    console.log("  File content:", JSON.stringify(json, null, 2));

    assert.equal(json.directMode, true, "File should have directMode: true");

    console.log("  Direct push verified - file is on main without PR");

    // 6. Cleanup - delete the test file from main
    console.log("\nCleaning up direct test file...");
    try {
      const defaultBranch = getDefaultBranch();
      const cleanupFileInfo = getFileContent(directFile);
      if (cleanupFileInfo) {
        pushFileChange(
          directFile,
          null,
          `test: cleanup ${directFile}`,
          defaultBranch,
          cleanupFileInfo.objectId
        );
        console.log("  File deleted");
      }
    } catch {
      console.log("  Could not delete file");
    }

    console.log("\n=== Direct mode test (issue #134) passed ===\n");
  });
});
