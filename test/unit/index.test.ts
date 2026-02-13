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
// Unsets GITHUB_STEP_SUMMARY by default so tests don't write to CI summary
function runCLI(
  args: string[],
  options?: { timeout?: number; env?: Record<string, string | undefined> }
): { stdout: string; stderr: string; success: boolean } {
  // Unset GITHUB_STEP_SUMMARY unless explicitly provided
  const { GITHUB_STEP_SUMMARY: _stepSummary, ...envWithoutSummary } =
    process.env;
  const testEnv = { ...envWithoutSummary, ...options?.env };

  try {
    const stdout = execFileSync(
      "node",
      ["--import", "tsx", "src/cli.ts", ...args],
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
      const result = runCLI(["sync", "--help"]);
      assert.ok(result.stdout.includes("xfg"));
      assert.ok(result.stdout.includes("-c, --config"));
      assert.ok(result.stdout.includes("-d, --dry-run"));
      assert.ok(result.stdout.includes("-w, --work-dir"));
      assert.ok(result.stdout.includes("-r, --retries"));
      assert.ok(result.stdout.includes("-b, --branch"));
    });

    test("requires --config option", () => {
      const result = runCLI(["sync"]);
      assert.equal(result.success, false);
      assert.ok(
        result.stderr.includes("required") || result.stderr.includes("--config")
      );
    });

    test("fails with non-existent config file", () => {
      const result = runCLI(["sync", "-c", "/nonexistent/config.yaml"]);
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
        "sync",
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
        "sync",
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
        "sync",
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
        "sync",
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
        "sync",
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
        "sync",
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
        "sync",
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
        "sync",
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
          "sync",
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
        "sync",
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
          "sync",
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
        "sync",
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

    test("sync command fails with settings-only config", () => {
      writeFileSync(
        testConfigPath,
        `
id: settings-only
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
repos:
  - git: git@github.com:test/repo.git
`
      );

      const result = runCLI(["sync", "-c", testConfigPath, "--dry-run"]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("'sync' command requires a 'files' section") ||
          output.includes("requires a 'files' section"),
        `Expected files requirement error, got: ${output}`
      );
    });

    test("settings command fails with files-only config", () => {
      writeFileSync(
        testConfigPath,
        `
id: files-only
files:
  config.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
      );

      const result = runCLI(["settings", "-c", testConfigPath, "--dry-run"]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("'settings' command requires") ||
          output.includes("No actionable settings"),
        `Expected settings requirement error, got: ${output}`
      );
    });

    test("settings command succeeds with settings-only config", () => {
      writeFileSync(
        testConfigPath,
        `
id: settings-only
settings:
  rulesets:
    main-protection:
      target: branch
      enforcement: active
      conditions:
        refName:
          include: ["refs/heads/main"]
          exclude: []
repos:
  - git: git@github.com:test/invalid-repo.git
`
      );

      // Will fail on API call but should get past validation
      const result = runCLI([
        "settings",
        "-c",
        testConfigPath,
        "--dry-run",
        "-w",
        `${testDir}/work`,
      ]);
      const output = result.stdout + result.stderr;
      // Should show it's processing, not validation error
      assert.ok(
        output.includes("Loading config") ||
          output.includes("repositories with rulesets"),
        `Expected processing output, got: ${output}`
      );
    });
  });

  describe("config validation", () => {
    test("fails with invalid YAML", () => {
      writeFileSync(testConfigPath, "invalid: yaml: content: [");

      const result = runCLI(["sync", "-c", testConfigPath, "--dry-run"]);
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

      const result = runCLI(["sync", "-c", testConfigPath, "--dry-run"]);
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

      const result = runCLI(["sync", "-c", testConfigPath, "--dry-run"]);
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
        "sync",
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
        "sync",
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
        "sync",
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
        "sync",
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
        "sync",
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
        "sync",
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
      runCLI(
        ["sync", "-c", testConfigPath, "--dry-run", "-w", `${testDir}/work`],
        {
          env: { GITHUB_STEP_SUMMARY: summaryPath },
        }
      );

      // Verify summary file was created
      assert.ok(existsSync(summaryPath), "Summary file should be created");

      const summary = readFileSync(summaryPath, "utf-8");

      // Verify summary content - unified summary format
      assert.ok(summary.includes("## xfg Plan"), "Should have summary header");
      // The summary uses **Plan: or **No changes**
      assert.ok(
        summary.includes("**Plan:") || summary.includes("**No changes**"),
        "Should have plan summary line"
      );
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
      runCLI([
        "sync",
        "-c",
        testConfigPath,
        "--dry-run",
        "-w",
        `${testDir}/work`,
      ]);

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
} from "../../src/output/summary-utils.js";
import { ProcessorResult } from "../../src/sync/repository-processor.js";
import { RepoConfig } from "../../src/config/index.js";

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

// =============================================================================
// Settings Command Tests (CLI argument parsing only)
// =============================================================================

const settingsTestDir = join(process.cwd(), "test-settings-cli-tmp");
const settingsTestConfigPath = join(settingsTestDir, "settings-config.yaml");

describe("settings command CLI", () => {
  beforeEach(() => {
    if (existsSync(settingsTestDir)) {
      rmSync(settingsTestDir, { recursive: true, force: true });
    }
    mkdirSync(settingsTestDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(settingsTestDir)) {
      rmSync(settingsTestDir, { recursive: true, force: true });
    }
  });

  describe("argument parsing", () => {
    test("shows help with settings --help", () => {
      const result = runCLI(["settings", "--help"]);
      assert.ok(result.stdout.includes("settings"));
      assert.ok(result.stdout.includes("-c, --config"));
      assert.ok(result.stdout.includes("-d, --dry-run"));
      assert.ok(result.stdout.includes("--no-delete"));
    });

    test("requires --config option", () => {
      const result = runCLI(["settings"]);
      assert.equal(result.success, false);
      assert.ok(
        result.stderr.includes("required") || result.stderr.includes("--config")
      );
    });

    test("fails with non-existent config file", () => {
      const result = runCLI(["settings", "-c", "/nonexistent/config.yaml"]);
      assert.equal(result.success, false);
      const output = result.stdout + result.stderr;
      assert.ok(output.includes("Config file not found"));
    });
  });

  describe("config validation", () => {
    test("fails when no settings configured", () => {
      writeFileSync(
        settingsTestConfigPath,
        `
id: test-settings
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
`
      );

      const result = runCLI(["settings", "-c", settingsTestConfigPath]);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("'settings' command requires") ||
          output.includes("No actionable settings"),
        `Should show settings requirement error, got: ${output}`
      );
      assert.equal(result.success, false, "Should fail when no settings");
    });

    test("fails when rulesets object is empty", () => {
      writeFileSync(
        settingsTestConfigPath,
        `
id: test-settings
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test/repo.git
    settings:
      rulesets: {}
`
      );

      const result = runCLI(["settings", "-c", settingsTestConfigPath]);
      const output = result.stdout + result.stderr;
      assert.ok(
        output.includes("No actionable settings") ||
          output.includes("'settings' command requires"),
        `Should show actionable settings error, got: ${output}`
      );
      assert.equal(result.success, false, "Should fail with empty rulesets");
    });
  });
});

// =============================================================================
// Settings Command Unit Tests (with mocked processor)
// =============================================================================

import {
  runSettings,
  IRulesetProcessor,
  RulesetProcessorFactory,
} from "../../src/index.js";
import type { RulesetProcessorResult } from "../../src/ruleset-processor.js";
import type { IRepoLifecycleManager } from "../../src/lifecycle/types.js";

/**
 * Noop lifecycle manager for tests - always returns "existed".
 */
const noopLifecycleManager: IRepoLifecycleManager = {
  async ensureRepo(_repoConfig, repoInfo) {
    return { repoInfo, action: "existed" };
  },
};

// Mock for repository processor used by settings command for manifest updates
class MockSettingsRepoProcessor implements IRepositoryProcessor {
  manifestCalls: {
    repoInfo: unknown;
    repoConfig: RepoConfig;
    options: unknown;
    manifestUpdate: { rulesets: string[] };
  }[] = [];

  async process(
    repoConfig: RepoConfig,
    _repoInfo: unknown,
    _options: unknown
  ): Promise<ProcessorResult> {
    return {
      success: true,
      repoName: repoConfig.git,
      message: "Mock process",
    };
  }

  async updateManifestOnly(
    repoInfo: unknown,
    repoConfig: RepoConfig,
    options: unknown,
    manifestUpdate: { rulesets: string[] }
  ): Promise<ProcessorResult> {
    this.manifestCalls.push({ repoInfo, repoConfig, options, manifestUpdate });
    return {
      success: true,
      repoName: repoConfig.git,
      message: "Manifest updated",
    };
  }

  reset(): void {
    this.manifestCalls = [];
  }
}

class MockRulesetProcessor implements IRulesetProcessor {
  calls: { repoConfig: RepoConfig; repoInfo: unknown; options: unknown }[] = [];
  results: Map<string, RulesetProcessorResult> = new Map();

  async process(
    repoConfig: RepoConfig,
    repoInfo: unknown,
    options: unknown
  ): Promise<RulesetProcessorResult> {
    this.calls.push({ repoConfig, repoInfo, options });

    const result = this.results.get(repoConfig.git);
    if (result) {
      return result;
    }

    // Default success response
    return {
      success: true,
      repoName: repoConfig.git,
      message: "Mock success",
      changes: { create: 1, update: 0, delete: 0, unchanged: 0 },
    };
  }

  setResult(gitUrl: string, result: RulesetProcessorResult): void {
    this.results.set(gitUrl, result);
  }

  reset(): void {
    this.calls = [];
    this.results.clear();
  }
}

const unitTestDir = join(process.cwd(), "test-settings-unit-tmp");
const unitTestConfigPath = join(unitTestDir, "settings-config.yaml");

describe("runSettings with mock processor", () => {
  let mockProcessor: MockRulesetProcessor;
  let mockFactory: RulesetProcessorFactory;

  beforeEach(() => {
    mockProcessor = new MockRulesetProcessor();
    mockFactory = () => mockProcessor;

    if (existsSync(unitTestDir)) {
      rmSync(unitTestDir, { recursive: true, force: true });
    }
    mkdirSync(unitTestDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(unitTestDir)) {
      rmSync(unitTestDir, { recursive: true, force: true });
    }
  });

  test("processes GitHub repos with rulesets", async () => {
    writeFileSync(
      unitTestConfigPath,
      `
id: test-settings
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/test-repo.git
    settings:
      rulesets:
        main-protection:
          target: branch
          enforcement: active
          rules: []
`
    );

    await runSettings(
      { config: unitTestConfigPath },
      mockFactory,
      undefined,
      undefined,
      noopLifecycleManager
    );

    assert.equal(mockProcessor.calls.length, 1);
    assert.equal(
      mockProcessor.calls[0].repoConfig.git,
      "git@github.com:test-org/test-repo.git"
    );
  });

  test("skips non-GitHub repos without calling processor", async () => {
    writeFileSync(
      unitTestConfigPath,
      `
id: test-settings
files:
  test.json:
    content:
      key: value
repos:
  - git: git@ssh.dev.azure.com:v3/org/project/repo
    settings:
      rulesets:
        main-protection:
          target: branch
          enforcement: active
          rules: []
`
    );

    await runSettings(
      { config: unitTestConfigPath },
      mockFactory,
      undefined,
      undefined,
      noopLifecycleManager
    );

    // Processor should not be called for non-GitHub repos
    assert.equal(mockProcessor.calls.length, 0);
  });

  test("passes dry run option to processor", async () => {
    writeFileSync(
      unitTestConfigPath,
      `
id: test-settings
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/test-repo.git
    settings:
      rulesets:
        main-protection:
          target: branch
          enforcement: active
          rules: []
`
    );

    await runSettings(
      { config: unitTestConfigPath, dryRun: true },
      mockFactory,
      undefined,
      undefined,
      noopLifecycleManager
    );

    assert.equal(mockProcessor.calls.length, 1);
    const options = mockProcessor.calls[0].options as { dryRun?: boolean };
    assert.equal(options.dryRun, true);
  });

  test("passes noDelete option to processor", async () => {
    writeFileSync(
      unitTestConfigPath,
      `
id: test-settings
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/test-repo.git
    settings:
      rulesets:
        main-protection:
          target: branch
          enforcement: active
          rules: []
`
    );

    await runSettings(
      { config: unitTestConfigPath, noDelete: true },
      mockFactory,
      undefined,
      undefined,
      noopLifecycleManager
    );

    assert.equal(mockProcessor.calls.length, 1);
    const options = mockProcessor.calls[0].options as { noDelete?: boolean };
    assert.equal(options.noDelete, true);
  });

  // Note: Failure cases (processor.success=false, processor throws) are not tested here
  // because they trigger process.exit(1) which terminates the test runner.
  // Failure handling is covered in ruleset-processor.test.ts with proper mocking.

  test("processes multiple repos", async () => {
    writeFileSync(
      unitTestConfigPath,
      `
id: test-settings
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/repo1.git
    settings:
      rulesets:
        main-protection:
          target: branch
          enforcement: active
          rules: []
  - git: git@github.com:test-org/repo2.git
    settings:
      rulesets:
        dev-protection:
          target: branch
          enforcement: evaluate
          rules: []
`
    );

    await runSettings(
      { config: unitTestConfigPath },
      mockFactory,
      undefined,
      undefined,
      noopLifecycleManager
    );

    assert.equal(mockProcessor.calls.length, 2);
    assert.equal(
      mockProcessor.calls[0].repoConfig.git,
      "git@github.com:test-org/repo1.git"
    );
    assert.equal(
      mockProcessor.calls[1].repoConfig.git,
      "git@github.com:test-org/repo2.git"
    );
  });

  test("skips repos without rulesets in mixed config", async () => {
    writeFileSync(
      unitTestConfigPath,
      `
id: test-settings
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/repo-with-rulesets.git
    settings:
      rulesets:
        main-protection:
          target: branch
          enforcement: active
          rules: []
  - git: git@github.com:test-org/repo-without-rulesets.git
`
    );

    await runSettings(
      { config: unitTestConfigPath },
      mockFactory,
      undefined,
      undefined,
      noopLifecycleManager
    );

    // Only the repo with rulesets should be processed
    assert.equal(mockProcessor.calls.length, 1);
    assert.equal(
      mockProcessor.calls[0].repoConfig.git,
      "git@github.com:test-org/repo-with-rulesets.git"
    );
  });

  test("calls updateManifestOnly when result has rulesets to track", async () => {
    writeFileSync(
      unitTestConfigPath,
      `
id: test-settings
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/test-repo.git
    settings:
      rulesets:
        main-protection:
          target: branch
          enforcement: active
          rules: []
`
    );

    // Configure mock to return manifestUpdate with rulesets
    mockProcessor.setResult("git@github.com:test-org/test-repo.git", {
      success: true,
      repoName: "test-org/test-repo",
      message: "Applied rulesets",
      changes: { create: 1, update: 0, delete: 0, unchanged: 0 },
      manifestUpdate: {
        rulesets: ["main-protection"],
      },
    });

    // Create a mock repository processor to track updateManifestOnly calls
    const mockRepoProcessor = new MockSettingsRepoProcessor();
    const mockRepoProcessorFactory: ProcessorFactory = () => mockRepoProcessor;

    await runSettings(
      { config: unitTestConfigPath },
      mockFactory,
      mockRepoProcessorFactory,
      undefined,
      noopLifecycleManager
    );

    // Verify updateManifestOnly was called with the manifest update
    assert.equal(mockRepoProcessor.manifestCalls.length, 1);
    assert.deepEqual(mockRepoProcessor.manifestCalls[0].manifestUpdate, {
      rulesets: ["main-protection"],
    });
  });
});

// =============================================================================
// Sync Command Unit Tests (with mocked processor)
// =============================================================================

import {
  runSync,
  IRepositoryProcessor,
  ProcessorFactory,
} from "../../src/index.js";

class MockRepositoryProcessor implements IRepositoryProcessor {
  calls: { repoConfig: RepoConfig; repoInfo: unknown; options: unknown }[] = [];
  manifestCalls: {
    repoInfo: unknown;
    repoConfig: RepoConfig;
    options: unknown;
    manifestUpdate: { rulesets: string[] };
  }[] = [];
  results: Map<string, ProcessorResult> = new Map();

  async process(
    repoConfig: RepoConfig,
    repoInfo: unknown,
    options: unknown
  ): Promise<ProcessorResult> {
    this.calls.push({ repoConfig, repoInfo, options });

    const result = this.results.get(repoConfig.git);
    if (result) {
      return result;
    }

    // Default success response
    return {
      success: true,
      repoName: repoConfig.git,
      message: "Mock success",
    };
  }

  async updateManifestOnly(
    repoInfo: unknown,
    repoConfig: RepoConfig,
    options: unknown,
    manifestUpdate: { rulesets: string[] }
  ): Promise<ProcessorResult> {
    this.manifestCalls.push({ repoInfo, repoConfig, options, manifestUpdate });
    return {
      success: true,
      repoName: repoConfig.git,
      message: "Manifest updated",
    };
  }

  setResult(gitUrl: string, result: ProcessorResult): void {
    this.results.set(gitUrl, result);
  }

  reset(): void {
    this.calls = [];
    this.manifestCalls = [];
    this.results.clear();
  }
}

const syncUnitTestDir = join(process.cwd(), "test-sync-unit-tmp");
const syncUnitTestConfigPath = join(syncUnitTestDir, "sync-config.yaml");

describe("runSync with mock processor", () => {
  let mockProcessor: MockRepositoryProcessor;
  let mockFactory: ProcessorFactory;

  beforeEach(() => {
    mockProcessor = new MockRepositoryProcessor();
    mockFactory = () => mockProcessor;

    if (existsSync(syncUnitTestDir)) {
      rmSync(syncUnitTestDir, { recursive: true, force: true });
    }
    mkdirSync(syncUnitTestDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(syncUnitTestDir)) {
      rmSync(syncUnitTestDir, { recursive: true, force: true });
    }
  });

  test("processes repos with files", async () => {
    writeFileSync(
      syncUnitTestConfigPath,
      `
id: test-sync
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/test-repo.git
`
    );

    await runSync(
      { config: syncUnitTestConfigPath },
      mockFactory,
      noopLifecycleManager
    );

    assert.equal(mockProcessor.calls.length, 1);
    assert.equal(
      mockProcessor.calls[0].repoConfig.git,
      "git@github.com:test-org/test-repo.git"
    );
  });

  test("passes dry run option to processor", async () => {
    writeFileSync(
      syncUnitTestConfigPath,
      `
id: test-sync
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/test-repo.git
`
    );

    await runSync(
      { config: syncUnitTestConfigPath, dryRun: true },
      mockFactory,
      noopLifecycleManager
    );

    assert.equal(mockProcessor.calls.length, 1);
    const options = mockProcessor.calls[0].options as { dryRun?: boolean };
    assert.equal(options.dryRun, true);
  });

  test("passes branch name to processor", async () => {
    writeFileSync(
      syncUnitTestConfigPath,
      `
id: test-sync
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/test-repo.git
`
    );

    await runSync(
      { config: syncUnitTestConfigPath, branch: "feature/custom-branch" },
      mockFactory,
      noopLifecycleManager
    );

    assert.equal(mockProcessor.calls.length, 1);
    const options = mockProcessor.calls[0].options as { branchName?: string };
    assert.equal(options.branchName, "feature/custom-branch");
  });

  test("processes multiple repos", async () => {
    writeFileSync(
      syncUnitTestConfigPath,
      `
id: test-sync
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/repo1.git
  - git: git@github.com:test-org/repo2.git
`
    );

    await runSync(
      { config: syncUnitTestConfigPath },
      mockFactory,
      noopLifecycleManager
    );

    assert.equal(mockProcessor.calls.length, 2);
    assert.equal(
      mockProcessor.calls[0].repoConfig.git,
      "git@github.com:test-org/repo1.git"
    );
    assert.equal(
      mockProcessor.calls[1].repoConfig.git,
      "git@github.com:test-org/repo2.git"
    );
  });

  test("passes noDelete option to processor", async () => {
    writeFileSync(
      syncUnitTestConfigPath,
      `
id: test-sync
files:
  test.json:
    content:
      key: value
repos:
  - git: git@github.com:test-org/test-repo.git
`
    );

    await runSync(
      { config: syncUnitTestConfigPath, noDelete: true },
      mockFactory,
      noopLifecycleManager
    );

    assert.equal(mockProcessor.calls.length, 1);
    const options = mockProcessor.calls[0].options as { noDelete?: boolean };
    assert.equal(options.noDelete, true);
  });
});
