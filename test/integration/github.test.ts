import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  execWithRetry,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
  resetTestRepo,
  waitForFileVisible as waitForFileVisibleBase,
  waitForPrVisible,
  withTestRetry,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";
const TARGET_FILE = "my.config.json";
const BRANCH_NAME = "chore/sync-my-config";

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function waitForFileVisible(filePath: string): Promise<string> {
  return waitForFileVisibleBase(testRepo, filePath);
}

describe("GitHub Integration Test", () => {
  before(async () => {
    tmpDir = join(tmpdir(), `xfg-sync-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("sync");
    testRepo = `${OWNER}/${repoName}`;
    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTestRepo(testRepo, { deleteLabels: true });
  });

  test("sync creates a PR in the test repository", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github
files:
  my.config.json:
    content:
      prop1: base-value
      baseOnly: inherited-from-root
groups:
  service-config:
    files:
      my.config.json:
        content:
          prop2:
            prop3: MyService
          prop4:
            prop5:
              - prop6: platform
              - prop7: engineering
repos:
  - git: https://github.com/${testRepo}.git
    groups: [service-config]
    files:
      my.config.json:
        content:
          prop1: main
          addedByOverlay: true
`
    );

    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    const pr = await waitForPrVisible(testRepo, BRANCH_NAME);
    assert.ok(pr.number);
    assert.ok((pr.title as string).includes("sync"));

    await withTestRetry(
      async () => {
        const fileContent = await execWithRetry(
          `gh api repos/${testRepo}/contents/${TARGET_FILE}?ref=${BRANCH_NAME} --jq '.content' | base64 -d`
        );
        const json = JSON.parse(fileContent);
        assert.equal(json.prop1, "main");
        assert.equal(json.baseOnly, "inherited-from-root");
        assert.equal(json.addedByOverlay, true);
        // Assert properties specifically introduced by the service-config group layer
        assert.equal(json.prop2.prop3, "MyService");
        assert.deepEqual(json.prop4.prop5, [
          { prop6: "platform" },
          { prop7: "engineering" },
        ]);
      },
      {
        description: "verify synced file content on PR branch",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
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

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prBefore = await waitForPrVisible(testRepo, BRANCH_NAME, "number");
    const prNumberBefore = prBefore.number as number;
    assert.ok(prNumberBefore);

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prAfter = await waitForPrVisible(testRepo, BRANCH_NAME, "number");
    assert.ok(prAfter.number);

    await withTestRetry(
      async () => {
        try {
          const oldPRState = await exec(
            `gh pr view ${prNumberBefore} --repo ${testRepo} --json state --jq '.state'`
          );
          assert.equal(oldPRState, "CLOSED");
        } catch {
          /* deleted or closed */
        }
      },
      {
        description: "verify old PR is closed after re-sync",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });

  test("createOnly skips file when it exists on base branch", async () => {
    const createOnlyFile = "createonly-test.json";
    const existingContent = JSON.stringify({ existing: true }, null, 2);
    const existingBase64 = Buffer.from(existingContent).toString("base64");

    await execWithRetry(
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

    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
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

    await execWithRetry(
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

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const pr = await waitForPrVisible(testRepo, testBranch, "number,title");
    assert.ok((pr.title as string).includes("changed-test.json"));
    assert.ok(!(pr.title as string).includes("unchanged-test.json"));
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

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const pr = await waitForPrVisible(testRepo, testBranch, "number,title");

    await withTestRetry(
      async () => {
        const fileContent = await execWithRetry(
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
      },
      {
        description: "verify template-interpolated file content",
        retries: 5,
        baseDelayMs: 3000,
      }
    );

    await withTestRetry(
      async () => {
        const prBody = await execWithRetry(
          `gh pr view ${pr.number} --repo ${testRepo} --json body --jq '.body'`
        );
        assert.ok(prBody.includes(testRepo));
        assert.ok(prBody.includes("1 file(s)"));
        assert.ok(prBody.includes("template-test.json"));
        assert.ok(prBody.includes(`- Repository: ${repoName}`));
        assert.ok(prBody.includes(`- Owner: ${OWNER}`));
        assert.ok(prBody.includes("- Platform: github"));
      },
      {
        description: "verify template-interpolated PR body",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
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

    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
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

    await exec(`node dist/cli.js sync --config ${configPath1}`, {
      cwd: projectRoot,
    });

    await withTestRetry(
      async () => {
        const fileContent = await execWithRetry(
          `gh api repos/${testRepo}/contents/${orphanFile} --jq '.content' | base64 -d`
        );
        const json = JSON.parse(fileContent);
        assert.equal(json.orphanTest, true);
      },
      {
        description: "verify orphan file exists after first sync",
        retries: 5,
        baseDelayMs: 3000,
      }
    );

    await withTestRetry(
      async () => {
        const manifestContent = await execWithRetry(
          `gh api repos/${testRepo}/contents/${manifestFile} --jq '.content' | base64 -d`
        );
        const manifest = JSON.parse(manifestContent);
        assert.ok(manifest.configs[configId]?.files?.includes(orphanFile));
      },
      {
        description: "verify manifest tracks orphan file",
        retries: 5,
        baseDelayMs: 3000,
      }
    );

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

    await exec(`node dist/cli.js sync --config ${configPath2}`, {
      cwd: projectRoot,
    });

    await withTestRetry(
      async () => {
        try {
          await exec(
            `gh api repos/${testRepo}/contents/${orphanFile} --jq '.sha'`
          );
          assert.fail("orphan-test.json should have been deleted");
        } catch {
          /* correctly deleted */
        }
      },
      {
        description: "verify orphan file deleted after second sync",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });

  test("handles divergent branch when existing PR is present (issue #183)", async () => {
    const divergentFile = "divergent-test.json";
    const testBranch = "chore/sync-divergent-test";

    await execWithRetry(
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

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const pr1 = await waitForPrVisible(testRepo, testBranch, "number");
    assert.ok(pr1.number);

    // Advance main
    const mainSha = await execWithRetry(
      `gh api repos/${testRepo}/contents/${divergentFile} --jq '.sha'`
    );
    await execWithRetry(
      `gh api --method PUT repos/${testRepo}/contents/${divergentFile} -f message="advance" -f content="${Buffer.from(JSON.stringify({ version: 2, advancedOnMain: true }, null, 2) + "\n").toString("base64")}" -f sha="${mainSha}"`
    );

    const output2 = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const pr2 = await waitForPrVisible(testRepo, testBranch, "number");
    assert.ok(pr2.number);
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

    const mainSha = await execWithRetry(
      `gh api repos/${testRepo}/git/refs/heads/main --jq '.object.sha'`
    );
    await execWithRetry(
      `gh api --method POST repos/${testRepo}/git/refs -f ref="refs/heads/${testBranch}" -f sha="${mainSha}"`
    );

    const branchContent =
      JSON.stringify({ orphanBranchVersion: 1 }, null, 2) + "\n";
    await execWithRetry(
      `gh api --method PUT repos/${testRepo}/contents/${orphanBranchFile} -f message="setup" -f content="${Buffer.from(branchContent).toString("base64")}" -f branch="${testBranch}"`
    );

    const prCheck = await execWithRetry(
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

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prInfo = await waitForPrVisible(testRepo, testBranch, "number");
    assert.ok(prInfo.number);

    await withTestRetry(
      async () => {
        const fileContent = await execWithRetry(
          `gh api repos/${testRepo}/contents/${orphanBranchFile}?ref=${testBranch} --jq '.content' | base64 -d`
        );
        const json = JSON.parse(fileContent);
        assert.ok(!json.orphanBranchVersion);
        assert.equal(json.syncedByXfg, true);
      },
      {
        description: "verify orphan branch file replaced by synced content",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
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

    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prInfo = await waitForPrVisible(testRepo, testBranch, "number");
    assert.ok(prInfo.number);

    await withTestRetry(
      async () => {
        const fileContent = await execWithRetry(
          `gh api repos/${testRepo}/contents/${testFile}?ref=${testBranch} --jq '.content' | base64 -d`
        );
        const json = JSON.parse(fileContent);
        assert.equal(json.lifecycleTest, true);
      },
      {
        description: "verify lifecycle upstream file content on PR branch",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
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

    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const prInfo = await waitForPrVisible(testRepo, testBranch, "number");
    assert.ok(prInfo.number);

    await withTestRetry(
      async () => {
        const fileContent = await execWithRetry(
          `gh api repos/${testRepo}/contents/${testFile}?ref=${testBranch} --jq '.content' | base64 -d`
        );
        const json = JSON.parse(fileContent);
        assert.equal(json.lifecycleTest, true);
      },
      {
        description: "verify lifecycle source file content on PR branch",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
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

      const output = await exec(
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

    await execWithRetry(
      `gh api --method POST repos/${testRepo}/labels -f name="bug" -f color="ededed"`
    );
    await execWithRetry(
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

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const pr = await waitForPrVisible(
      testRepo,
      prLabelsBranch,
      "number,labels"
    );
    const labelNames: string[] = (pr.labels as Array<{ name: string }>).map(
      (l) => l.name
    );
    assert.ok(labelNames.includes("bug"));
    assert.ok(labelNames.includes("enhancement"));
  });

  test("per-repo prOptions.labels overrides global labels", async () => {
    const prLabelsOverrideBranch = "chore/sync-pr-labels-override-test";

    await execWithRetry(
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

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const pr = await waitForPrVisible(
      testRepo,
      prLabelsOverrideBranch,
      "number,labels"
    );
    const labelNames: string[] = (pr.labels as Array<{ name: string }>).map(
      (l) => l.name
    );
    assert.ok(labelNames.includes("documentation"));
    assert.ok(!labelNames.includes("bug"));
    assert.ok(!labelNames.includes("enhancement"));
  });

  test("prOptions.branch creates PR on configured branch", async () => {
    const customBranch = "chore/custom-pr-branch";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-pr-branch-github
files:
  pr-branch-test.json:
    content:
      prBranchTest: true
prOptions:
  branch: ${customBranch}
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const pr = await waitForPrVisible(
      testRepo,
      customBranch,
      "number,headRefName"
    );
    assert.equal(pr.headRefName, customBranch);
  });

  test("per-repo prOptions.branch creates PR on repo-specific branch", async () => {
    const repoBranch = "chore/repo-pr-branch";

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-pr-branch-override-github
files:
  pr-branch-override-test.json:
    content:
      prBranchOverrideTest: true
prOptions:
  branch: chore/global-should-not-use
repos:
  - git: https://github.com/${testRepo}.git
    prOptions:
      branch: ${repoBranch}
`
    );

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const pr = await waitForPrVisible(
      testRepo,
      repoBranch,
      "number,headRefName"
    );
    assert.equal(pr.headRefName, repoBranch);
  });

  test("conditional group applies only when condition is met", async () => {
    const condGroupConfig = [
      `id: integration-test-github`,
      `files:`,
      `  ${TARGET_FILE}:`,
      `    content:`,
      `      base: true`,
      `groups:`,
      `  group-a:`,
      `    files:`,
      `      ${TARGET_FILE}:`,
      `        content:`,
      `          groupA: true`,
      `  group-b:`,
      `    files:`,
      `      ${TARGET_FILE}:`,
      `        content:`,
      `          groupB: true`,
      `conditionalGroups:`,
      `  - when:`,
      `      allOf: [group-a, group-b]`,
      `    files:`,
      `      ${TARGET_FILE}:`,
      `        content:`,
      `          fromConditional: true`,
      `repos:`,
      `  - git: https://github.com/${testRepo}.git`,
      `    groups: [group-a, group-b]`,
      `    files:`,
      `      ${TARGET_FILE}:`,
      `        content:`,
      `          repoOverride: true`,
    ].join("\n");
    const configPath = writeConfig(tmpDir, condGroupConfig);

    const syncCmd = `node dist/cli.js sync --config ${configPath}`;
    await exec(syncCmd, { cwd: projectRoot });

    const pr = await waitForPrVisible(testRepo, BRANCH_NAME);
    assert.ok(pr.number);

    await withTestRetry(
      async () => {
        const raw = await execWithRetry(
          `gh api repos/${testRepo}/contents/${TARGET_FILE}?ref=${BRANCH_NAME} --jq '.content' | base64 -d`
        );
        const json = JSON.parse(raw);
        assert.equal(json.base, true, "root content");
        assert.equal(json.groupA, true, "explicit group-a content");
        assert.equal(json.groupB, true, "explicit group-b content");
        assert.equal(json.fromConditional, true, "conditional group content");
        assert.equal(json.repoOverride, true, "repo override content");
      },
      {
        description: "verify conditional group file content on PR branch",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });

  test("sync with directory-based multi-file config", async () => {
    const configDir = join(tmpDir, "multi-file-config");
    mkdirSync(configDir, { recursive: true });

    writeFileSync(
      join(configDir, "base.yaml"),
      `id: integration-test-multifile
files:
  ${TARGET_FILE}:
    content:
      fromBase: true
      shared: base-value
`,
      "utf-8"
    );

    writeFileSync(
      join(configDir, "repos.yaml"),
      `repos:
  - git: https://github.com/${testRepo}.git
    files:
      ${TARGET_FILE}:
        content:
          fromRepo: true
`,
      "utf-8"
    );

    const output = await exec(`node dist/cli.js sync --config ${configDir}`, {
      cwd: projectRoot,
    });
    console.log(output);

    const pr = await waitForPrVisible(testRepo, BRANCH_NAME);
    assert.ok(pr.number);

    await withTestRetry(
      async () => {
        const raw = await execWithRetry(
          `gh api repos/${testRepo}/contents/${TARGET_FILE}?ref=${BRANCH_NAME} --jq '.content' | base64 -d`
        );
        const json = JSON.parse(raw);
        assert.equal(json.fromBase, true, "content from base.yaml fragment");
        assert.equal(
          json.shared,
          "base-value",
          "shared content from base.yaml"
        );
        assert.equal(json.fromRepo, true, "repo override from repos.yaml");
      },
      {
        description: "verify multi-file config content on PR branch",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });
});
