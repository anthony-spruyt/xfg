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

// GitLab test repository
const TEST_NAMESPACE = "anthony-spruyt1";
const TEST_REPO = "xfg-test";
const PROJECT_PATH = `${TEST_NAMESPACE}/${TEST_REPO}`;
const TARGET_FILE = "my.config.json";
const BRANCH_NAME = "chore/sync-my-config";

interface MergeRequest {
  iid: number;
  title: string;
  web_url: string;
  state: string;
}

// Helper to call GitLab API via glab cli
async function glabApi(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>
): Promise<string> {
  let cmd = `glab api --method ${method}`;
  if (body) {
    for (const [key, value] of Object.entries(body)) {
      const strValue =
        typeof value === "string" ? value : JSON.stringify(value);
      cmd += ` -f ${key}='${strValue}'`;
    }
  }
  cmd += ` ${endpoint}`;
  return await execWithRetry(cmd);
}

async function getFileContent(
  path: string,
  branch?: string
): Promise<{ content: string } | null> {
  const encodedPath = encodeURIComponent(path);
  const ref = branch || (await getDefaultBranch());
  try {
    const result = await glabApi(
      "GET",
      `projects/${encodeURIComponent(PROJECT_PATH)}/repository/files/${encodedPath}?ref=${encodeURIComponent(ref)}`
    );
    const json = JSON.parse(result);
    // GitLab returns base64 encoded content
    const content = Buffer.from(json.content, "base64").toString("utf-8");
    return { content };
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function waitForFileContent(
  path: string,
  branch: string
): Promise<{ content: string }> {
  return withTestRetry(
    async () => {
      const fileInfo = await getFileContent(path, branch);
      if (!fileInfo) throw new Error(`${path} not visible on ${branch} yet`);
      return fileInfo;
    },
    { description: `${path} visible on ${branch}` }
  );
}

async function getDefaultBranch(): Promise<string> {
  const result = await glabApi(
    "GET",
    `projects/${encodeURIComponent(PROJECT_PATH)}`
  );
  const json = JSON.parse(result);
  return json.default_branch || "main";
}

// Helper to push a file change (create/update/delete)
async function pushFileChange(
  path: string,
  content: string | null,
  message: string,
  branch: string
): Promise<void> {
  const encodedPath = encodeURIComponent(path);
  const projectId = encodeURIComponent(PROJECT_PATH);

  if (content === null) {
    await glabApi(
      "DELETE",
      `projects/${projectId}/repository/files/${encodedPath}`,
      {
        branch,
        commit_message: message,
      }
    );
  } else {
    const exists = await getFileContent(path, branch);
    await glabApi(
      exists ? "PUT" : "POST",
      `projects/${projectId}/repository/files/${encodedPath}`,
      {
        branch,
        content,
        commit_message: message,
      }
    );
  }
}

async function listOpenMRs(sourceBranch?: string): Promise<MergeRequest[]> {
  const branchFilter = sourceBranch
    ? `&source_branch=${encodeURIComponent(sourceBranch)}`
    : "";
  const result = await glabApi(
    "GET",
    `projects/${encodeURIComponent(PROJECT_PATH)}/merge_requests?state=opened${branchFilter}`
  );
  return JSON.parse(result) as MergeRequest[];
}

async function getMRByBranch(
  sourceBranch: string
): Promise<MergeRequest | null> {
  const mrs = await listOpenMRs(sourceBranch);
  return mrs[0] ?? null;
}

async function waitForOpenMR(
  sourceBranch: string,
  excludeIid?: number
): Promise<MergeRequest> {
  return withTestRetry(
    async () => {
      const mr = await getMRByBranch(sourceBranch);
      if (!mr) throw new Error(`No open MR on ${sourceBranch} yet`);
      if (mr.iid === excludeIid) {
        throw new Error(`Open MR on ${sourceBranch} is still !${excludeIid}`);
      }
      return mr;
    },
    { description: `open MR on ${sourceBranch}` }
  );
}

const RESET_SCRIPT = join(
  repoRoot,
  ".github/scripts/reset-test-repo-gitlab.sh"
);

async function resetTestRepo(): Promise<void> {
  console.log("\n=== Resetting GitLab test repo to clean state ===\n");
  await exec(`bash ${RESET_SCRIPT} ${PROJECT_PATH}`);
  console.log("\n=== Reset complete ===\n");
}

describe("GitLab Integration Test", () => {
  beforeEach(async () => {
    await resetTestRepo();
  });

  test("sync creates a MR in the test repository", async () => {
    const configPath = join(fixturesDir, "integration-test-config-gitlab.yaml");

    console.log("Running xfg...");
    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    console.log("\nVerifying MR was created...");
    const mr = await waitForOpenMR(BRANCH_NAME);

    console.log(`  MR !${mr.iid}: ${mr.title}`);
    console.log(`  URL: ${mr.web_url}`);

    assert.ok(mr.iid, "MR should have an IID");
    assert.ok(mr.title.includes("sync"), "MR title should mention sync");

    console.log("\nVerifying file exists in MR branch...");
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

  test("re-sync closes existing MR and creates fresh one", async () => {
    const configPath = join(fixturesDir, "integration-test-config-gitlab.yaml");
    console.log("Creating initial MR...");
    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    console.log("Getting current MR IID...");
    const mrIidBefore = (await waitForOpenMR(BRANCH_NAME)).iid;
    console.log(`  Current MR: !${mrIidBefore}`);
    assert.ok(mrIidBefore, "Expected a MR to exist after initial sync");

    console.log("\nRunning xfg again (re-sync)...");
    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    console.log("\nVerifying MR state after re-sync...");
    const mrAfter = await waitForOpenMR(BRANCH_NAME, mrIidBefore);
    console.log(`  MR after re-sync: !${mrAfter.iid}`);
    assert.notEqual(
      mrAfter.iid,
      mrIidBefore,
      "Re-sync should create a fresh MR"
    );

    console.log("\nVerifying old MR was closed...");
    const oldMRState = await withTestRetry(
      async () => {
        const oldMR = JSON.parse(
          await glabApi(
            "GET",
            `projects/${encodeURIComponent(PROJECT_PATH)}/merge_requests/${mrIidBefore}`
          )
        ) as MergeRequest;
        if (oldMR.state !== "closed") {
          throw new Error(`MR !${mrIidBefore} state is ${oldMR.state}`);
        }
        return oldMR.state;
      },
      { description: `MR !${mrIidBefore} closed` }
    );
    console.log(`  Old MR !${mrIidBefore} state: ${oldMRState}`);
    assert.equal(oldMRState, "closed", "Old MR should be closed after re-sync");

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
      `test: setup ${createOnlyFile} for createOnly test`,
      defaultBranch
    );
    console.log("  File created on main");

    console.log("\nRunning xfg with createOnly config...");
    const configPath = join(
      fixturesDir,
      "integration-test-createonly-gitlab.yaml"
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

    const mr = await getMRByBranch(createOnlyBranch);
    if (mr) {
      console.log(`  MR was created: !${mr.iid}`);
      const fileInfo = await waitForFileContent(
        createOnlyFile,
        createOnlyBranch
      );
      const json = JSON.parse(fileInfo.content);
      console.log("  File content in MR branch:", JSON.stringify(json));
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
      console.log("  No MR was created (all files skipped) - this is correct");
    }

    console.log("\n=== createOnly test passed ===\n");
  });

  test("MR title only includes files that actually changed (issue #90)", async () => {
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
    const configPath = join(
      fixturesDir,
      "integration-test-unchanged-gitlab.yaml"
    );
    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    console.log("\nVerifying MR title...");
    const mr = await waitForOpenMR(testBranch);
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

    console.log("\nRunning xfg with direct mode config...");
    const configPath = join(fixturesDir, "integration-test-direct-gitlab.yaml");
    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    assert.ok(
      output.includes("Pushed directly") || output.includes("direct"),
      "Output should mention direct push"
    );

    // beforeEach closes all open MRs, so any open MR here came from this sync
    console.log("\nVerifying no MR was created...");
    const openMRs = await listOpenMRs();
    assert.equal(openMRs.length, 0, "No MR should be created in direct mode");
    console.log("  No open MRs - this is correct for direct mode");

    console.log("\nVerifying file exists on main branch...");
    const defaultBranch = await getDefaultBranch();
    const fileInfo = await waitForFileContent(directFile, defaultBranch);
    const json = JSON.parse(fileInfo.content);
    console.log("  File content:", JSON.stringify(json, null, 2));

    assert.equal(json.directMode, true, "File should have directMode: true");

    console.log("  Direct push verified - file is on main without MR");

    console.log("\n=== Direct mode test (issue #134) passed ===\n");
  });
});
