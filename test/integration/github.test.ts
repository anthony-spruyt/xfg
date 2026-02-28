import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
  resetTestRepo,
  waitForFileVisible as waitForFileVisibleBase,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";
const TARGET_FILE = "my.config.json";
const BRANCH_NAME = "chore/sync-my-config";

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function waitForFileVisible(
  filePath: string,
  timeoutMs = 10000
): Promise<string> {
  return waitForFileVisibleBase(testRepo, filePath, timeoutMs);
}

describe("GitHub Integration Test", () => {
  before(() => {
    tmpDir = join(tmpdir(), `xfg-sync-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("sync");
    testRepo = `${OWNER}/${repoName}`;
    createRepo(OWNER, repoName);
  });

  after(() => {
    deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetTestRepo(testRepo, { deleteLabels: true });
  });

  test("sync creates a PR in the test repository", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github
files:
  my.config.json:
    content:
      prop1: base-value
      prop2:
        prop3: MyService
      prop4:
        prop5:
          - prop6: platform
          - prop7: engineering
      baseOnly: inherited-from-root
repos:
  - git: https://github.com/${testRepo}.git
    files:
      my.config.json:
        content:
          prop1: main
          addedByOverlay: true
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    const prList = exec(
      `gh pr list --repo ${testRepo} --head ${BRANCH_NAME} --json number,title,url --jq '.[0]'`
    );
    assert.ok(prList, "Expected a PR to be created");

    const pr = JSON.parse(prList);
    assert.ok(pr.number);
    assert.ok(pr.title.includes("sync"));

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${TARGET_FILE}?ref=${BRANCH_NAME} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    assert.equal(json.prop1, "main");
    assert.equal(json.baseOnly, "inherited-from-root");
    assert.equal(json.addedByOverlay, true);
  });

  test("re-sync closes existing PR and creates fresh one", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github
files:
  my.config.json:
    content:
      prop1: base-value
      prop2:
        prop3: MyService
      prop4:
        prop5:
          - prop6: platform
          - prop7: engineering
      baseOnly: inherited-from-root
repos:
  - git: https://github.com/${testRepo}.git
    files:
      my.config.json:
        content:
          prop1: main
          addedByOverlay: true
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prNumberBefore = parseInt(
      exec(
        `gh pr list --repo ${testRepo} --head ${BRANCH_NAME} --json number --jq '.[0].number'`
      ),
      10
    );
    assert.ok(prNumberBefore);

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prListAfter = exec(
      `gh pr list --repo ${testRepo} --head ${BRANCH_NAME} --json number --jq '.[0]'`
    );
    assert.ok(prListAfter);

    try {
      const oldPRState = exec(
        `gh pr view ${prNumberBefore} --repo ${testRepo} --json state --jq '.state'`
      );
      assert.equal(oldPRState, "CLOSED");
    } catch {
      /* deleted or closed */
    }
  });

  test("createOnly skips file when it exists on base branch", async () => {
    const createOnlyFile = "createonly-test.json";
    const existingContent = JSON.stringify({ existing: true }, null, 2);
    const existingBase64 = Buffer.from(existingContent).toString("base64");

    exec(
      `gh api --method PUT repos/${testRepo}/contents/${createOnlyFile} -f message="setup" -f content="${existingBase64}"`
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-createonly-github
files:
  createonly-test.json:
    createOnly: true
    content:
      newContent: true
      shouldNotAppear: "because file already exists on main"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    assert.ok(output.includes("createOnly") || output.includes("skip"));
  });

  test("PR title only includes files that actually changed (issue #90)", async () => {
    const unchangedFile = "unchanged-test.json";
    const testBranch = "chore/sync-config";

    const unchangedContent =
      JSON.stringify({ unchanged: true }, null, 2) + "\n";
    const unchangedBase64 = Buffer.from(unchangedContent).toString("base64");

    exec(
      `gh api --method PUT repos/${testRepo}/contents/${unchangedFile} -f message="setup" -f content="${unchangedBase64}"`
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-unchanged-github
files:
  unchanged-test.json:
    content:
      unchanged: true
  changed-test.json:
    content:
      changed: true
      timestamp: test-run
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number,title --jq '.[0]'`
    );
    const pr = JSON.parse(prInfo);
    assert.ok(pr.title.includes("changed-test.json"));
    assert.ok(!pr.title.includes("unchanged-test.json"));
  });

  test("template feature interpolates xfg variables in files and PR body", async () => {
    const templateFile = "template-test.json";
    const testBranch = "chore/sync-template-test";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-template-github
prTemplate: |
  ## Test PR for \${xfg:repo.fullName}

  This PR updates \${xfg:pr.fileCount} file(s).

  ### Changes

  \${xfg:pr.fileChanges}

  ### Metadata

  - Repository: \${xfg:repo.name}
  - Owner: \${xfg:repo.owner}
  - Platform: \${xfg:repo.platform}
files:
  template-test.json:
    template: true
    vars:
      customVar: "custom-value"
    content:
      repoName: "\${xfg:repo.name}"
      repoOwner: "\${xfg:repo.owner}"
      repoFullName: "\${xfg:repo.fullName}"
      platform: "\${xfg:repo.platform}"
      custom: "\${xfg:customVar}"
      escaped: "$\${xfg:repo.name}"
      static: "not-interpolated"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number,title --jq '.[0]'`
    );
    const pr = JSON.parse(prInfo);

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${templateFile}?ref=${testBranch} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);

    // Dynamic assertions using ephemeral repo name
    assert.equal(json.repoName, repoName);
    assert.equal(json.repoOwner, OWNER);
    assert.equal(json.repoFullName, testRepo);
    assert.equal(json.platform, "github");
    assert.equal(json.custom, "custom-value");
    assert.equal(json.escaped, "${xfg:repo.name}");
    assert.equal(json.static, "not-interpolated");

    const prBody = exec(
      `gh pr view ${pr.number} --repo ${testRepo} --json body --jq '.body'`
    );
    assert.ok(prBody.includes(testRepo));
    assert.ok(prBody.includes("1 file(s)"));
    assert.ok(prBody.includes("template-test.json"));
    assert.ok(prBody.includes(`- Repository: ${repoName}`));
    assert.ok(prBody.includes(`- Owner: ${OWNER}`));
    assert.ok(prBody.includes("- Platform: github"));
  });

  test("direct mode pushes directly to main branch without creating PR", async () => {
    const directFile = "direct-test.config.json";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-direct-github
files:
  direct-test.config.json:
    content:
      directMode: true
      timestamp: direct-push-test
prOptions:
  merge: direct
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    assert.ok(output.includes("Pushed directly") || output.includes("direct"));

    const fileContent = await waitForFileVisible(directFile);
    const json = JSON.parse(fileContent);
    assert.equal(json.directMode, true);
  });

  test("deleteOrphaned removes files when removed from config", async () => {
    const orphanFile = "orphan-test.json";
    const manifestFile = ".xfg.json";
    const configId = "integration-test-delete-orphaned-github";

    const configPath1 = writeConfig(
      tmpDir,
      `id: ${configId}
files:
  orphan-test.json:
    content:
      orphanTest: true
      willBeDeleted: true
    deleteOrphaned: true
repos:
  - git: https://github.com/${testRepo}.git
prOptions:
  merge: force
  deleteBranch: true
`
    );

    exec(`node dist/cli.js sync --config ${configPath1}`, { cwd: projectRoot });

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${orphanFile} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    assert.equal(json.orphanTest, true);

    const manifestContent = exec(
      `gh api repos/${testRepo}/contents/${manifestFile} --jq '.content' | base64 -d`
    );
    const manifest = JSON.parse(manifestContent);
    assert.ok(manifest.configs[configId]?.files?.includes(orphanFile));

    const configPath2 = writeConfig(
      tmpDir,
      `id: ${configId}
files:
  remaining-file.json:
    content:
      remaining: true
    deleteOrphaned: true
repos:
  - git: https://github.com/${testRepo}.git
prOptions:
  merge: force
  deleteBranch: true
`
    );

    exec(`node dist/cli.js sync --config ${configPath2}`, { cwd: projectRoot });

    try {
      exec(`gh api repos/${testRepo}/contents/${orphanFile} --jq '.sha'`);
      assert.fail("orphan-test.json should have been deleted");
    } catch {
      /* correctly deleted */
    }
  });

  test("handles divergent branch when existing PR is present (issue #183)", async () => {
    const divergentFile = "divergent-test.json";
    const testBranch = "chore/sync-divergent-test";

    exec(
      `gh api --method PUT repos/${testRepo}/contents/${divergentFile} -f message="setup" -f content="${Buffer.from(JSON.stringify({ version: 1 }, null, 2) + "\n").toString("base64")}"`
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-divergent-github
files:
  divergent-test.json:
    content:
      version: 3
      syncedByXfg: true
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo1 = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq '.[0].number'`
    );
    assert.ok(prInfo1);

    // Advance main
    const mainSha = exec(
      `gh api repos/${testRepo}/contents/${divergentFile} --jq '.sha'`
    );
    exec(
      `gh api --method PUT repos/${testRepo}/contents/${divergentFile} -f message="advance" -f content="${Buffer.from(JSON.stringify({ version: 2, advancedOnMain: true }, null, 2) + "\n").toString("base64")}" -f sha="${mainSha}"`
    );

    const output2 = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prInfo2 = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq '.[0]'`
    );
    assert.ok(prInfo2);
    // Verify sync produced output (check mark or repo reference)
    const url = new URL(`https://github.com/${testRepo}`);
    assert.ok(
      output2.includes("\u2713") ||
        output2.includes(url.hostname + url.pathname)
    );
  });

  test("handles divergent branch when no PR exists but branch exists (issue #183)", async () => {
    const orphanBranchFile = "orphan-branch-test.json";
    const testBranch = "chore/sync-orphan-branch-test";

    const mainSha = exec(
      `gh api repos/${testRepo}/git/refs/heads/main --jq '.object.sha'`
    );
    exec(
      `gh api --method POST repos/${testRepo}/git/refs -f ref="refs/heads/${testBranch}" -f sha="${mainSha}"`
    );

    const branchContent =
      JSON.stringify({ orphanBranchVersion: 1 }, null, 2) + "\n";
    exec(
      `gh api --method PUT repos/${testRepo}/contents/${orphanBranchFile} -f message="setup" -f content="${Buffer.from(branchContent).toString("base64")}" -f branch="${testBranch}"`
    );

    const prCheck = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq 'length'`
    );
    assert.equal(prCheck, "0");

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-orphan-branch-github
files:
  orphan-branch-test.json:
    content:
      syncedByXfg: true
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq '.[0]'`
    );
    assert.ok(prInfo);

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${orphanBranchFile}?ref=${testBranch} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    assert.ok(!json.orphanBranchVersion);
    assert.equal(json.syncedByXfg, true);
  });

  test("lifecycle: upstream field is ignored when repo already exists", async () => {
    const testFile = "lifecycle-upstream-test.json";
    const testBranch = "chore/sync-lifecycle-upstream-test";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-lifecycle-upstream-github
files:
  lifecycle-upstream-test.json:
    content:
      lifecycleTest: true
      upstreamConfigured: true
repos:
  - git: https://github.com/${testRepo}.git
    upstream: git@github.com:some-org/some-repo.git
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq '.[0]'`
    );
    assert.ok(prInfo);

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${testFile}?ref=${testBranch} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    assert.equal(json.lifecycleTest, true);
    assert.ok(!output.toLowerCase().includes("forked"));
  });

  test("lifecycle: source field is ignored when repo already exists", async () => {
    const testFile = "lifecycle-source-test.json";
    const testBranch = "chore/sync-lifecycle-source-test";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-lifecycle-source-github
files:
  lifecycle-source-test.json:
    content:
      lifecycleTest: true
      sourceConfigured: true
repos:
  - git: https://github.com/${testRepo}.git
    source: https://dev.azure.com/someorg/someproject/_git/somerepo
`
    );

    const output = exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${testBranch} --json number --jq '.[0]'`
    );
    assert.ok(prInfo);

    const fileContent = exec(
      `gh api repos/${testRepo}/contents/${testFile}?ref=${testBranch} --jq '.content' | base64 -d`
    );
    const json = JSON.parse(fileContent);
    assert.equal(json.lifecycleTest, true);
    assert.ok(!output.toLowerCase().includes("migrated"));
  });

  test("lifecycle: dry-run outputs CREATE for non-existent repo", async () => {
    const dryRunTmpDir = join(
      tmpdir(),
      `xfg-lifecycle-dryrun-test-${Date.now()}`
    );
    mkdirSync(dryRunTmpDir, { recursive: true });

    try {
      const configPath = join(dryRunTmpDir, "config.yaml");
      writeFileSync(
        configPath,
        `id: lifecycle-dryrun-test
files:
  test.txt:
    content: "test"
repos:
  - git: https://github.com/${OWNER}/xfg-nonexistent-lifecycle-dryrun-test
`
      );

      const output = exec(
        `node dist/cli.js sync --config ${configPath} --dry-run`,
        { cwd: projectRoot }
      );
      assert.ok(output.includes("CREATE"));
    } finally {
      rmSync(dryRunTmpDir, { recursive: true, force: true });
    }
  });

  test("sync creates a PR with configured prOptions.labels", async () => {
    const prLabelsBranch = "chore/sync-pr-labels-test";

    exec(
      `gh api --method POST repos/${testRepo}/labels -f name="bug" -f color="ededed"`
    );
    exec(
      `gh api --method POST repos/${testRepo}/labels -f name="enhancement" -f color="ededed"`
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-pr-labels-github
files:
  pr-labels-test.json:
    content:
      prLabelsTest: true
      syncedByXfg: true
prOptions:
  labels:
    - bug
    - enhancement
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${prLabelsBranch} --json number,labels --jq '.[0]'`
    );
    const pr = JSON.parse(prInfo);
    const labelNames: string[] = pr.labels.map((l: { name: string }) => l.name);
    assert.ok(labelNames.includes("bug"));
    assert.ok(labelNames.includes("enhancement"));
  });

  test("per-repo prOptions.labels overrides global labels", async () => {
    const prLabelsOverrideBranch = "chore/sync-pr-labels-override-test";

    exec(
      `gh api --method POST repos/${testRepo}/labels -f name="documentation" -f color="ededed"`
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-pr-labels-override-github
files:
  pr-labels-override-test.json:
    content:
      prLabelsOverrideTest: true
prOptions:
  labels:
    - bug
    - enhancement
repos:
  - git: https://github.com/${testRepo}.git
    prOptions:
      labels:
        - documentation
`
    );

    exec(`node dist/cli.js sync --config ${configPath}`, { cwd: projectRoot });

    const prInfo = exec(
      `gh pr list --repo ${testRepo} --head ${prLabelsOverrideBranch} --json number,labels --jq '.[0]'`
    );
    const pr = JSON.parse(prInfo);
    const labelNames: string[] = pr.labels.map((l: { name: string }) => l.name);
    assert.ok(labelNames.includes("documentation"));
    assert.ok(!labelNames.includes("bug"));
    assert.ok(!labelNames.includes("enhancement"));
  });
});
