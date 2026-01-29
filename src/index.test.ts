import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import {
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

const testDir = join(process.cwd(), "test-cli-tmp");
const testConfigPath = join(testDir, "test-config.yaml");

// Helper to run CLI and capture output
// By default, unsets GITHUB_STEP_SUMMARY to prevent tests from writing to CI job summary
function runCLI(
  args: string[],
  options?: { timeout?: number; env?: Record<string, string | undefined> }
): { stdout: string; stderr: string; success: boolean } {
  // Create env with GITHUB_STEP_SUMMARY unset by default
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { GITHUB_STEP_SUMMARY: _, ...envWithoutSummary } = process.env;
  const testEnv = { ...envWithoutSummary, ...options?.env };

  try {
    const stdout = execFileSync(
      "node",
      ["--import", "tsx", "src/index.ts", ...args],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: options?.timeout ?? 10000,
        env: testEnv,
      }
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
        result.stderr.includes("required") || result.stderr.includes("--config")
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
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`
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
        "Should show dry run mode or start processing"
      );
    });

    test("accepts --retries option with number", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`
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
        output.includes("Loading config") || output.includes("Processing")
      );
    });

    test("--retries 0 disables retry", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`
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
        output.includes("Loading config") || output.includes("Processing")
      );
    });

    test("accepts --branch option with valid branch name", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`
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
        "Should display custom branch name"
      );
    });

    test("accepts -b shorthand for --branch", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`
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
        "Should display custom branch name with -b shorthand"
      );
    });

    test("rejects invalid branch name starting with dot", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
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
        "Should show validation error for branch starting with dot"
      );
    });

    test("rejects invalid branch name with spaces", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
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
        "Should show validation error for branch with spaces"
      );
    });

    test("rejects invalid --merge value", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "--merge",
        "invalid-mode",
        "-w",
        `${testDir}/work`,
      ]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("Invalid merge mode") ||
          output.includes("manual, auto, force, direct"),
        "Should show validation error for invalid merge mode"
      );
    });

    test("accepts valid --merge values", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
      );

      // Test each valid merge mode
      for (const mode of ["manual", "auto", "force", "direct"]) {
        const result = runCLI([
          "-c",
          testConfigPath,
          "--dry-run",
          "--merge",
          mode,
          "-w",
          `${testDir}/work`,
        ]);
        const output = result.stdout + result.stderr;
        assert.ok(
          !output.includes("Invalid merge mode"),
          `Should accept --merge ${mode}`
        );
      }
    });

    test("rejects invalid --merge-strategy value", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "--merge-strategy",
        "invalid-strategy",
        "-w",
        `${testDir}/work`,
      ]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("Invalid merge strategy") ||
          output.includes("merge, squash, rebase"),
        "Should show validation error for invalid merge strategy"
      );
    });

    test("accepts valid --merge-strategy values", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
      );

      // Test each valid merge strategy
      for (const strategy of ["merge", "squash", "rebase"]) {
        const result = runCLI([
          "-c",
          testConfigPath,
          "--dry-run",
          "--merge-strategy",
          strategy,
          "-w",
          `${testDir}/work`,
        ]);
        const output = result.stdout + result.stderr;
        assert.ok(
          !output.includes("Invalid merge strategy"),
          `Should accept --merge-strategy ${strategy}`
        );
      }
    });

    test("accepts --delete-branch flag", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "--delete-branch",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      // Should not error on parsing - if it gets to loading config, flag was accepted
      assert.ok(
        output.includes("Loading config") || output.includes("Processing"),
        "Should accept --delete-branch flag"
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
`
      );

      const result = runCLI(["-c", testConfigPath, "--dry-run"]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("files") || output.includes("required"),
        "Should mention missing files"
      );
    });

    test("fails with missing repos", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
`
      );

      const result = runCLI(["-c", testConfigPath, "--dry-run"]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("repos") || output.includes("required"),
        "Should mention missing repos"
      );
    });
  });

  describe("output formatting", () => {
    test("displays repository count", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo1.git
  - git: git@github.com:test/repo2.git
`
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
        "Should display repository count"
      );
    });

    test("displays target file name", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  my-config.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
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
        "Should display target file name"
      );
    });

    test("displays branch name for config", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  my-config.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
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
        "Should display branch name"
      );
    });

    test("displays multiple file names (2-3 files)", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  config.json:
    content:
      key: value
  settings.yaml:
    content:
      setting: true
repos:
  - git: git@github.com:test/repo.git
`
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      // Should show file names joined with comma
      assert.ok(
        output.includes("config.json") && output.includes("settings.yaml"),
        "Should display multiple file names"
      );
    });

    test("displays file count for more than 3 files", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  config1.json:
    content:
      key: value1
  config2.json:
    content:
      key: value2
  config3.json:
    content:
      key: value3
  config4.json:
    content:
      key: value4
repos:
  - git: git@github.com:test/repo.git
`
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      // Should show "4 files" instead of listing all
      assert.ok(
        output.includes("4 files"),
        "Should display file count for >3 files"
      );
    });

    test("uses default branch name for multiple files", () => {
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  config.json:
    content:
      key: value
  settings.yaml:
    content:
      setting: true
repos:
  - git: git@github.com:test/repo.git
`
      );

      const result = runCLI([
        "-c",
        testConfigPath,
        "--dry-run",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      // With multiple files and no --branch, should use chore/sync-config
      assert.ok(
        output.includes("chore/sync-config"),
        "Should use default branch name for multiple files"
      );
    });
  });

  describe("GitHub Actions job summary", () => {
    test("writes summary to GITHUB_STEP_SUMMARY when set", () => {
      const summaryPath = join(testDir, "step-summary.md");
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`
      );

      // Run CLI with GITHUB_STEP_SUMMARY set
      runCLI(["-c", testConfigPath, "--dry-run", "-w", `${testDir}/work`], {
        env: { GITHUB_STEP_SUMMARY: summaryPath },
      });

      // Verify summary file was created
      assert.ok(existsSync(summaryPath), "Summary file should be created");

      const summary = readFileSync(summaryPath, "utf-8");

      // Verify summary content
      assert.ok(
        summary.includes("## Config Sync Summary"),
        "Should have summary header"
      );
      assert.ok(
        summary.includes("| Status | Count |"),
        "Should have stats table"
      );
      assert.ok(summary.includes("Total"), "Should show total count");
    });

    test("does not write summary when GITHUB_STEP_SUMMARY not set", () => {
      const summaryPath = join(testDir, "step-summary.md");
      writeFileSync(
        testConfigPath,
        `
id: test-config
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/invalid-repo-for-test.git
`
      );

      // Run CLI without GITHUB_STEP_SUMMARY
      runCLI(["-c", testConfigPath, "--dry-run", "-w", `${testDir}/work`]);

      // Verify summary file was NOT created
      assert.ok(
        !existsSync(summaryPath),
        "Summary file should not be created when env var not set"
      );
    });
  });
});

