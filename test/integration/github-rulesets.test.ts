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
  waitForRulesetVisible as waitForRulesetVisibleBase,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";
const RULESET_NAME = "xfg-test-ruleset";

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function deleteRulesetIfExists(): Promise<void> {
  try {
    const rulesets = await execWithRetry(
      `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}") | .id'`
    );
    if (rulesets) {
      for (const id of rulesets.split("\n").filter(Boolean)) {
        console.log(`  Deleting ruleset ID: ${id}`);
        await execWithRetry(
          `gh api --method DELETE repos/${testRepo}/rulesets/${id}`
        );
      }
    }
  } catch {
    console.log("  No existing rulesets to delete");
  }
}

async function waitForRulesetVisible(rulesetId: number): Promise<void> {
  await waitForRulesetVisibleBase(testRepo, rulesetId);
}

function makeConfig(): string {
  return writeConfig(
    tmpDir,
    `id: integration-test-github-rulesets
files:
  .xfg-settings-test:
    content: "# Placeholder for settings integration test"
    createOnly: true
settings:
  rulesets:
    ${RULESET_NAME}:
      target: branch
      enforcement: active
      conditions:
        refName:
          include:
            - refs/heads/main
      rules:
        - type: pull_request
          parameters:
            requiredApprovingReviewCount: 1
repos:
  - git: https://github.com/${OWNER}/${repoName}.git
    files:
      .xfg-settings-test: false
`
  );
}

describe("GitHub Settings Integration Test", () => {
  before(async () => {
    tmpDir = join(tmpdir(), `xfg-rulesets-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("rulesets");
    testRepo = `${OWNER}/${repoName}`;
    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await deleteRulesetIfExists();
  });

  test("settings creates a ruleset in the test repository", async () => {
    const configPath = makeConfig();

    console.log("Verifying no ruleset exists...");
    const rulesetsBefore = await execWithRetry(
      `gh api repos/${testRepo}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsBefore, "0", "Expected no ruleset before");

    console.log("\nRunning xfg sync...");
    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    console.log("\nVerifying ruleset was created...");
    const rulesetsAfter = await execWithRetry(
      `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
    );
    assert.ok(rulesetsAfter, "Expected a ruleset to be created");

    const ruleset = JSON.parse(rulesetsAfter);
    assert.equal(ruleset.name, RULESET_NAME);
    assert.equal(ruleset.enforcement, "active");
    assert.equal(ruleset.target, "branch");

    await waitForRulesetVisible(ruleset.id);
  });

  test("settings updates an existing ruleset", async () => {
    const configPath = makeConfig();

    console.log("Creating initial ruleset...");
    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const rulesetCreated = await execWithRetry(
      `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
    );
    const rulesetBefore = JSON.parse(rulesetCreated);
    await waitForRulesetVisible(rulesetBefore.id);

    console.log("\nRunning xfg sync again (update)...");
    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const rulesetAfter = JSON.parse(
      await execWithRetry(
        `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
      )
    );
    assert.equal(
      rulesetAfter.id,
      rulesetBefore.id,
      "Same ID = update not recreate"
    );
  });

  test("settings dry-run shows changes without applying", async () => {
    const configPath = makeConfig();

    const rulesetsBefore = await execWithRetry(
      `gh api repos/${testRepo}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsBefore, "0");

    const output = await exec(
      `node dist/cli.js sync --config ${configPath} --dry-run`,
      { cwd: projectRoot }
    );
    assert.ok(
      output.includes("DRY RUN") || output.includes("dry-run"),
      "Output should indicate dry-run"
    );

    const rulesetsAfter = await execWithRetry(
      `gh api repos/${testRepo}/rulesets --jq '[.[] | select(.name == "${RULESET_NAME}")] | length'`
    );
    assert.equal(rulesetsAfter, "0", "Dry-run should not create ruleset");
  });
});
