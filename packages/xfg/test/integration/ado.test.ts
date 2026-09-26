import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import {
  exec,
  execWithRetry,
  isNotFoundError,
  projectRoot,
  repoRoot,
  withTestRetry,
} from "./test-helpers.js";

const fixturesDir = join(projectRoot, "test", "fixtures");

// Azure DevOps test repository
const TEST_ORG = "aspruyt";
const TEST_PROJECT = "fxg";
const TEST_REPO = "fxg-test";
const ORG_URL = `https://dev.azure.com/${TEST_ORG}`;
const TARGET_FILE = "my.config.json";
const BRANCH_NAME = "chore/sync-my-config";

// Helper to call ADO REST API with PAT auth (az rest doesn't work with ADO APIs)
async function adoApi(
  method: string,
  uri: string,
  body?: string
): Promise<string> {
  if (!process.env.AZURE_DEVOPS_EXT_PAT) {
    throw new Error("AZURE_DEVOPS_EXT_PAT not set");
  }

  // Shell expands the PAT so exec's failure log never prints it; -w lets isNotFoundError see 404s
  let cmd = `curl -sS --fail-with-body -w '%{onerror}HTTP %{http_code}' -u ":$AZURE_DEVOPS_EXT_PAT" -X ${method}`;
  if (body) {
    cmd += ` -H "Content-Type: application/json" -d '${body}'`;
  }
  cmd += ` "${uri}"`;
  return await execWithRetry(cmd);
}

