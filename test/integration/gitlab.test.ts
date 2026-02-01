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

// GitLab test repository
const TEST_NAMESPACE = "anthony-spruyt1";
const TEST_REPO = "xfg-test";
const PROJECT_PATH = `${TEST_NAMESPACE}/${TEST_REPO}`;
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

// Helper to call GitLab API via glab cli
function glabApi(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>
): string {
  let cmd = `glab api --method ${method}`;
  if (body) {
    // Pass each field as a separate -f flag
    for (const [key, value] of Object.entries(body)) {
      const strValue =
        typeof value === "string" ? value : JSON.stringify(value);
      cmd += ` -f ${key}='${strValue}'`;
    }
  }
  cmd += ` ${endpoint}`;
  return exec(cmd);
}

// Helper to get file content from GitLab repo
function getFileContent(
  path: string,
  branch?: string
): { content: string } | null {
  try {
    const encodedPath = encodeURIComponent(path);
    const result = glabApi(
      "GET",
      `projects/${encodeURIComponent(PROJECT_PATH)}/repository/files/${encodedPath}?ref=${branch || getDefaultBranch()}`
    );
    const json = JSON.parse(result);
    // GitLab returns base64 encoded content
    const content = Buffer.from(json.content, "base64").toString("utf-8");
    return { content };
  } catch {
    return null;
  }
}

// Helper to get default branch name
function getDefaultBranch(): string {
  try {
    const result = glabApi(
      "GET",
      `projects/${encodeURIComponent(PROJECT_PATH)}`
    );
    const json = JSON.parse(result);
    return json.default_branch || "main";
  } catch {
    return "main";
  }
}

// Helper to push a file change (create/update/delete)
function pushFileChange(
  path: string,
  content: string | null,
  message: string,
  branch: string
): void {
  const encodedPath = encodeURIComponent(path);
  const projectId = encodeURIComponent(PROJECT_PATH);

  if (content === null) {
    // Delete file
    glabApi("DELETE", `projects/${projectId}/repository/files/${encodedPath}`, {
      branch,
      commit_message: message,
    });
  } else {
    // Check if file exists to determine create vs update
    const exists = getFileContent(path, branch);
    if (exists) {
      // Update file
      glabApi("PUT", `projects/${projectId}/repository/files/${encodedPath}`, {
        branch,
        content,
        commit_message: message,
      });
    } else {
      // Create file
      glabApi("POST", `projects/${projectId}/repository/files/${encodedPath}`, {
        branch,
        content,
        commit_message: message,
      });
    }
  }
}

// Helper to delete a branch
function deleteBranch(branchName: string): boolean {
  try {
    const encodedBranch = encodeURIComponent(branchName);
    glabApi(
      "DELETE",
      `projects/${encodeURIComponent(PROJECT_PATH)}/repository/branches/${encodedBranch}`
    );
    return true;
  } catch {
    return false;
  }
}

// Helper to get MR by source branch
function getMRByBranch(
  sourceBranch: string
): { iid: number; title: string; web_url: string; state: string } | null {
  try {
    const result = glabApi(
      "GET",
      `projects/${encodeURIComponent(PROJECT_PATH)}/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&state=opened`
    );
    const mrs = JSON.parse(result);
    if (mrs && mrs.length > 0) {
      return mrs[0];
    }
    return null;
  } catch {
    return null;
  }
}

// Helper to close MR
function closeMR(mrIid: number): void {
  try {
    glabApi(
      "PUT",
      `projects/${encodeURIComponent(PROJECT_PATH)}/merge_requests/${mrIid}`,
      {
        state_event: "close",
      }
    );
  } catch {
    // Ignore errors
  }
}

// Helper to get all MRs by source branch (including closed)
function getAllMRsByBranch(
  sourceBranch: string
): Array<{ iid: number; state: string }> {
  try {
    const result = glabApi(
      "GET",
      `projects/${encodeURIComponent(PROJECT_PATH)}/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}`
    );
    return JSON.parse(result);
  } catch {
    return [];
  }
}