// Import helper functions for unit testing
import {
  getMergeOutcome,
  toFileChanges,
  buildRepoResult,
  buildErrorResult,
} from "./summary-utils.js";
import { ProcessorResult } from "./repository-processor.js";
import { RepoConfig } from "./config.js";

describe("getMergeOutcome", () => {
  test("returns undefined for failed result", () => {
    const repoConfig = { git: "git@github.com:test/repo.git", files: [] };
    const result: ProcessorResult = {
      success: false,
      repoName: "test/repo",
      message: "Failed",
    };

    assert.equal(getMergeOutcome(repoConfig, result), undefined);
  });

  test("returns undefined for skipped result", () => {
    const repoConfig = { git: "git@github.com:test/repo.git", files: [] };
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "No changes",
      skipped: true,
    };

    assert.equal(getMergeOutcome(repoConfig, result), undefined);
  });

  test("returns 'direct' for direct merge mode", () => {
    const repoConfig: RepoConfig = {
      git: "git@github.com:test/repo.git",
      files: [],
      prOptions: { merge: "direct" },
    };
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "Pushed",
    };

    assert.equal(getMergeOutcome(repoConfig, result), "direct");
  });

  test("returns 'force' when PR was merged", () => {
    const repoConfig = { git: "git@github.com:test/repo.git", files: [] };
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "PR merged",
      prUrl: "https://github.com/test/repo/pull/1",
      mergeResult: { merged: true, message: "Merged" },
    };

    assert.equal(getMergeOutcome(repoConfig, result), "force");
  });

  test("returns 'auto' when auto-merge enabled", () => {
    const repoConfig = { git: "git@github.com:test/repo.git", files: [] };
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "Auto-merge enabled",
      prUrl: "https://github.com/test/repo/pull/1",
      mergeResult: { merged: false, autoMergeEnabled: true, message: "OK" },
    };

    assert.equal(getMergeOutcome(repoConfig, result), "auto");
  });

  test("returns 'manual' when PR created without merge", () => {
    const repoConfig = { git: "git@github.com:test/repo.git", files: [] };
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "PR created",
      prUrl: "https://github.com/test/repo/pull/1",
    };

    assert.equal(getMergeOutcome(repoConfig, result), "manual");
  });

  test("returns undefined when no prUrl and not direct mode", () => {
    const repoConfig = { git: "git@github.com:test/repo.git", files: [] };
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "Done",
    };

    assert.equal(getMergeOutcome(repoConfig, result), undefined);
  });
});

