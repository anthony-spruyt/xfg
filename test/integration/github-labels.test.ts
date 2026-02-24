import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
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
});
