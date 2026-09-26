import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
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

interface Secret {
  name: string;
}

let repoName: string;
let testRepo: string;
let scopedRepoName: string;
let scopedTestRepo: string;
let tmpDir: string;

async function getSecretsFor(repo: string): Promise<Secret[]> {
  const output = await execWithRetry(
    `gh api repos/${repo}/actions/secrets --jq '.secrets'`
  );
  return JSON.parse(output) as Secret[];
}

async function getSecrets(): Promise<Secret[]> {
  return getSecretsFor(testRepo);
}

const SECRET_VALUE = "integration-test-secret";

async function runSecretsSync(
  configPath: string,
  extraArgs = "",
  summaryPath?: string
): Promise<string> {
  return exec(
    `node dist/cli.js secrets sync --config ${configPath} ${extraArgs}`.trim(),
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        XFG_TEST_SECRET_VALUE: SECRET_VALUE,
        GITHUB_STEP_SUMMARY: summaryPath,
      },
    }
  );
}

describe("GitHub Secrets Integration Test", () => {
  before(async () => {
    repoName = generateRepoName("secrets");
    testRepo = `${OWNER}/${repoName}`;
    scopedRepoName = generateRepoName("secrets-scoped");
    scopedTestRepo = `${OWNER}/${scopedRepoName}`;
    tmpDir = join(tmpdir(), `xfg-secrets-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    await createRepo(OWNER, repoName);
    await createRepo(OWNER, scopedRepoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    await deleteRepo(OWNER, scopedRepoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates a new secret", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets
settings:
  secrets:
    XFG_TEST_SECRET:
      env: XFG_TEST_SECRET_VALUE
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSecretsSync(configPath);

    await withTestRetry(
      async () => {
        const secrets = await getSecrets();
        const found = secrets.find((s) => s.name === "XFG_TEST_SECRET");
        assert.ok(found, "Secret XFG_TEST_SECRET should exist");
      },
      { description: "secret creation visible" }
    );
  });

  test("upserts existing secret", async () => {
    // Ensure secret exists before testing upsert (decouples from prior test ordering)
    const setupConfigPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets-setup
settings:
  secrets:
    XFG_TEST_SECRET:
      env: XFG_TEST_SECRET_VALUE
repos:
  - git: https://github.com/${testRepo}.git
`
    );
    await runSecretsSync(setupConfigPath);
    await withTestRetry(
      async () => {
        const secrets = await getSecrets();
        const found = secrets.find((s) => s.name === "XFG_TEST_SECRET");
        assert.ok(
          found,
          "Setup: XFG_TEST_SECRET should exist before upsert test"
        );
      },
      { description: "secret setup for upsert test" }
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets
settings:
  secrets:
    XFG_TEST_SECRET:
      env: XFG_TEST_SECRET_VALUE
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const summaryPath = join(tmpDir, "upsert-summary.md");
    const output = await runSecretsSync(configPath, "", summaryPath);

    assert.ok(
      output.includes('~ secret "XFG_TEST_SECRET" (update, value write-only)'),
      `apply output should name the secret, got: ${output}`
    );
    const summary = readFileSync(summaryPath, "utf-8");
    assert.ok(summary.includes("## xfg Apply"), summary);
    assert.ok(summary.includes('! secret "XFG_TEST_SECRET"'), summary);
    assert.ok(!output.includes(SECRET_VALUE), "value must not be logged");
    assert.ok(!summary.includes(SECRET_VALUE), "value must not be summarized");

    await withTestRetry(
      async () => {
        const secrets = await getSecrets();
        const found = secrets.find((s) => s.name === "XFG_TEST_SECRET");
        assert.ok(found, "Secret XFG_TEST_SECRET should still exist");
      },
      { description: "secret upsert visible" }
    );
  });

  test("dry run does not create secret", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets
settings:
  secrets:
    XFG_DRY_RUN_SECRET:
      env: XFG_TEST_SECRET_VALUE
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const summaryPath = join(tmpDir, "dry-run-summary.md");
    const output = await runSecretsSync(configPath, "--dry-run", summaryPath);

    assert.ok(
      output.includes('+ secret "XFG_DRY_RUN_SECRET"'),
      `dry-run output should name the secret, got: ${output}`
    );
    const summary = readFileSync(summaryPath, "utf-8");
    assert.ok(summary.includes("## xfg Plan"), summary);
    assert.ok(summary.includes('+ secret "XFG_DRY_RUN_SECRET"'), summary);
    assert.ok(!output.includes(SECRET_VALUE), "value must not be logged");

    const secrets = await getSecrets();
    const found = secrets.find((s) => s.name === "XFG_DRY_RUN_SECRET");
    assert.equal(found, undefined, "Dry-run secret should not exist");
  });

  test("a group-scoped secret reaches only the repo in that group", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets-scoped
groups:
  scoped:
    settings:
      secrets:
        XFG_GROUP_SCOPED_SECRET:
          env: XFG_TEST_SECRET_VALUE
repos:
  - git: https://github.com/${scopedTestRepo}.git
    groups: [scoped]
  - git: https://github.com/${testRepo}.git
`
    );

    await runSecretsSync(configPath);

    await withTestRetry(
      async () => {
        const scoped = await getSecretsFor(scopedTestRepo);
        assert.ok(
          scoped.find((s) => s.name === "XFG_GROUP_SCOPED_SECRET"),
          "The repo in the group should receive the group-scoped secret"
        );
      },
      { description: "group-scoped secret visible on the in-group repo" }
    );

    const unscoped = await getSecretsFor(testRepo);
    assert.equal(
      unscoped.find((s) => s.name === "XFG_GROUP_SCOPED_SECRET"),
      undefined,
      "The repo outside the group must not receive the group-scoped secret"
    );
  });

  test("deletes orphaned secret", async () => {
    // Ensure secret exists before testing deletion (decouples from prior test ordering)
    const setupConfigPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets-setup-delete
settings:
  secrets:
    XFG_TEST_SECRET:
      env: XFG_TEST_SECRET_VALUE
repos:
  - git: https://github.com/${testRepo}.git
`
    );
    await runSecretsSync(setupConfigPath);
    await withTestRetry(
      async () => {
        const secrets = await getSecrets();
        const found = secrets.find((s) => s.name === "XFG_TEST_SECRET");
        assert.ok(
          found,
          "Setup: XFG_TEST_SECRET should exist before deletion test"
        );
      },
      { description: "secret setup for deletion test" }
    );

    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets
settings:
  secrets:
    deleteOrphaned: true
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const output = await runSecretsSync(configPath);
    assert.ok(
      output.includes('- secret "XFG_TEST_SECRET"'),
      `apply output should name the deleted secret, got: ${output}`
    );

    await withTestRetry(
      async () => {
        const secrets = await getSecrets();
        const found = secrets.find((s) => s.name === "XFG_TEST_SECRET");
        assert.equal(found, undefined, "Orphaned secret should be deleted");
      },
      { description: "secret deletion visible" }
    );
  });
});