describe("toFileChanges", () => {
  test("returns undefined when diffStats is undefined", () => {
    assert.equal(toFileChanges(undefined), undefined);
  });

  test("converts DiffStats to FileChanges", () => {
    const diffStats = {
      newCount: 2,
      modifiedCount: 3,
      deletedCount: 1,
      unchangedCount: 5,
    };

    const result = toFileChanges(diffStats);

    assert.deepEqual(result, {
      added: 2,
      modified: 3,
      deleted: 1,
      unchanged: 5,
    });
  });

  test("handles zero counts", () => {
    const diffStats = {
      newCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      unchangedCount: 0,
    };

    const result = toFileChanges(diffStats);

    assert.deepEqual(result, {
      added: 0,
      modified: 0,
      deleted: 0,
      unchanged: 0,
    });
  });
});

describe("buildRepoResult", () => {
  const repoConfig: RepoConfig = {
    git: "git@github.com:test/repo.git",
    files: [],
  };

  test("builds skipped result", () => {
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "No changes",
      skipped: true,
      diffStats: {
        newCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        unchangedCount: 2,
      },
    };

    const repoResult = buildRepoResult("test/repo", repoConfig, result);

    assert.equal(repoResult.status, "skipped");
    assert.equal(repoResult.message, "No changes");
    assert.deepEqual(repoResult.fileChanges, {
      added: 0,
      modified: 0,
      deleted: 0,
      unchanged: 2,
    });
  });

  test("builds succeeded result with PR", () => {
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "PR created",
      prUrl: "https://github.com/test/repo/pull/1",
      diffStats: {
        newCount: 1,
        modifiedCount: 2,
        deletedCount: 0,
        unchangedCount: 0,
      },
    };

    const repoResult = buildRepoResult("test/repo", repoConfig, result);

    assert.equal(repoResult.status, "succeeded");
    assert.ok(repoResult.message.includes("PR:"));
    assert.equal(repoResult.prUrl, "https://github.com/test/repo/pull/1");
    assert.equal(repoResult.mergeOutcome, "manual");
  });

  test("builds succeeded result with merged PR", () => {
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "PR merged",
      prUrl: "https://github.com/test/repo/pull/1",
      mergeResult: { merged: true, message: "Merged" },
    };

    const repoResult = buildRepoResult("test/repo", repoConfig, result);

    assert.equal(repoResult.status, "succeeded");
    assert.ok(repoResult.message.includes("(merged)"));
    assert.equal(repoResult.mergeOutcome, "force");
  });

  test("builds succeeded result with auto-merge", () => {
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "Auto-merge enabled",
      prUrl: "https://github.com/test/repo/pull/1",
      mergeResult: { merged: false, autoMergeEnabled: true, message: "OK" },
    };

    const repoResult = buildRepoResult("test/repo", repoConfig, result);

    assert.equal(repoResult.status, "succeeded");
    assert.ok(repoResult.message.includes("(auto-merge enabled)"));
    assert.equal(repoResult.mergeOutcome, "auto");
  });

  test("builds succeeded result for direct push", () => {
    const directConfig: RepoConfig = {
      git: "git@github.com:test/repo.git",
      files: [],
      prOptions: { merge: "direct" },
    };
    const result: ProcessorResult = {
      success: true,
      repoName: "test/repo",
      message: "Pushed to main",
    };

    const repoResult = buildRepoResult("test/repo", directConfig, result);

    assert.equal(repoResult.status, "succeeded");
    assert.equal(repoResult.message, "Pushed to main");
    assert.equal(repoResult.mergeOutcome, "direct");
  });

  test("builds failed result", () => {
    const result: ProcessorResult = {
      success: false,
      repoName: "test/repo",
      message: "Clone failed",
    };

    const repoResult = buildRepoResult("test/repo", repoConfig, result);

    assert.equal(repoResult.status, "failed");
    assert.equal(repoResult.message, "Clone failed");
  });
});

describe("buildErrorResult", () => {
  test("builds error result from Error object", () => {
    const error = new Error("Network timeout");

    const result = buildErrorResult("test/repo", error);

    assert.equal(result.status, "failed");
    assert.equal(result.repoName, "test/repo");
    assert.equal(result.message, "Network timeout");
  });

  test("builds error result from string", () => {
    const result = buildErrorResult("test/repo", "Something went wrong");

    assert.equal(result.status, "failed");
    assert.equal(result.message, "Something went wrong");
  });

  test("builds error result from unknown type", () => {
    const result = buildErrorResult("test/repo", { code: 500 });

    assert.equal(result.status, "failed");
    assert.equal(result.message, "[object Object]");
  });
});
