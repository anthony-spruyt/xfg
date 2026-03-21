import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
  withTestRetry,
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

function getLabels(): Label[] {
  try {
    const output = exec(`gh api repos/${testRepo}/labels --paginate`);
    return JSON.parse(output) as Label[];
  } catch {
    return [];
  }
}

function findLabel(labels: Label[], name: string): Label | undefined {
  return labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
}

function getXfgLabels(): Label[] {
  return getLabels().filter((l) => l.name.startsWith("xfg-test-"));
}

function runSync(configPath: string, extraArgs = ""): string {
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
  before(() => {
    tmpDir = join(tmpdir(), `xfg-labels-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("labels");
    testRepo = `${OWNER}/${repoName}`;
    createRepo(OWNER, repoName);
  });

  after(() => {
    deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Delete xfg-test-* labels to start clean each test.
    // Retry up to 3 times since GitHub API deletions can be eventually consistent.
    for (let attempt = 0; attempt < 3; attempt++) {
      const labels = getLabels().filter((l) => l.name.startsWith("xfg-test-"));
      if (labels.length === 0) break;
      for (const label of labels) {
        try {
          exec(
            `gh api --method DELETE repos/${testRepo}/labels/${encodeURIComponent(label.name)}`
          );
        } catch (e) {
          console.warn(`Failed to delete label ${label.name}: ${e}`);
        }
      }
    }
  });

  test("settings creates labels in the test repository", () => {
    const configPath = makeBaseConfig();

    const labelsBefore = getXfgLabels();
    assert.equal(
      labelsBefore.length,
      0,
      "Expected no xfg-test-* labels before sync"
    );

    const output = runSync(configPath);
    console.log(output);

    // GitHub API is eventually consistent — label creates may not be
    // immediately visible on subsequent GET requests.
    withTestRetry(
      () => {
        const labelsAfter = getLabels();
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

  test("settings updates label color and description", () => {
    const baseConfig = makeBaseConfig();
    runSync(baseConfig);

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

    const output = runSync(updateConfig);
    console.log(output);

    // GitHub API is eventually consistent — label updates may not be
    // immediately visible on subsequent GET requests.
    withTestRetry(
      () => {
        const labelsAfter = getLabels();
        const bugLabel = findLabel(labelsAfter, "xfg-test-bug");
        assert.ok(bugLabel);
        assert.equal(bugLabel.color, "ff0000");
        assert.equal(bugLabel.description, "Updated bug description");
      },
      { retries: 3, baseDelayMs: 2000, description: "label update consistency" }
    );
  });

  test("settings renames a label", () => {
    const baseConfig = makeBaseConfig();
    runSync(baseConfig);

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

    runSync(renameConfig);

    // GitHub API is eventually consistent — renamed labels may still
    // appear under the old name on immediate GET requests.
    withTestRetry(
      () => {
        const labelsAfter = getLabels();
        assert.equal(findLabel(labelsAfter, "xfg-test-bug"), undefined);
        assert.ok(findLabel(labelsAfter, "xfg-test-defect"));
      },
      { retries: 3, baseDelayMs: 2000, description: "label rename consistency" }
    );
  });

  test("settings is idempotent when labels already match", () => {
    const configPath = makeBaseConfig();
    runSync(configPath);

    const output = runSync(configPath);
    const lower = output.toLowerCase();
    assert.ok(lower.includes("no changes") || lower.includes("up to date"));
  });

  test("settings dry-run shows changes without applying", () => {
    const configPath = makeBaseConfig();

    const output = runSync(configPath, "--dry-run");
    assert.ok(output.includes("DRY RUN") || output.includes("dry-run"));

    const labelsAfter = getXfgLabels();
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

    runSync(phase1Config);

    withTestRetry(
      () => {
        const labelsPhase1 = getLabels();
        assert.ok(findLabel(labelsPhase1, "xfg-test-bug"));
        assert.ok(findLabel(labelsPhase1, "xfg-test-feature"));
      },
      {
        retries: 3,
        baseDelayMs: 2000,
        description: "label create consistency (phase 1)",
      }
    );

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

    runSync(phase2Config);

    withTestRetry(
      () => {
        const labelsPhase2 = getLabels();
        assert.ok(findLabel(labelsPhase2, "xfg-test-bug"));
        assert.equal(findLabel(labelsPhase2, "xfg-test-feature"), undefined);
      },
      { retries: 3, baseDelayMs: 2000, description: "label delete consistency" }
    );
  });
});
