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

interface Secret {
  name: string;
}

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function getSecrets(): Promise<Secret[]> {
  try {
    const output = await execWithRetry(
      `gh api repos/${testRepo}/actions/secrets --jq '.secrets'`
    );
    return JSON.parse(output) as Secret[];
  } catch {
    return [];
  }
}

async function runSecretsSync(
  configPath: string,
  extraArgs = ""
): Promise<string> {
  return exec(
    `node dist/cli.js secrets sync --config ${configPath} ${extraArgs}`.trim(),
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        XFG_TEST_SECRET_VALUE: "integration-test-secret",
      },
    }
  );
}

describe("GitHub Secrets Integration Test", () => {
  before(async () => {
    repoName = generateRepoName("secrets");
    testRepo = `${OWNER}/${repoName}`;
    tmpDir = join(tmpdir(), `xfg-secrets-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates a new secret", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets
repos:
  - git: https://github.com/${testRepo}.git
secrets:
  XFG_TEST_SECRET:
    env: XFG_TEST_SECRET_VALUE
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
repos:
  - git: https://github.com/${testRepo}.git
secrets:
  XFG_TEST_SECRET:
    env: XFG_TEST_SECRET_VALUE
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
repos:
  - git: https://github.com/${testRepo}.git
secrets:
  XFG_TEST_SECRET:
    env: XFG_TEST_SECRET_VALUE
`
    );

    await runSecretsSync(configPath);

    const secrets = await getSecrets();
    const found = secrets.find((s) => s.name === "XFG_TEST_SECRET");
    assert.ok(found, "Secret XFG_TEST_SECRET should still exist");
  });

  test("dry run does not create secret", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets
repos:
  - git: https://github.com/${testRepo}.git
secrets:
  XFG_DRY_RUN_SECRET:
    env: XFG_TEST_SECRET_VALUE
`
    );

    await runSecretsSync(configPath, "--dry-run");

    const secrets = await getSecrets();
    const found = secrets.find((s) => s.name === "XFG_DRY_RUN_SECRET");
    assert.equal(found, undefined, "Dry-run secret should not exist");
  });

  test("deletes orphaned secret", async () => {
    // Ensure secret exists before testing deletion (decouples from prior test ordering)
    const setupConfigPath = writeConfig(
      tmpDir,
      `id: integration-test-github-secrets-setup-delete
repos:
  - git: https://github.com/${testRepo}.git
secrets:
  XFG_TEST_SECRET:
    env: XFG_TEST_SECRET_VALUE
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
repos:
  - git: https://github.com/${testRepo}.git
secrets:
  deleteOrphaned: true
`
    );

    await runSecretsSync(configPath);

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