// With includeContent=true, ADO returns the raw file content rather than JSON
async function getFileContent(
  path: string,
  branch?: string
): Promise<{ content: string; objectId: string } | null> {
  const versionParam = branch
    ? `&versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch`
    : "";
  const contentUri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}/items?path=${encodeURIComponent(path)}${versionParam}&includeContent=true&api-version=7.0`;
  const metaUri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}/items?path=${encodeURIComponent(path)}${versionParam}&api-version=7.0`;
  try {
    const content = await adoApi("GET", contentUri);
    const meta = JSON.parse(await adoApi("GET", metaUri));
    return { content, objectId: meta.objectId };
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function waitForFileContent(
  path: string,
  branch?: string
): Promise<{ content: string; objectId: string }> {
  const where = branch ?? "default branch";
  return withTestRetry(
    async () => {
      const fileInfo = await getFileContent(path, branch);
      if (!fileInfo) throw new Error(`${path} not visible on ${where} yet`);
      return fileInfo;
    },
    { description: `${path} visible on ${where}` }
  );
}

async function waitForActivePr(
  sourceBranch: string,
  excludeId?: number
): Promise<{ pullRequestId: number; title: string }> {
  return withTestRetry(
    async () => {
      const result = await execWithRetry(
        `az repos pr list --repository ${TEST_REPO} --source-branch ${sourceBranch} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0]" -o json`
      );
      if (!result || result === "null") {
        throw new Error(`No active PR on ${sourceBranch} yet`);
      }
      const pr = JSON.parse(result) as { pullRequestId: number; title: string };
      if (pr.pullRequestId === excludeId) {
        throw new Error(`Active PR on ${sourceBranch} is still #${excludeId}`);
      }
      return pr;
    },
    { description: `active PR on ${sourceBranch}` }
  );
}

// Helper to get the latest commit objectId for a branch
async function getLatestCommit(branch: string): Promise<string> {
  const uri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}/refs?filter=heads/${encodeURIComponent(branch)}&api-version=7.0`;
  const result = await adoApi("GET", uri);
  const json = JSON.parse(result);
  if (json.value && json.value.length > 0) {
    return json.value[0].objectId;
  }
  throw new Error(`Branch ${branch} not found`);
}

// Helper to get default branch name
async function getDefaultBranch(): Promise<string> {
  const uri = `${ORG_URL}/${TEST_PROJECT}/_apis/git/repositories/${TEST_REPO}?api-version=7.0`;
  const result = await adoApi("GET", uri);
  const json = JSON.parse(result);
  // defaultBranch is like "refs/heads/main"
  return json.defaultBranch?.replace("refs/heads/", "") || "main";
}

// Helper to push a file change (create/update/delete)
async function pushFileChange(
  path: string,
  content: string | null,
  message: string,
  branch: string,
  oldObjectId?: string
): Promise<void> {
  const defaultBranch = await getDefaultBranch();
  const latestCommit = await getLatestCommit(
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
  await adoApi("POST", uri, JSON.stringify(pushBody));
}

const RESET_SCRIPT = join(repoRoot, ".github/scripts/reset-test-repo-ado.sh");

async function resetTestRepo(): Promise<void> {
  console.log("\n=== Resetting ADO test repo to clean state ===\n");
  await exec(`bash ${RESET_SCRIPT} ${ORG_URL} ${TEST_PROJECT} ${TEST_REPO}`);
  console.log("\n=== Reset complete ===\n");
}

describe("Azure DevOps Integration Test", () => {
  beforeEach(async () => {
    await resetTestRepo();
  });

  test("sync creates a PR in the test repository", async () => {
    const configPath = join(fixturesDir, "integration-test-config-ado.yaml");

    console.log("Running xfg...");
    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    console.log("\nVerifying PR was created...");
    const pr = await waitForActivePr(BRANCH_NAME);
    console.log(`  PR #${pr.pullRequestId}: ${pr.title}`);
    console.log(
      `  URL: ${ORG_URL}/${TEST_PROJECT}/_git/${TEST_REPO}/pullrequest/${pr.pullRequestId}`
    );

    assert.ok(pr.pullRequestId, "PR should have an ID");
    assert.ok(pr.title.includes("sync"), "PR title should mention sync");

    console.log("\nVerifying file exists in PR branch...");
    const fileInfo = await waitForFileContent(TARGET_FILE, BRANCH_NAME);

    const json = JSON.parse(fileInfo.content);
    console.log("  File content:", JSON.stringify(json, null, 2));

    assert.equal(json.prop1, "main", "Overlay should override base prop1");

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

    assert.equal(
      json.addedByOverlay,
      true,
      "Overlay should add new properties"
    );

    assert.ok(
      json.prop4?.prop5?.length === 2,
      "Nested arrays from base should be preserved"
    );

    console.log("  Merged content verified - base + overlay working correctly");
    console.log("\n=== Integration test passed ===\n");
  });

  test("re-sync closes existing PR and creates fresh one", async () => {
    const configPath = join(fixturesDir, "integration-test-config-ado.yaml");
    console.log("Creating initial PR...");
    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    console.log("Getting current PR ID...");
    const prIdBefore = (await waitForActivePr(BRANCH_NAME)).pullRequestId;
    console.log(`  Current PR: #${prIdBefore}`);
    assert.ok(prIdBefore, "Expected a PR to exist after initial sync");

    console.log("\nRunning xfg again (re-sync)...");
    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    console.log("\nVerifying PR state after re-sync...");
    const prAfter = await waitForActivePr(BRANCH_NAME, prIdBefore);
    console.log(`  PR after re-sync: #${prAfter.pullRequestId}`);
    assert.notEqual(
      prAfter.pullRequestId,
      prIdBefore,
      "Re-sync should create a fresh PR"
    );

    console.log("\nVerifying old PR was abandoned...");
    const oldPRStatus = await withTestRetry(
      async () => {
        const status = await execWithRetry(
          `az repos pr show --id ${prIdBefore} --org ${ORG_URL} --query "status" -o tsv`
        );
        if (status !== "abandoned") {
          throw new Error(`PR #${prIdBefore} status is ${status}`);
        }
        return status;
      },
      { description: `PR #${prIdBefore} abandoned` }
    );
    console.log(`  Old PR #${prIdBefore} status: ${oldPRStatus}`);
    assert.equal(
      oldPRStatus,
      "abandoned",
      "Old PR should be abandoned after re-sync"
    );

    console.log("\n=== Re-sync test passed ===\n");
  });

  test("createOnly skips file when it exists on base branch", async () => {
    const createOnlyFile = "createonly-test.json";
    const createOnlyBranch = "chore/sync-createonly-test";

    console.log("\n=== Setting up createOnly test ===\n");

    console.log(`Creating ${createOnlyFile} on main branch...`);
    const existingContent = JSON.stringify({ existing: true }, null, 2);
    const defaultBranch = await getDefaultBranch();

    await pushFileChange(
      createOnlyFile,
      existingContent,
      `test: create ${createOnlyFile} for createOnly test`,
      defaultBranch
    );
    console.log("  File created on main");

    console.log("\nRunning xfg with createOnly config...");
    const configPath = join(
      fixturesDir,
      "integration-test-createonly-ado.yaml"
    );
    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    assert.ok(
      output.includes("createOnly") || output.includes("skip"),
      "Output should mention createOnly or skip"
    );

    console.log("\nVerifying createOnly behavior...");
    const mainFileInfo = await waitForFileContent(
      createOnlyFile,
      defaultBranch
    );
    const mainJson = JSON.parse(mainFileInfo.content);
    console.log("  File content on main:", JSON.stringify(mainJson));
    assert.equal(
      mainJson.existing,
      true,
      "File on main should retain original content"
    );

    const prId = await execWithRetry(
      `az repos pr list --repository ${TEST_REPO} --source-branch ${createOnlyBranch} --org ${ORG_URL} --project ${TEST_PROJECT} --query "[0].pullRequestId" -o tsv`
    );
    if (prId) {
      console.log(`  PR was created: #${prId}`);
      const prFileInfo = await waitForFileContent(
        createOnlyFile,
        createOnlyBranch
      );
      const json = JSON.parse(prFileInfo.content);
      console.log("  File content in PR branch:", JSON.stringify(json));
      assert.equal(
        json.existing,
        true,
        "File should retain original content when createOnly skips"
      );
      assert.equal(
        json.newContent,
        undefined,
        "createOnly content must not overwrite the existing file"
      );
    } else {
      console.log("  No PR was created (all files skipped) - this is correct");
    }

    console.log("\n=== createOnly test passed ===\n");
  });

  test("PR title only includes files that actually changed (issue #90)", async () => {
    const unchangedFile = "unchanged-test.json";
    const changedFile = "changed-test.json";
    const testBranch = "chore/sync-config";

    console.log("\n=== Setting up unchanged files test (issue #90) ===\n");

    console.log(
      `Creating ${unchangedFile} on main branch (will NOT change)...`
    );
    const unchangedContent =
      JSON.stringify({ unchanged: true }, null, 2) + "\n";
    const defaultBranch = await getDefaultBranch();

    await pushFileChange(
      unchangedFile,
      unchangedContent,
      `test: setup ${unchangedFile} for issue #90 test`,
      defaultBranch
    );
    console.log("  File created with content matching config");

    console.log("\nRunning xfg with unchanged files config...");
    const configPath = join(fixturesDir, "integration-test-unchanged-ado.yaml");
    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    console.log("\nVerifying PR title...");
    const pr = await waitForActivePr(testBranch);
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

    console.log("\nRunning xfg with direct mode config...");
    const configPath = join(fixturesDir, "integration-test-direct-ado.yaml");
    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    assert.ok(
      output.includes("Pushed directly") || output.includes("direct"),
      "Output should mention direct push"
    );

    // beforeEach abandons all active PRs, so any active PR here came from this sync
    console.log("\nVerifying no PR was created...");
    const activePrCount = await execWithRetry(
      `az repos pr list --repository ${TEST_REPO} --status active --org ${ORG_URL} --project ${TEST_PROJECT} --query "length(@)" -o tsv`
    );
    assert.equal(activePrCount, "0", "No PR should be created in direct mode");
    console.log("  No active PRs - this is correct for direct mode");

    console.log("\nVerifying file exists on main branch...");
    const fileInfo = await waitForFileContent(directFile);
    const json = JSON.parse(fileInfo.content);
    console.log("  File content:", JSON.stringify(json, null, 2));

    assert.equal(json.directMode, true, "File should have directMode: true");

    console.log("  Direct push verified - file is on main without PR");

    console.log("\n=== Direct mode test (issue #134) passed ===\n");
  });
});
