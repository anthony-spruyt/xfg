import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
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
  withTestRetry,
  isNotFoundError,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";

interface Label {
  name: string;
  color: string;
  description: string;
}

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function getLabels(): Promise<Label[]> {
  const output = await execWithRetry(
    `gh api repos/${testRepo}/labels --paginate`
  );
  return JSON.parse(output) as Label[];
}

function findLabel(labels: Label[], name: string): Label | undefined {
  return labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
}

async function getXfgLabels(): Promise<Label[]> {
  return (await getLabels()).filter((l) => l.name.startsWith("xfg-test-"));
}

async function waitForBaseLabels(): Promise<void> {
  await withTestRetry(
    async () => {
      const labels = await getLabels();
      assert.ok(findLabel(labels, "xfg-test-bug"));
      assert.ok(findLabel(labels, "xfg-test-feature"));
    },
    { retries: 3, baseDelayMs: 2000, description: "base labels visible" }
  );
}

async function runSync(configPath: string, extraArgs = ""): Promise<string> {
  return exec(
    `node dist/cli.js sync --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}

function makeBaseConfig(): string {
  return writeConfig(
    tmpDir,
    `id: integration-test-github-labels
files:
  .xfg-labels-test:
    content: "# Placeholder"
    createOnly: true
settings:
  labels:
    xfg-test-bug:
      color: d73a4a
      description: "Something isn't working"
    xfg-test-feature:
      color: a2eeef
      description: "New feature or request"
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-labels-test: false
`
  );
}

describe("GitHub Labels Integration Test", () => {
  before(async () => {
    tmpDir = join(tmpdir(), `xfg-labels-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("labels");
    testRepo = `${OWNER}/${repoName}`;
    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await withTestRetry(
      async () => {
        for (const label of await getXfgLabels()) {
          try {
            await execWithRetry(
              `gh api --method DELETE repos/${testRepo}/labels/${encodeURIComponent(label.name)}`
            );
          } catch (error) {
            // A stale list can return labels that are already deleted
            if (!isNotFoundError(error)) throw error;
          }
        }
        assert.equal(
          (await getXfgLabels()).length,
          0,
          "xfg-test-* labels still present after cleanup"
        );
      },
      { description: "xfg-test-* labels cleared" }
    );
  });

  test("settings creates labels in the test repository", async () => {
    const configPath = makeBaseConfig();

    const labelsBefore = await getXfgLabels();
    assert.equal(
      labelsBefore.length,
      0,
      "Expected no xfg-test-* labels before sync"
    );

    const output = await runSync(configPath);
    console.log(output);

    // GitHub API is eventually consistent — label creates may not be
    // immediately visible on subsequent GET requests.
    await withTestRetry(
      async () => {
        const labelsAfter = await getLabels();
        const bugLabel = findLabel(labelsAfter, "xfg-test-bug");
        assert.ok(bugLabel);
        assert.equal(bugLabel.color, "d73a4a");
        assert.equal(bugLabel.description, "Something isn't working");

        const featureLabel = findLabel(labelsAfter, "xfg-test-feature");
        assert.ok(featureLabel);
        assert.equal(featureLabel.color, "a2eeef");
      },
      { retries: 3, baseDelayMs: 2000, description: "label create consistency" }
    );
  });

  test("settings updates label color and description", async () => {
    const baseConfig = makeBaseConfig();
    await runSync(baseConfig);
    await waitForBaseLabels();

    const updateConfig = writeConfig(
      tmpDir,
      `id: integration-test-github-labels
files:
  .xfg-labels-test:
    content: "# Placeholder"
    createOnly: true
settings:
  labels:
    xfg-test-bug:
      color: ff0000
      description: "Updated bug description"
    xfg-test-feature:
      color: "00ff00"
      description: "Updated feature description"
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-labels-test: false
`
    );

    const output = await runSync(updateConfig);
    console.log(output);

    // GitHub API is eventually consistent — label updates may not be
    // immediately visible on subsequent GET requests.
    await withTestRetry(
      async () => {
        const labelsAfter = await getLabels();
        const bugLabel = findLabel(labelsAfter, "xfg-test-bug");
        assert.ok(bugLabel);
        assert.equal(bugLabel.color, "ff0000");
        assert.equal(bugLabel.description, "Updated bug description");
      },
      { retries: 3, baseDelayMs: 2000, description: "label update consistency" }
    );
  });

  test("settings renames a label", async () => {
    const baseConfig = makeBaseConfig();
    await runSync(baseConfig);
    await waitForBaseLabels();

    const renameConfig = writeConfig(
      tmpDir,
      `id: integration-test-github-labels
files:
  .xfg-labels-test:
    content: "# Placeholder"
    createOnly: true
settings:
  labels:
    xfg-test-bug:
      color: d73a4a
      description: "Something isn't working"
      new_name: xfg-test-defect
    xfg-test-feature:
      color: a2eeef
      description: "New feature or request"
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-labels-test: false
`
    );

    await runSync(renameConfig);

    // GitHub API is eventually consistent — renamed labels may still
    // appear under the old name on immediate GET requests.
    await withTestRetry(
      async () => {
        const labelsAfter = await getLabels();
        assert.equal(findLabel(labelsAfter, "xfg-test-bug"), undefined);
        assert.ok(findLabel(labelsAfter, "xfg-test-defect"));
      },
      { retries: 3, baseDelayMs: 2000, description: "label rename consistency" }
    );
  });

  test("settings is idempotent when labels already match", async () => {
    const configPath = makeBaseConfig();
    await runSync(configPath);
    await waitForBaseLabels();

    const output = await runSync(configPath);
    assert.ok(
      output.includes("Labels: No changes needed"),
      `Expected labels to report no changes, got: ${output}`
    );
    for (const action of ["to create", "to update", "to delete"]) {
      assert.ok(
        !output.includes(action),
        `Expected no "${action}" in idempotent run, got: ${output}`
      );
    }
  });

  test("settings dry-run shows changes without applying", async () => {
    const configPath = makeBaseConfig();

    const output = await runSync(configPath, "--dry-run");
    assert.ok(output.includes("DRY RUN") || output.includes("dry-run"));

    const labelsAfter = await getXfgLabels();
    assert.equal(
      labelsAfter.length,
      0,
      "Dry-run should not create xfg-test-* labels"
    );
  });

  test("settings deletes orphaned labels when removed from config", async () => {
    const phase1Config = writeConfig(
      tmpDir,
      `id: integration-test-github-labels
files:
  .xfg-labels-test:
    content: "# Placeholder"
    createOnly: true
settings:
  deleteOrphaned: true
  labels:
    xfg-test-bug:
      color: d73a4a
      description: "Something isn't working"
    xfg-test-feature:
      color: a2eeef
      description: "New feature or request"
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-labels-test: false
`
    );

    await runSync(phase1Config);
    await waitForBaseLabels();

    const phase2Config = writeConfig(
      tmpDir,
      `id: integration-test-github-labels
files:
  .xfg-labels-test:
    content: "# Placeholder"
    createOnly: true
settings:
  deleteOrphaned: true
  labels:
    xfg-test-bug:
      color: d73a4a
      description: "Something isn't working"
prOptions:
  merge: direct
  deleteBranch: true
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-labels-test: false
`
    );

    await runSync(phase2Config);

    await withTestRetry(
      async () => {
        const labelsPhase2 = await getLabels();
        assert.ok(findLabel(labelsPhase2, "xfg-test-bug"));
        assert.equal(findLabel(labelsPhase2, "xfg-test-feature"), undefined);
      },
      { retries: 3, baseDelayMs: 2000, description: "label delete consistency" }
    );
  });
});
