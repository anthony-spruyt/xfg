import { test, describe, before, after } from "node:test";
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
} from "./test-helpers.js";

const OWNER = "spruyt-labs";

interface Variable {
  name: string;
  value: string;
}

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function getVariables(): Promise<Variable[]> {
  try {
    const output = await execWithRetry(
      `gh api repos/${testRepo}/actions/variables --jq '.variables'`
    );
    return JSON.parse(output) as Variable[];
  } catch {
    return [];
  }
}

async function runSync(configPath: string, extraArgs = ""): Promise<string> {
  return exec(
    `node dist/cli.js sync --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}

describe("GitHub Variables Integration Test", () => {
  before(async () => {
    repoName = generateRepoName("variables");
    testRepo = `${OWNER}/${repoName}`;
    tmpDir = join(tmpdir(), `xfg-variables-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates variables via sync", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-variables
settings:
  variables:
    XFG_TEST_VAR: "test-value"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath);

    await withTestRetry(
      async () => {
        const variables = await getVariables();
        const found = variables.find((v) => v.name === "XFG_TEST_VAR");
        assert.ok(found, "Variable XFG_TEST_VAR should exist");
        assert.equal(found.value, "test-value");
      },
      { description: "variable creation visible" }
    );
  });

  test("updates variable value", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-variables
settings:
  variables:
    XFG_TEST_VAR: "updated-value"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath);

    await withTestRetry(
      async () => {
        const variables = await getVariables();
        const found = variables.find((v) => v.name === "XFG_TEST_VAR");
        assert.ok(found, "Variable XFG_TEST_VAR should exist");
        assert.equal(found.value, "updated-value");
      },
      { description: "variable update visible" }
    );
  });

  test("dry run does not create variable", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-variables
settings:
  variables:
    XFG_DRY_RUN_VAR: "should-not-exist"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath, "--dry-run");

    const variables = await getVariables();
    const found = variables.find((v) => v.name === "XFG_DRY_RUN_VAR");
    assert.equal(found, undefined, "Dry-run variable should not exist");
  });

  test("deletes orphaned variables with deleteOrphaned", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-variables
settings:
  variables:
    deleteOrphaned: true
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath);

    await withTestRetry(
      async () => {
        const variables = await getVariables();
        const found = variables.find((v) => v.name === "XFG_TEST_VAR");
        assert.equal(found, undefined, "Orphaned variable should be deleted");
      },
      { description: "variable deletion visible" }
    );
  });
});
