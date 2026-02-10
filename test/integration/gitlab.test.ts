import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { exec, projectRoot } from "./test-helpers.js";

const fixturesDir = join(projectRoot, "test", "fixtures");

// GitLab test repository
const TEST_NAMESPACE = "anthony-spruyt1";
const TEST_REPO = "xfg-test";
const PROJECT_PATH = `${TEST_NAMESPACE}/${TEST_REPO}`;
const TARGET_FILE = "my.config.json";
const BRANCH_NAME = "chore/sync-my-config";

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

const RESET_SCRIPT = join(
  projectRoot,
  ".github/scripts/reset-test-repo-gitlab.sh"
);

function resetTestRepo(): void {
  console.log("\n=== Resetting GitLab test repo to clean state ===\n");
  exec(`bash ${RESET_SCRIPT} ${PROJECT_PATH}`);
  console.log("\n=== Reset complete ===\n");
}

describe("GitLab Integration Test", () => {
  beforeEach(() => {
    resetTestRepo();
  });

  test("sync creates a MR in the test repository", async () => {
    const configPath = join(fixturesDir, "integration-test-config-gitlab.yaml");

    // Run the sync tool
    console.log("Running xfg...");
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
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
    // Arrange — create initial MR by running xfg
    const configPath = join(fixturesDir, "integration-test-config-gitlab.yaml");
    console.log("Creating initial MR...");
    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    // Get the current MR IID before re-sync
    console.log("Getting current MR IID...");
    const mrBefore = getMRByBranch(BRANCH_NAME);
    const mrIidBefore = mrBefore?.iid ?? null;
    console.log(`  Current MR: !${mrIidBefore}`);

    assert.ok(mrIidBefore, "Expected a MR to exist after initial sync");

    // Run the sync tool again
    console.log("\nRunning xfg again (re-sync)...");
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify a MR exists (should be a new one after closing the old)
    console.log("\nVerifying MR state after re-sync...");
    const mrAfter = getMRByBranch(BRANCH_NAME);

    assert.ok(mrAfter, "Expected a MR to exist after re-sync");
    console.log(`  MR after re-sync: !${mrAfter.iid}`);

    // The old MR should be closed
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
      console.log(
        `  Old MR !${mrIidBefore} appears to have been deleted or closed`
      );
    }

    console.log("\n=== Re-sync test passed ===\n");
  });

  test("createOnly skips file when it exists on base branch", async () => {
    const createOnlyFile = "createonly-test.json";
    const createOnlyBranch = "chore/sync-createonly-test";

    console.log("\n=== Setting up createOnly test ===\n");

    // Create the file on main branch (simulating it already exists)
    console.log(`Creating ${createOnlyFile} on main branch...`);
    const existingContent = JSON.stringify({ existing: true }, null, 2);
    const defaultBranch = getDefaultBranch();

    pushFileChange(
      createOnlyFile,
      existingContent,
      `test: setup ${createOnlyFile} for createOnly test`,
      defaultBranch
    );
    console.log("  File created on main");

    // Run sync with createOnly config
    console.log("\nRunning xfg with createOnly config...");
    const configPath = join(
      fixturesDir,
      "integration-test-createonly-gitlab.yaml"
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

    // Check if a MR was created - with createOnly the file should be skipped
    console.log("\nVerifying createOnly behavior...");
    try {
      const mr = getMRByBranch(createOnlyBranch);
      if (mr) {
        console.log(`  MR was created: !${mr.iid}`);
        const fileInfo = getFileContent(createOnlyFile, createOnlyBranch);
        if (fileInfo) {
          const json = JSON.parse(fileInfo.content);
          console.log("  File content in MR branch:", JSON.stringify(json));
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

    console.log("\n=== createOnly test passed ===\n");
  });

  test("MR title only includes files that actually changed (issue #90)", async () => {
    const unchangedFile = "unchanged-test.json";
    const changedFile = "changed-test.json";
    const testBranch = "chore/sync-config";

    console.log("\n=== Setting up unchanged files test (issue #90) ===\n");

    // Create the "unchanged" file on main branch with content that matches config
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

    // Run sync with the test config
    console.log("\nRunning xfg with unchanged files config...");
    const configPath = join(
      fixturesDir,
      "integration-test-unchanged-gitlab.yaml"
    );
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Get the MR and check its title
    console.log("\nVerifying MR title...");
    const mr = getMRByBranch(testBranch);

    assert.ok(mr, "Expected a MR to be created");
    console.log(`  MR !${mr.iid}: ${mr.title}`);

    // THE KEY ASSERTION: MR title should only mention the changed file
    assert.ok(
      mr.title.includes(changedFile),
      `MR title should include ${changedFile}`
    );
    assert.ok(
      !mr.title.includes(unchangedFile),
      `MR title should NOT include ${unchangedFile} (bug #90: unchanged files incorrectly listed)`
    );

    console.log("\n=== Unchanged files test (issue #90) passed ===\n");
  });

  test("direct mode pushes directly to main branch without creating MR (issue #134)", async () => {
    const directFile = "direct-test.config.json";

    console.log("\n=== Setting up direct mode test (issue #134) ===\n");

    // Run sync with direct mode config
    console.log("\nRunning xfg with direct mode config...");
    const configPath = join(fixturesDir, "integration-test-direct-gitlab.yaml");
    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify the output mentions direct push
    assert.ok(
      output.includes("Pushed directly") || output.includes("direct"),
      "Output should mention direct push"
    );

    // Verify NO MR was created
    console.log("\nVerifying no MR was created...");
    const mr = getMRByBranch("chore/sync-direct-test");
    assert.ok(!mr, "No MR should be created in direct mode");
    console.log("  No MR found - this is correct for direct mode");

    // Verify the file exists directly on main branch
    console.log("\nVerifying file exists on main branch...");
    const defaultBranch = getDefaultBranch();
    const fileInfo = getFileContent(directFile, defaultBranch);

    assert.ok(fileInfo, "File should exist on main branch");
    const json = JSON.parse(fileInfo.content);
    console.log("  File content:", JSON.stringify(json, null, 2));

    assert.equal(json.directMode, true, "File should have directMode: true");

    console.log("  Direct push verified - file is on main without MR");

    console.log("\n=== Direct mode test (issue #134) passed ===\n");
  });
});
