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
  waitForManifestLabels,
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

function runSettings(configPath: string, extraArgs = ""): string {
  return exec(
    `node dist/cli.js settings --config ${configPath} ${extraArgs}`.trim(),
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
    // Delete all labels to start clean each test
    const labels = getLabels();
    for (const label of labels) {
      try {
        exec(
          `gh api --method DELETE repos/${testRepo}/labels/${encodeURIComponent(label.name)}`
        );
      } catch (e) {
        // Label may already be deleted; log for debugging
        console.warn(`Failed to delete label ${label.name}: ${e}`);
      }
    }
  });

  test("settings creates labels in the test repository", () => {
    const configPath = makeBaseConfig();

    const labelsBefore = getLabels();
    assert.equal(labelsBefore.length, 0);

    const output = runSettings(configPath);
    console.log(output);

    const labelsAfter = getLabels();
    const bugLabel = findLabel(labelsAfter, "xfg-test-bug");
    assert.ok(bugLabel);
    assert.equal(bugLabel.color, "d73a4a");
    assert.equal(bugLabel.description, "Something isn't working");

    const featureLabel = findLabel(labelsAfter, "xfg-test-feature");
    assert.ok(featureLabel);
    assert.equal(featureLabel.color, "a2eeef");
  });

  test("settings updates label color and description", () => {
    const baseConfig = makeBaseConfig();
    runSettings(baseConfig);

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

    const output = runSettings(updateConfig);
    console.log(output);

    const labelsAfter = getLabels();
    const bugLabel = findLabel(labelsAfter, "xfg-test-bug");
    assert.ok(bugLabel);
    assert.equal(bugLabel.color, "ff0000");
    assert.equal(bugLabel.description, "Updated bug description");
  });

  test("settings renames a label", () => {
    const baseConfig = makeBaseConfig();
    runSettings(baseConfig);

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

    runSettings(renameConfig);

    const labelsAfter = getLabels();
    assert.equal(findLabel(labelsAfter, "xfg-test-bug"), undefined);
    assert.ok(findLabel(labelsAfter, "xfg-test-defect"));
  });

  test("settings is idempotent when labels already match", () => {
    const configPath = makeBaseConfig();
    runSettings(configPath);

    const output = runSettings(configPath);
    const lower = output.toLowerCase();
    assert.ok(lower.includes("no changes") || lower.includes("up to date"));
  });

  test("settings dry-run shows changes without applying", () => {
    const configPath = makeBaseConfig();

    const output = runSettings(configPath, "--dry-run");
    assert.ok(output.includes("DRY RUN") || output.includes("dry-run"));

    const labelsAfter = getLabels();
    assert.equal(labelsAfter.length, 0, "Dry-run should not create labels");
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

    runSettings(phase1Config);

    const labelsPhase1 = getLabels();
    assert.ok(findLabel(labelsPhase1, "xfg-test-bug"));
    assert.ok(findLabel(labelsPhase1, "xfg-test-feature"));

    await waitForManifestLabels(testRepo, "integration-test-github-labels", [
      "xfg-test-bug",
      "xfg-test-feature",
    ]);

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

    runSettings(phase2Config);

    const labelsPhase2 = getLabels();
    assert.ok(findLabel(labelsPhase2, "xfg-test-bug"));
    assert.equal(findLabel(labelsPhase2, "xfg-test-feature"), undefined);
  });
});
