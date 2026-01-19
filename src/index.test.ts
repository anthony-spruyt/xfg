import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const testDir = join(process.cwd(), "test-cli-tmp");
const testConfigPath = join(testDir, "test-config.yaml");

// Helper to run CLI and capture output
function runCLI(
  args: string[],
  options?: { timeout?: number },
): { stdout: string; stderr: string; success: boolean } {
  try {
    const stdout = execFileSync(
      "node",
      ["--import", "tsx", "src/index.ts", ...args],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: options?.timeout ?? 10000,
      },
    );
    return { stdout, stderr: "", success: true };
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      success: false,
    };
  }
}

describe("CLI", () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("argument parsing", () => {
    test("shows help with --help", () => {
      const result = runCLI(["--help"]);
      assert.ok(result.stdout.includes("xfg"));
      assert.ok(result.stdout.includes("-c, --config"));
      assert.ok(result.stdout.includes("-d, --dry-run"));
      assert.ok(result.stdout.includes("-w, --work-dir"));
      assert.ok(result.stdout.includes("-r, --retries"));
      assert.ok(result.stdout.includes("-b, --branch"));
    });

    test("requires --config option", () => {
      const result = runCLI([]);
      assert.equal(result.success, false);
      assert.ok(
        result.stderr.includes("required") ||
          result.stderr.includes("--config"),
      );
    });

    test("fails with non-existent config file", () => {
      const result = runCLI(["-c", "/nonexistent/config.yaml"]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(output.includes("Config file not found"));
    });

    test("accepts --dry-run flag", () => {
      // Create a minimal valid config
      writeFileSync(
        testConfigPath,
        `
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`,
      );

      // Should fail on clone (invalid repo) but should show dry run message
      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("DRY RUN mode") || output.includes("Processing"),
        "Should show dry run mode or start processing",
      );
    });

    test("accepts --retries option with number", () => {
      writeFileSync(
        testConfigPath,
        `
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`,
      );

      // Should parse --retries without error
      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "--retries",
        "5",
        "-w",
        `${testDir}/work`,
      ]);
      // If it gets past argument parsing, the flag worked
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("Loading config") || output.includes("Processing"),
      );
    });

    test("--retries 0 disables retry", () => {
      writeFileSync(
        testConfigPath,
        `
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`,
      );

      // Should parse --retries 0 without error
      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "--retries",
        "0",
        "-w",
        `${testDir}/work`,
      ]);
      // If it gets past argument parsing, the flag worked
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("Loading config") || output.includes("Processing"),
      );
    });

    test("accepts --branch option with valid branch name", () => {
      writeFileSync(
        testConfigPath,
        `
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`,
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "--branch",
        "feature/custom-branch",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("feature/custom-branch"),
        "Should display custom branch name",
      );
    });

    test("accepts -b shorthand for --branch", () => {
      writeFileSync(
        testConfigPath,
        `
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`,
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "-b",
        "chore/my-sync",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("chore/my-sync"),
        "Should display custom branch name with -b shorthand",
      );
    });

    test("rejects invalid branch name starting with dot", () => {
      writeFileSync(
        testConfigPath,
        `
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`,
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "--branch",
        ".hidden-branch",
        "-w",
        `${testDir}/work`,
      ]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes('cannot start with "." or "-"'),
        "Should show validation error for branch starting with dot",
      );
    });

    test("rejects invalid branch name with spaces", () => {
      writeFileSync(
        testConfigPath,
        `
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`,
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "--branch",
        "my branch",
        "-w",
        `${testDir}/work`,
      ]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("invalid characters"),
        "Should show validation error for branch with spaces",
      );
    });
  });

  describe("config validation", () => {
    test("fails with invalid YAML", () => {
      writeFileSync(testConfigPath, "invalid: yaml: content: [");

      const result = runCLI(["-c", testConfigPath, "--dry-run"]);
      assert.equal(result.success, false);
    });

    test("fails with missing files", () => {
      writeFileSync(
        testConfigPath,
        `
repos:
  - git: git@github.com:test/repo.git
`,
      );

      const result = runCLI(["-c", testConfigPath, "--dry-run"]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("files") || output.includes("required"),
        "Should mention missing files",
      );
    });

    test("fails with missing repos", () => {
      writeFileSync(
        testConfigPath,
        `
files:
  test.json:
    content:
      key: value
`,
      );

      const result = runCLI(["-c", testConfigPath, "--dry-run"]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("repos") || output.includes("required"),
        "Should mention missing repos",
      );
    });
  });

  describe("output formatting", () => {
    test("displays repository count", () => {
      writeFileSync(
        testConfigPath,
        `
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo1.git
  - git: git@github.com:test/repo2.git
`,
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("2 repositories") || output.includes("Found 2"),
        "Should display repository count",
      );
    });

    test("displays target file name", () => {
      writeFileSync(
        testConfigPath,
        `
files:
  my-config.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`,
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("my-config.json"),
        "Should display target file name",
      );
    });

    test("displays branch name for config", () => {
      writeFileSync(
        testConfigPath,
        `
files:
  my-config.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`,
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      // Branch name should be displayed (either chore/sync-config or the default)
      assert.ok(
        output.includes("Branch:") || output.includes("chore/"),
        "Should display branch name",
      );
    });
  });
});
