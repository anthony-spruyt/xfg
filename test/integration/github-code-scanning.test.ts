import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
  return execWithRetry(
    `node dist/cli.js sync --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}

async function resetCodeScanning(): Promise<void> {
  console.log("  Resetting code scanning to not-configured...");
  try {
    await execWithRetry(
      `gh api --method PATCH repos/${testRepo}/code-scanning/default-setup -f state=not-configured`
    );
  } catch {
    // May already be not-configured or endpoint may 409 — safe to ignore
  }
  // Wait for async operation to settle
  await withTestRetry(
    async () => {
      const setup = await getCodeScanningSetup();
      assert.equal(setup.state, "not-configured");
    },
    {
      retries: 5,
      baseDelayMs: 3000,
      description: "code scanning reset to not-configured",
    }
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

  beforeEach(async () => {
    await resetCodeScanning();
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
      {
        retries: 5,
        baseDelayMs: 3000,
        description: "code scanning configured with default suite",
      }
    );
  });

  test("should update query suite to extended", async () => {
    // First enable with default
    const defaultConfigPath = writeConfig(
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

    await runSync(defaultConfigPath);

    await withTestRetry(
      async () => {
        const setup = await getCodeScanningSetup();
        assert.equal(setup.state, "configured");
      },
      {
        retries: 5,
        baseDelayMs: 3000,
        description: "code scanning configured before update",
      }
    );

    // Now update to extended
    const extendedConfigPath = writeConfig(
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

    await runSync(extendedConfigPath);

    await withTestRetry(
      async () => {
        const setup = await getCodeScanningSetup();
        assert.equal(setup.state, "configured");
        assert.equal(setup.query_suite, "extended");
      },
      {
        retries: 5,
        baseDelayMs: 3000,
        description: "query suite updated to extended",
      }
    );
  });

  test("should show changes in dry-run without applying", async () => {
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

    // beforeEach already reset to not-configured, so dry-run should detect changes
    const output = await runSync(configPath, "--dry-run");
    assert.ok(
      output.includes("DRY RUN") || output.includes("state"),
      `Expected dry-run output, got: ${output}`
    );

    // Verify no changes were applied
    await withTestRetry(
      async () => {
        const setup = await getCodeScanningSetup();
        assert.equal(
          setup.state,
          "not-configured",
          "Dry run should not apply changes"
        );
      },
      {
        retries: 3,
        baseDelayMs: 2000,
        description: "verify dry-run did not apply",
      }
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
      {
        retries: 5,
        baseDelayMs: 3000,
        description: "code scanning configured before idempotency check",
      }
    );

    // Run again - should report no changes
    const output = await runSync(configPath);
    assert.ok(
      output.includes("No changes") || output.includes("unchanged"),
      `Expected no changes, got: ${output}`
    );
  });
});
