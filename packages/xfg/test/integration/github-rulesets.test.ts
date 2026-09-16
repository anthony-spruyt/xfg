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
    const ruleset = await withTestRetry(
      async () => {
        const str = await exec(
          `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
        );
        assert.ok(str.trim(), "Expected a ruleset to be created");
        const parsed = JSON.parse(str) as {
          id: number;
          name: string;
          enforcement: string;
          target: string;
        };
        assert.equal(parsed.name, RULESET_NAME);
        assert.equal(parsed.enforcement, "active");
        assert.equal(parsed.target, "branch");
        return parsed;
      },
      { description: "ruleset created", retries: 5, baseDelayMs: 3000 }
    );

    await waitForRulesetVisible(ruleset.id);
  });

  test("settings updates an existing ruleset", async () => {
    const configPath = makeConfig();

    console.log("Creating initial ruleset...");
    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    const rulesetBefore = await withTestRetry(
      async () => {
        const str = await exec(
          `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
        );
        if (!str.trim()) throw new Error("Ruleset not visible yet");
        return JSON.parse(str) as { id: number };
      },
      { description: "initial ruleset visible", retries: 5, baseDelayMs: 3000 }
    );
    await waitForRulesetVisible(rulesetBefore.id);

    console.log("\nRunning xfg sync again (update)...");
    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    await withTestRetry(
      async () => {
        const str = await exec(
          `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
        );
        if (!str.trim()) throw new Error("Ruleset not visible after update");
        const rulesetAfter = JSON.parse(str) as { id: number };
        assert.equal(
          rulesetAfter.id,
          rulesetBefore.id,
          "Same ID = update not recreate"
        );
      },
      { description: "ruleset updated", retries: 5, baseDelayMs: 3000 }
    );
  });

  test("settings $arrayMerge: append adds rules without replacing", async () => {
    // First, create a ruleset with a pull_request rule via root settings
    const initialConfig = makeConfig();
    console.log("Creating initial ruleset with pull_request rule...");
    await exec(`node dist/cli.js sync --config ${initialConfig}`, {
      cwd: projectRoot,
    });

    // List endpoint to get ID, then fetch by ID to get rules
    // Wrap in withTestRetry: GitHub API may return empty when ruleset not yet visible
    const rulesetListItem = await withTestRetry(
      async () => {
        const str = await exec(
          `gh api repos/${testRepo}/rulesets --jq '.[] | select(.name == "${RULESET_NAME}")'`
        );
        if (!str.trim()) {
          throw new Error(`Ruleset "${RULESET_NAME}" not visible yet`);
        }
        return JSON.parse(str) as { id: number };
      },
      { description: "ruleset list visible", retries: 5, baseDelayMs: 3000 }
    );
    await waitForRulesetVisible(rulesetListItem.id);

    const rulesetBefore = await withTestRetry(
      async () => {
        const str = await exec(
          `gh api repos/${testRepo}/rulesets/${rulesetListItem.id}`
        );
        if (!str.trim()) throw new Error("Ruleset detail not visible yet");
        const parsed = JSON.parse(str) as {
          id: number;
          rules: Array<{ type: string }>;
        };
        assert.equal(parsed.rules.length, 1, "Should start with 1 rule");
        assert.equal(parsed.rules[0].type, "pull_request");
        return parsed;
      },
      { description: "ruleset detail visible", retries: 5, baseDelayMs: 3000 }
    );

    // Now sync with $arrayMerge: append to add required_signatures
    const appendConfig = writeConfig(
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
    settings:
      rulesets:
        ${RULESET_NAME}:
          rules:
            $arrayMerge: append
            $values:
              - type: required_signatures
`
    );

    console.log("\nRunning xfg sync with $arrayMerge: append...");
    await exec(`node dist/cli.js sync --config ${appendConfig}`, {
      cwd: projectRoot,
    });

    console.log("\nVerifying ruleset has both rules...");
    await withTestRetry(
      async () => {
        const str = await exec(
          `gh api repos/${testRepo}/rulesets/${rulesetBefore.id}`
        );
        if (!str.trim()) throw new Error("Ruleset detail not visible yet");
        const rulesetAfter = JSON.parse(str) as {
          id: number;
          rules: Array<{ type: string }>;
        };
        assert.equal(
          rulesetAfter.id,
          rulesetBefore.id,
          "Same ruleset ID = updated not recreated"
        );
        assert.equal(rulesetAfter.rules.length, 2, "Should now have 2 rules");
        const ruleTypes = rulesetAfter.rules.map(
          (r: { type: string }) => r.type
        );
        assert.ok(
          ruleTypes.includes("pull_request"),
          "Should keep pull_request"
        );
        assert.ok(
          ruleTypes.includes("required_signatures"),
          "Should add required_signatures"
        );
      },
      { description: "ruleset append verified", retries: 5, baseDelayMs: 3000 }
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