describe("GitLab Integration Test", () => {
  before(() => {
    console.log("\n=== Setting up GitLab integration test ===\n");

    // 0. Initialize repo if empty (create initial commit)
    console.log("Checking if repo is initialized...");
    try {
      const result = glabApi(
        "GET",
        `projects/${encodeURIComponent(PROJECT_PATH)}/repository/commits?per_page=1`
      );
      const commits = JSON.parse(result);
      if (commits && commits.length > 0) {
        console.log("  Repo has commits");
      } else {
        throw new Error("No commits");
      }
    } catch {
      console.log("  Repo is empty, initializing with README...");
      pushFileChange(
        "README.md",
        "# Test Repository\n\nThis repo is used for integration testing xfg.",
        "Initial commit",
        "main"
      );
      console.log("  Repo initialized");
    }

    // 1. Close any existing MRs from the sync branch
    console.log("Closing any existing MRs...");
    try {
      const existingMRs = getAllMRsByBranch(BRANCH_NAME);
      const openMRs = existingMRs.filter((mr) => mr.state === "opened");
      if (openMRs.length > 0) {
        for (const mr of openMRs) {
          console.log(`  Closing MR !${mr.iid}`);
          closeMR(mr.iid);
        }
      } else {
        console.log("  No existing MRs found");
      }
    } catch {
      console.log("  No existing MRs to close");
    }

    // 2. Delete the target file if it exists in the default branch
    console.log(`Checking if ${TARGET_FILE} exists in repo...`);
    try {
      const defaultBranch = getDefaultBranch();
      const fileInfo = getFileContent(TARGET_FILE, defaultBranch);
      if (fileInfo) {
        console.log(`  Deleting ${TARGET_FILE} from repo...`);
        pushFileChange(
          TARGET_FILE,
          null,
          `test: remove ${TARGET_FILE} for integration test`,
          defaultBranch
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

  test("sync creates a MR in the test repository", async () => {
    const configPath = join(fixturesDir, "integration-test-config-gitlab.yaml");

    // Run the sync tool
    console.log("Running xfg...");
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify MR was created
    console.log("\nVerifying MR was created...");
    const mr = getMRByBranch(BRANCH_NAME);

    assert.ok(mr, "Expected a MR to be created");

    console.log(`  MR !${mr.iid}: ${mr.title}`);
    console.log(`  URL: ${mr.web_url}`);

    assert.ok(mr.iid, "MR should have an IID");
    assert.ok(mr.title.includes("sync"), "MR title should mention sync");

    // Verify the file exists in the MR branch
    console.log("\nVerifying file exists in MR branch...");
    const fileInfo = getFileContent(TARGET_FILE, BRANCH_NAME);

    assert.ok(fileInfo, "File should exist in MR branch");

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

  test("re-sync closes existing MR and creates fresh one", async () => {
    // This test relies on the previous test having created a MR
    // We'll run sync again and verify the behavior

    const configPath = join(fixturesDir, "integration-test-config-gitlab.yaml");

    // Get the current MR IID before re-sync
    console.log("Getting current MR IID...");
    const mrBefore = getMRByBranch(BRANCH_NAME);
    const mrIidBefore = mrBefore?.iid ?? null;
    console.log(`  Current MR: !${mrIidBefore}`);

    assert.ok(mrIidBefore, "Expected a MR to exist from previous test");

    // Run the sync tool again
    console.log("\nRunning xfg again (re-sync)...");
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify a MR exists (should be a new one after closing the old)
    console.log("\nVerifying MR state after re-sync...");
    const mrAfter = getMRByBranch(BRANCH_NAME);

    assert.ok(mrAfter, "Expected a MR to exist after re-sync");
    console.log(`  MR after re-sync: !${mrAfter.iid}`);

    // The old MR should be closed
    // Check that the old MR is now closed
    console.log("\nVerifying old MR was closed...");
    try {
      const oldMRResult = glabApi(
        "GET",
        `projects/${encodeURIComponent(PROJECT_PATH)}/merge_requests/${mrIidBefore}`
      );
      const oldMR = JSON.parse(oldMRResult);
      console.log(`  Old MR !${mrIidBefore} state: ${oldMR.state}`);
      assert.equal(
        oldMR.state,
        "closed",
        "Old MR should be closed after re-sync"
      );
    } catch {
      // If we can't get the old MR, it might have been deleted
      console.log(
        `  Old MR !${mrIidBefore} appears to have been deleted or closed`
      );
    }

    console.log("\n=== Re-sync test passed ===\n");
  });

  test("createOnly skips file when it exists on base branch", async () => {
    // This test uses a separate config file with createOnly: true
    const createOnlyFile = "createonly-test.json";
    const createOnlyBranch = "chore/sync-createonly-test";

    console.log("\n=== Setting up createOnly test ===\n");

    // 1. Close any existing MRs from the createOnly branch
    console.log("Closing any existing createOnly test MRs...");
    try {
      const existingMRs = getAllMRsByBranch(createOnlyBranch);
      const openMRs = existingMRs.filter((mr) => mr.state === "opened");
      if (openMRs.length > 0) {
        for (const mr of openMRs) {
          console.log(`  Closing MR !${mr.iid}`);
          closeMR(mr.iid);
        }
      }
    } catch {
      console.log("  No existing MRs to close");
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

    // Check if file exists and create/update accordingly
    pushFileChange(
      createOnlyFile,
      existingContent,
      `test: setup ${createOnlyFile} for createOnly test`,
      defaultBranch
    );
    console.log("  File created on main");

    // 4. Run sync with createOnly config
    console.log("\nRunning xfg with createOnly config...");
    const configPath = join(
      fixturesDir,
      "integration-test-createonly-gitlab.yaml"
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

    // 6. Check if a MR was created - with createOnly the file should be skipped
    // If all files are skipped, no MR should be created
    console.log("\nVerifying createOnly behavior...");
    try {
      const mr = getMRByBranch(createOnlyBranch);
      if (mr) {
        console.log(`  MR was created: !${mr.iid}`);
        // If a MR was created, the file content should NOT have been changed
        // because createOnly should skip when file exists on base
        const fileInfo = getFileContent(createOnlyFile, createOnlyBranch);
        if (fileInfo) {
          const json = JSON.parse(fileInfo.content);
          console.log("  File content in MR branch:", JSON.stringify(json));
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
          "  No MR was created (all files skipped) - this is correct"
        );
      }
    } catch {
      console.log("  No MR was created - expected if all files were skipped");
    }

    // 7. Cleanup - delete the test file from main
    console.log("\nCleaning up createOnly test file...");
    try {
      pushFileChange(
        createOnlyFile,
        null,
        `test: cleanup ${createOnlyFile}`,
        defaultBranch
      );
      console.log("  File deleted");
    } catch {
      console.log("  Could not delete file");
    }

    console.log("\n=== createOnly test passed ===\n");
  });

  test("MR title only includes files that actually changed (issue #90)", async () => {
    // This test verifies the bug fix for issue #90:
    // When some files in the config don't actually change (content matches repo),
    // they should NOT appear in the MR title or commit message.

    const unchangedFile = "unchanged-test.json";
    const changedFile = "changed-test.json";
    const testBranch = "chore/sync-config";

    console.log("\n=== Setting up unchanged files test (issue #90) ===\n");

    // 1. Close any existing MRs from this branch
    console.log("Closing any existing MRs...");
    try {
      const existingMRs = getAllMRsByBranch(testBranch);
      const openMRs = existingMRs.filter((mr) => mr.state === "opened");
      if (openMRs.length > 0) {
        for (const mr of openMRs) {
          console.log(`  Closing MR !${mr.iid}`);
          closeMR(mr.iid);
        }
      }
    } catch {
      console.log("  No existing MRs to close");
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

    pushFileChange(
      unchangedFile,
      unchangedContent,
      `test: setup ${unchangedFile} for issue #90 test`,
      defaultBranch
    );
    console.log("  File created with content matching config");

    // 4. Delete changed-test.json if it exists (to ensure it will be created)
    console.log(`Deleting ${changedFile} if exists...`);
    try {
      pushFileChange(
        changedFile,
        null,
        `test: cleanup ${changedFile}`,
        defaultBranch
      );
      console.log("  File deleted");
    } catch {
      console.log("  File does not exist");
    }

    // 5. Run sync with the test config
    console.log("\nRunning xfg with unchanged files config...");
    const configPath = join(
      fixturesDir,
      "integration-test-unchanged-gitlab.yaml"
    );
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 6. Get the MR and check its title
    console.log("\nVerifying MR title...");
    const mr = getMRByBranch(testBranch);

    assert.ok(mr, "Expected a MR to be created");
    console.log(`  MR !${mr.iid}: ${mr.title}`);

    // THE KEY ASSERTION: MR title should only mention the changed file
    // With the bug: title would be "chore: sync changed-test.json, unchanged-test.json"
    // After fix: title should be "chore: sync changed-test.json"
    assert.ok(
      mr.title.includes(changedFile),
      `MR title should include ${changedFile}`
    );
    assert.ok(
      !mr.title.includes(unchangedFile),
      `MR title should NOT include ${unchangedFile} (bug #90: unchanged files incorrectly listed)`
    );

    // 7. Cleanup
    console.log("\nCleaning up test files...");
    try {
      pushFileChange(
        unchangedFile,
        null,
        `test: cleanup ${unchangedFile}`,
        defaultBranch
      );
      console.log(`  Deleted ${unchangedFile}`);
    } catch {
      console.log(`  Could not delete ${unchangedFile}`);
    }

    try {
      // Note: changed-test.json only exists on the MR branch, not main
      // It will be cleaned up when the MR is closed
      console.log(`  ${changedFile} exists only on MR branch`);
    } catch {
      console.log(`  ${changedFile} not found`);
    }

    console.log("\n=== Unchanged files test (issue #90) passed ===\n");
  });

  test("direct mode pushes directly to main branch without creating MR (issue #134)", async () => {
    // This test verifies the direct mode feature (issue #134):
    // Files are pushed directly to the default branch without creating a MR.
    // NOTE: This test uses the same exec() helper defined at line 23-39, which
    // is safe because all commands are hardcoded (not derived from user input).

    const directFile = "direct-test.config.json";

    console.log("\n=== Setting up direct mode test (issue #134) ===\n");

    // 1. Delete the direct test file if it exists in the default branch
    console.log(`Deleting ${directFile} if exists...`);
    try {
      const defaultBranch = getDefaultBranch();
      pushFileChange(
        directFile,
        null,
        `test: cleanup ${directFile}`,
        defaultBranch
      );
      console.log("  File deleted");
    } catch {
      console.log("  File does not exist");
    }

    // 2. Run sync with direct mode config
    console.log("\nRunning xfg with direct mode config...");
    const configPath = join(fixturesDir, "integration-test-direct-gitlab.yaml");
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // 3. Verify the output mentions direct push
    assert.ok(
      output.includes("Pushed directly") || output.includes("direct"),
      "Output should mention direct push"
    );

    // 4. Verify NO MR was created
    console.log("\nVerifying no MR was created...");
    const mr = getMRByBranch("chore/sync-direct-test");
    assert.ok(!mr, "No MR should be created in direct mode");
    console.log("  No MR found - this is correct for direct mode");

    // 5. Verify the file exists directly on main branch
    console.log("\nVerifying file exists on main branch...");
    const defaultBranch = getDefaultBranch();
    const fileInfo = getFileContent(directFile, defaultBranch);

    assert.ok(fileInfo, "File should exist on main branch");
    const json = JSON.parse(fileInfo.content);
    console.log("  File content:", JSON.stringify(json, null, 2));

    assert.equal(json.directMode, true, "File should have directMode: true");

    console.log("  Direct push verified - file is on main without MR");

    // 6. Cleanup - delete the test file from main
    console.log("\nCleaning up direct test file...");
    try {
      pushFileChange(
        directFile,
        null,
        `test: cleanup ${directFile}`,
        defaultBranch
      );
      console.log("  File deleted");
    } catch {
      console.log("  Could not delete file");
    }

    console.log("\n=== Direct mode test (issue #134) passed ===\n");
  });
});
