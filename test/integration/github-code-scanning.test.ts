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

interface CodeScanningDefaultSetup {
  state: "configured" | "not-configured";
  query_suite?: "default" | "extended";
  languages?: string[];
}

let repoName: string;
let testRepo: string;
let tmpDir: string;

async function getCodeScanningSetup(): Promise<CodeScanningDefaultSetup> {
  const output = await execWithRetry(
    `gh api repos/${testRepo}/code-scanning/default-setup`
  );
  return JSON.parse(output) as CodeScanningDefaultSetup;
}

async function runSync(configPath: string, extraArgs = ""): Promise<string> {
  return exec(
    `node dist/cli.js sync --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}

describe("GitHub Code Scanning Settings Integration", () => {
  before(async () => {
    repoName = generateRepoName("code-scanning");
    testRepo = `${OWNER}/${repoName}`;
    tmpDir = join(tmpdir(), `xfg-code-scanning-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should enable code scanning with default query suite", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-code-scanning
files:
  .xfg-code-scanning-test:
    content: "marker"

settings:
  codeScanning:
    state: configured
    querySuite: default

repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath);

    await withTestRetry(
      async () => {
        const setup = await getCodeScanningSetup();
        assert.equal(setup.state, "configured");
        assert.equal(setup.query_suite, "default");
      },
      { retries: 5, description: "code scanning configured" }
    );
  });

  test("should update query suite to extended", async () => {
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-code-scanning
files:
  .xfg-code-scanning-test:
    content: "marker"

settings:
  codeScanning:
    state: configured
    querySuite: extended

repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath);

    await withTestRetry(
      async () => {
        const setup = await getCodeScanningSetup();
        assert.equal(setup.state, "configured");
        assert.equal(setup.query_suite, "extended");
      },
      { retries: 5, description: "query suite updated to extended" }
    );
  });

  test("should show changes in dry-run without applying", async () => {
    // First disable code scanning
    const disableConfigPath = writeConfig(
      tmpDir,
      `id: integration-test-code-scanning
files:
  .xfg-code-scanning-test:
    content: "marker"

settings:
  codeScanning:
    state: not-configured

repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(disableConfigPath);

    await withTestRetry(
      async () => {
        const setup = await getCodeScanningSetup();
        assert.equal(setup.state, "not-configured");
      },
      { retries: 5, description: "code scanning disabled" }
    );

    // Now dry-run to re-enable
    const enableConfigPath = writeConfig(
      tmpDir,
      `id: integration-test-code-scanning
files:
  .xfg-code-scanning-test:
    content: "marker"

settings:
  codeScanning:
    state: configured
    querySuite: default

repos:
  - git: https://github.com/${testRepo}.git
`
    );

    const output = await runSync(enableConfigPath, "--dry-run");
    assert.ok(
      output.includes("DRY RUN") || output.includes("state"),
      `Expected dry-run output, got: ${output}`
    );

    // Verify no changes were applied
    const setup = await getCodeScanningSetup();
    assert.equal(
      setup.state,
      "not-configured",
      "Dry run should not apply changes"
    );
  });

  test("should report no changes when settings match", async () => {
    // Enable code scanning
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-code-scanning
files:
  .xfg-code-scanning-test:
    content: "marker"

settings:
  codeScanning:
    state: configured
    querySuite: default

repos:
  - git: https://github.com/${testRepo}.git
`
    );

    await runSync(configPath);

    await withTestRetry(
      async () => {
        const setup = await getCodeScanningSetup();
        assert.equal(setup.state, "configured");
      },
      { retries: 5, description: "code scanning configured" }
    );

    // Run again - should report no changes
    const output = await runSync(configPath);
    assert.ok(
      output.includes("No changes") || output.includes("unchanged"),
      `Expected no changes, got: ${output}`
    );
  });
});
