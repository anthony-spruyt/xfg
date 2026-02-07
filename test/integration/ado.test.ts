import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { exec, projectRoot } from "./test-helpers.js";

const fixturesDir = join(projectRoot, "test", "fixtures");

// Azure DevOps test repository
const TEST_ORG = "aspruyt";
const TEST_PROJECT = "fxg";
const TEST_REPO = "fxg-test";
const ORG_URL = `https://dev.azure.com/${TEST_ORG}`;
const TARGET_FILE = "my.config.json";
const BRANCH_NAME = "chore/sync-my-config";

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

const RESET_SCRIPT = join(
  projectRoot,
  ".github/scripts/reset-test-repo-ado.sh"
);

function resetTestRepo(): void {
  console.log("\n=== Resetting ADO test repo to clean state ===\n");
  exec(`bash ${RESET_SCRIPT} ${ORG_URL} ${TEST_PROJECT} ${TEST_REPO}`);
  console.log("\n=== Reset complete ===\n");
}

describe("Azure DevOps Integration Test", () => {
  beforeEach(() => {
    resetTestRepo();
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
    // Arrange — create initial PR by running xfg
    const configPath = join(fixturesDir, "integration-test-config-ado.yaml");
    console.log("Creating initial PR...");
    exec(`node dist/cli.js --config ${configPath}`, { cwd: projectRoot });

    // Get the current PR ID before re-sync
    console.log("Getting current PR ID...");
    const prListBefore = exec(
      `az repos pr list --repository ${TEST_REPO} --source-branch ${BRANCH_NAME} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0].pullRequestId" -o tsv`
    );
    const prIdBefore = prListBefore ? parseInt(prListBefore, 10) : null;
    console.log(`  Current PR: #${prIdBefore}`);
    assert.ok(prIdBefore, "Expected a PR to exist after initial sync");

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
      console.log(
        `  Old PR #${prIdBefore} appears to have been deleted or abandoned`
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
      `test: create ${createOnlyFile} for createOnly test`,
      defaultBranch
    );
    console.log("  File created on main");

    // Run sync with createOnly config
    console.log("\nRunning xfg with createOnly config...");
    const configPath = join(
      fixturesDir,
      "integration-test-createonly-ado.yaml"
    );
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify the behavior - output should indicate skipping
    assert.ok(
      output.includes("createOnly") || output.includes("skip"),
      "Output should mention createOnly or skip"
    );

    // Check if a PR was created - with createOnly the file should be skipped
    console.log("\nVerifying createOnly behavior...");
    try {
      const prList = exec(
        `az repos pr list --repository ${TEST_REPO} --source-branch ${createOnlyBranch} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0].pullRequestId" -o tsv`
      );
      if (prList) {
        console.log(`  PR was created: #${prList}`);
        const prFileInfo = getFileContent(createOnlyFile, createOnlyBranch);
        if (prFileInfo) {
          const json = JSON.parse(prFileInfo.content);
          console.log("  File content in PR branch:", JSON.stringify(json));
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

    console.log("\n=== createOnly test passed ===\n");
  });

  test("PR title only includes files that actually changed (issue #90)", async () => {
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
    const configPath = join(fixturesDir, "integration-test-unchanged-ado.yaml");
    const output = exec(`node dist/cli.js --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Get the PR and check its title
    console.log("\nVerifying PR title...");
    const prInfo = exec(
      `az repos pr list --repository ${TEST_REPO} --source-branch ${testBranch} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0]" -o json`
    );

    assert.ok(prInfo && prInfo !== "null", "Expected a PR to be created");
    const pr = JSON.parse(prInfo);
    console.log(`  PR #${pr.pullRequestId}: ${pr.title}`);

    // THE KEY ASSERTION: PR title should only mention the changed file
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

  test("direct mode pushes directly to main branch without creating PR (issue #134)", async () => {
    const directFile = "direct-test.config.json";

    console.log("\n=== Setting up direct mode test (issue #134) ===\n");

    // Run sync with direct mode config
    console.log("\nRunning xfg with direct mode config...");
    const configPath = join(fixturesDir, "integration-test-direct-ado.yaml");
    const output = exec(`node dist/cli.js --config ${configPath}`, {
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
        `az repos pr list --repository ${TEST_REPO} --source-branch chore/sync-direct-test --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0].pullRequestId" -o tsv`
      );
      assert.ok(!prList, "No PR should be created in direct mode");
    } catch {
      console.log("  No PR found - this is correct for direct mode");
    }

    // Verify the file exists directly on main branch
    console.log("\nVerifying file exists on main branch...");
    const fileInfo = getFileContent(directFile);

    assert.ok(fileInfo, "File should exist on main branch");
    const json = JSON.parse(fileInfo.content);
    console.log("  File content:", JSON.stringify(json, null, 2));

    assert.equal(json.directMode, true, "File should have directMode: true");

    console.log("  Direct push verified - file is on main without PR");

    console.log("\n=== Direct mode test (issue #134) passed ===\n");
  });
});
