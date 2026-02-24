import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { exec, projectRoot } from "./test-helpers.js";

const fixturesDir = join(projectRoot, "test", "fixtures");

const TEST_REPO = "anthony-spruyt/xfg-test-8";
const RESET_SCRIPT = join(projectRoot, ".github/scripts/reset-test-repo.sh");

interface Label {
  name: string;
  color: string;
  description: string;
}

function resetTestRepo(): void {
  console.log("\n=== Resetting test repo to clean state ===\n");
  exec(`bash ${RESET_SCRIPT} ${TEST_REPO}`);
  console.log("\n=== Reset complete ===\n");
}

function getLabels(): Label[] {
  try {
    const output = exec(`gh api repos/${TEST_REPO}/labels --paginate`);
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

describe("GitHub Labels Integration Test", () => {
  beforeEach(() => {
    resetTestRepo();
  });

  test("settings creates labels in the test repository", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-labels.yaml"
    );

    // Verify no labels exist before
    console.log("Verifying no labels exist...");
    const labelsBefore = getLabels();
    assert.equal(labelsBefore.length, 0, "Expected no labels to exist before");

    // Run the settings command
    console.log("\nRunning xfg settings...");
    const output = runSettings(configPath);
    console.log(output);

    // Verify both labels were created
    console.log("\nVerifying labels were created...");
    const labelsAfter = getLabels();

    const bugLabel = findLabel(labelsAfter, "xfg-test-bug");
    assert.ok(bugLabel, "Expected xfg-test-bug label to be created");
    assert.equal(bugLabel.color, "d73a4a", "Bug label color should match");
    assert.equal(
      bugLabel.description,
      "Something isn't working",
      "Bug label description should match"
    );

    const featureLabel = findLabel(labelsAfter, "xfg-test-feature");
    assert.ok(featureLabel, "Expected xfg-test-feature label to be created");
    assert.equal(
      featureLabel.color,
      "a2eeef",
      "Feature label color should match"
    );
    assert.equal(
      featureLabel.description,
      "New feature or request",
      "Feature label description should match"
    );

    console.log("\n=== Create labels integration test passed ===\n");
  });

  test("settings updates label color and description", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-labels.yaml"
    );

    // Create labels first
    console.log("Creating initial labels...");
    runSettings(configPath);

    // Write config with different colors and descriptions
    const updateConfig = `
id: integration-test-github-labels
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
  - git: https://github.com/anthony-spruyt/xfg-test-8.git
    files:
      .xfg-labels-test: false
`;
    const updateConfigPath = join(fixturesDir, "tmp-labels-update.yaml");
    writeFileSync(updateConfigPath, updateConfig);

    // Run settings with updated config
    console.log("\nRunning xfg settings with updated config...");
    const output = runSettings(updateConfigPath);
    console.log(output);

    // Verify labels have updated properties
    console.log("\nVerifying labels were updated...");
    const labelsAfter = getLabels();

    const bugLabel = findLabel(labelsAfter, "xfg-test-bug");
    assert.ok(bugLabel, "Expected xfg-test-bug label to exist");
    assert.equal(bugLabel.color, "ff0000", "Bug label color should be updated");
    assert.equal(
      bugLabel.description,
      "Updated bug description",
      "Bug label description should be updated"
    );

    const featureLabel = findLabel(labelsAfter, "xfg-test-feature");
    assert.ok(featureLabel, "Expected xfg-test-feature label to exist");
    assert.equal(
      featureLabel.color,
      "00ff00",
      "Feature label color should be updated"
    );
    assert.equal(
      featureLabel.description,
      "Updated feature description",
      "Feature label description should be updated"
    );

    console.log("\n=== Update labels integration test passed ===\n");
  });

  test("settings renames a label", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-labels.yaml"
    );

    // Create labels first
    console.log("Creating initial labels...");
    runSettings(configPath);

    // Write config with rename
    const renameConfig = `
id: integration-test-github-labels
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
  - git: https://github.com/anthony-spruyt/xfg-test-8.git
    files:
      .xfg-labels-test: false
`;
    const renameConfigPath = join(fixturesDir, "tmp-labels-rename.yaml");
    writeFileSync(renameConfigPath, renameConfig);

    // Run settings with rename config
    console.log("\nRunning xfg settings with rename config...");
    const output = runSettings(renameConfigPath);
    console.log(output);

    // Verify old name is gone, new name exists
    console.log("\nVerifying label was renamed...");
    const labelsAfter = getLabels();

    const oldLabel = findLabel(labelsAfter, "xfg-test-bug");
    assert.equal(oldLabel, undefined, "Old label name should no longer exist");

    const renamedLabel = findLabel(labelsAfter, "xfg-test-defect");
    assert.ok(renamedLabel, "Expected renamed label xfg-test-defect to exist");
    assert.equal(
      renamedLabel.color,
      "d73a4a",
      "Renamed label color should match"
    );

    const featureLabel = findLabel(labelsAfter, "xfg-test-feature");
    assert.ok(featureLabel, "Feature label should be unchanged");

    console.log("\n=== Rename label integration test passed ===\n");
  });

  test("settings is idempotent when labels already match", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-labels.yaml"
    );

    // Create labels first
    console.log("Creating initial labels...");
    runSettings(configPath);

    // Run settings again with the same config
    console.log("\nRunning xfg settings again (idempotent)...");
    const output = runSettings(configPath);
    console.log(output);

    // Verify output indicates no changes
    const lowerOutput = output.toLowerCase();
    assert.ok(
      lowerOutput.includes("no changes") || lowerOutput.includes("up to date"),
      "Output should indicate no changes needed"
    );

    // Verify labels still exist and are correct
    const labelsAfter = getLabels();
    const bugLabel = findLabel(labelsAfter, "xfg-test-bug");
    assert.ok(bugLabel, "Bug label should still exist");
    const featureLabel = findLabel(labelsAfter, "xfg-test-feature");
    assert.ok(featureLabel, "Feature label should still exist");

    console.log("\n=== Idempotent labels integration test passed ===\n");
  });

  test("settings dry-run shows changes without applying", () => {
    const configPath = join(
      fixturesDir,
      "integration-test-config-github-labels.yaml"
    );

    // Verify no labels exist
    console.log("Verifying no labels exist...");
    const labelsBefore = getLabels();
    assert.equal(labelsBefore.length, 0, "Expected no labels before dry-run");

    // Run settings with --dry-run
    console.log("\nRunning xfg settings --dry-run...");
    const output = runSettings(configPath, "--dry-run");
    console.log(output);

    // Verify output indicates dry-run
    assert.ok(
      output.includes("DRY RUN") || output.includes("dry-run"),
      "Output should indicate dry-run mode"
    );

    // Verify no labels were created
    console.log("\nVerifying no labels were created...");
    const labelsAfter = getLabels();
    assert.equal(labelsAfter.length, 0, "Dry-run should not create labels");

    console.log("\n=== Dry-run labels integration test passed ===\n");
  });

  test("settings deletes orphaned labels when removed from config", () => {
    // Phase 1: Create labels with deleteOrphaned enabled
    const phase1Config = `
id: integration-test-github-labels
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
  - git: https://github.com/anthony-spruyt/xfg-test-8.git
    files:
      .xfg-labels-test: false
`;
    const phase1Path = join(fixturesDir, "tmp-labels-delete-phase1.yaml");
    writeFileSync(phase1Path, phase1Config);

    console.log("Phase 1: Creating labels with deleteOrphaned...");
    const output1 = runSettings(phase1Path);
    console.log(output1);

    // Verify both labels exist
    const labelsPhase1 = getLabels();
    assert.ok(
      findLabel(labelsPhase1, "xfg-test-bug"),
      "Bug label should exist after phase 1"
    );
    assert.ok(
      findLabel(labelsPhase1, "xfg-test-feature"),
      "Feature label should exist after phase 1"
    );

    // Phase 2: Remove xfg-test-feature from config
    const phase2Config = `
id: integration-test-github-labels
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
  - git: https://github.com/anthony-spruyt/xfg-test-8.git
    files:
      .xfg-labels-test: false
`;
    const phase2Path = join(fixturesDir, "tmp-labels-delete-phase2.yaml");
    writeFileSync(phase2Path, phase2Config);

    console.log("\nPhase 2: Running with feature label removed from config...");
    const output2 = runSettings(phase2Path);
    console.log(output2);

    // Verify xfg-test-bug still exists and xfg-test-feature was deleted
    console.log("\nVerifying orphaned label was deleted...");
    const labelsPhase2 = getLabels();

    assert.ok(
      findLabel(labelsPhase2, "xfg-test-bug"),
      "Bug label should still exist"
    );
    assert.equal(
      findLabel(labelsPhase2, "xfg-test-feature"),
      undefined,
      "Feature label should be deleted as orphan"
    );

    console.log("\n=== Delete orphaned labels integration test passed ===\n");
  });
});
