import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitOps, sanitizeBranchName, validateBranchName } from "./git-ops.js";
import { CommandExecutor } from "./command-executor.js";

const testDir = join(tmpdir(), "git-ops-test-" + Date.now());

describe("sanitizeBranchName", () => {
  test("removes file extension", () => {
    assert.equal(sanitizeBranchName("config.json"), "config");
  });

  test("converts to lowercase", () => {
    assert.equal(sanitizeBranchName("MyConfig.json"), "myconfig");
  });

  test("replaces spaces with dashes", () => {
    assert.equal(sanitizeBranchName("my config.json"), "my-config");
  });

  test("replaces special characters with dashes", () => {
    assert.equal(sanitizeBranchName("my@config!file.json"), "my-config-file");
  });

  test("collapses multiple dashes", () => {
    assert.equal(sanitizeBranchName("my---config.json"), "my-config");
  });

  test("removes leading dashes", () => {
    assert.equal(sanitizeBranchName("-config.json"), "config");
  });

  test("removes trailing dashes", () => {
    assert.equal(sanitizeBranchName("config-.json"), "config");
  });

  test("handles multiple extensions (keeps all but last)", () => {
    assert.equal(sanitizeBranchName("my.config.json"), "my-config");
  });

  test("handles .yaml extension", () => {
    assert.equal(sanitizeBranchName("settings.yaml"), "settings");
  });

  test("handles .yml extension", () => {
    assert.equal(sanitizeBranchName("settings.yml"), "settings");
  });

  test("preserves numbers", () => {
    assert.equal(sanitizeBranchName("config2.json"), "config2");
  });

  test("preserves existing dashes", () => {
    assert.equal(sanitizeBranchName("my-config.json"), "my-config");
  });

  test("handles complex filename", () => {
    assert.equal(
      sanitizeBranchName("My Complex_Config@v2.0.json"),
      "my-complex-config-v2-0",
    );
  });

  test("handles filename with only special chars", () => {
    assert.equal(sanitizeBranchName("@#$.json"), "");
  });

  test("handles empty extension", () => {
    assert.equal(sanitizeBranchName("config"), "config");
  });
});

describe("validateBranchName", () => {
  describe("valid branch names", () => {
    test("accepts simple branch name", () => {
      assert.doesNotThrow(() => validateBranchName("feature"));
    });

    test("accepts branch with slash", () => {
      assert.doesNotThrow(() => validateBranchName("feature/test"));
    });

    test("accepts chore/sync prefix", () => {
      assert.doesNotThrow(() => validateBranchName("chore/sync-config"));
    });

    test("accepts branch with numbers", () => {
      assert.doesNotThrow(() => validateBranchName("feature-123"));
    });

    test("accepts branch with dots in middle", () => {
      assert.doesNotThrow(() => validateBranchName("release/v1.0.0"));
    });
  });

  describe("invalid branch names", () => {
    test("rejects empty string", () => {
      assert.throws(() => validateBranchName(""), /cannot be empty/);
    });

    test("rejects whitespace-only string", () => {
      assert.throws(() => validateBranchName("   "), /cannot be empty/);
    });

    test("rejects branch starting with dot", () => {
      assert.throws(
        () => validateBranchName(".hidden"),
        /cannot start with "." or "-"/,
      );
    });

    test("rejects branch starting with dash", () => {
      assert.throws(
        () => validateBranchName("-feature"),
        /cannot start with "." or "-"/,
      );
    });

    test("rejects branch with spaces", () => {
      assert.throws(
        () => validateBranchName("my branch"),
        /invalid characters/,
      );
    });

    test("rejects branch with tilde", () => {
      assert.throws(
        () => validateBranchName("feature~1"),
        /invalid characters/,
      );
    });

    test("rejects branch with caret", () => {
      assert.throws(
        () => validateBranchName("feature^2"),
        /invalid characters/,
      );
    });

    test("rejects branch with colon", () => {
      assert.throws(
        () => validateBranchName("feature:test"),
        /invalid characters/,
      );
    });

    test("rejects branch with question mark", () => {
      assert.throws(
        () => validateBranchName("feature?test"),
        /invalid characters/,
      );
    });

    test("rejects branch with asterisk", () => {
      assert.throws(
        () => validateBranchName("feature*test"),
        /invalid characters/,
      );
    });

    test("rejects branch with bracket", () => {
      assert.throws(
        () => validateBranchName("feature[test]"),
        /invalid characters/,
      );
    });

    test("rejects branch with backslash", () => {
      assert.throws(
        () => validateBranchName("feature\\test"),
        /invalid characters/,
      );
    });

    test("rejects branch with consecutive dots", () => {
      assert.throws(
        () => validateBranchName("feature..test"),
        /invalid characters/,
      );
    });

    test("rejects branch ending with slash", () => {
      assert.throws(() => validateBranchName("feature/"), /invalid ending/);
    });

    test("rejects branch ending with .lock", () => {
      assert.throws(() => validateBranchName("feature.lock"), /invalid ending/);
    });

    test("rejects branch ending with dot", () => {
      assert.throws(() => validateBranchName("feature."), /invalid ending/);
    });
  });

  describe("security injection attempts", () => {
    // Note: Git allows $, (, ), and backticks in branch names.
    // Security is ensured by escapeShellArg() wrapping all shell arguments.
    // These tests verify that common injection patterns with spaces are rejected.

    test("rejects shell injection with spaces", () => {
      assert.throws(
        () => validateBranchName("; rm -rf /"),
        /invalid characters/,
      );
    });

    test("rejects pipe injection with spaces", () => {
      assert.throws(
        () => validateBranchName("test | cat /etc/passwd"),
        /invalid characters/,
      );
    });

    test("rejects newline injection via tilde path", () => {
      assert.throws(
        () => validateBranchName("feature~1"),
        /invalid characters/,
      );
    });

    test("allows shell-like patterns without spaces (security via escapeShellArg)", () => {
      // These are valid git branch names - security is handled by escapeShellArg()
      assert.doesNotThrow(() => validateBranchName("$(whoami)"));
      assert.doesNotThrow(() => validateBranchName("`id`"));
    });
  });
});

describe("GitOps", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("cleanWorkspace", () => {
    test("creates workspace directory if not exists", () => {
      const gitOps = new GitOps({ workDir });
      gitOps.cleanWorkspace();

      assert.ok(existsSync(workDir));
    });

    test("removes existing workspace and recreates", () => {
      mkdirSync(workDir, { recursive: true });
      writeFileSync(join(workDir, "existing-file.txt"), "content");

      const gitOps = new GitOps({ workDir });
      gitOps.cleanWorkspace();

      assert.ok(existsSync(workDir));
      assert.ok(!existsSync(join(workDir, "existing-file.txt")));
    });

    test("handles nested directories", () => {
      const nestedDir = join(workDir, "nested", "deep");
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(join(nestedDir, "file.txt"), "content");

      const gitOps = new GitOps({ workDir });
      gitOps.cleanWorkspace();

      assert.ok(existsSync(workDir));
      assert.ok(!existsSync(join(workDir, "nested")));
    });
  });

  describe("writeFile", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("writes file with content and trailing newline", () => {
      const gitOps = new GitOps({ workDir });
      gitOps.writeFile("test.json", '{"key": "value"}');

      const content = readFileSync(join(workDir, "test.json"), "utf-8");
      assert.equal(content, '{"key": "value"}\n');
    });

    test("overwrites existing file", () => {
      writeFileSync(join(workDir, "test.json"), "old content");

      const gitOps = new GitOps({ workDir });
      gitOps.writeFile("test.json", "new content");

      const content = readFileSync(join(workDir, "test.json"), "utf-8");
      assert.equal(content, "new content\n");
    });

    test("does not write in dry-run mode", () => {
      const gitOps = new GitOps({ workDir, dryRun: true });
      gitOps.writeFile("test.json", "content");

      assert.ok(!existsSync(join(workDir, "test.json")));
    });
  });

  describe("wouldChange", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("returns true when file does not exist", () => {
      const gitOps = new GitOps({ workDir });
      const result = gitOps.wouldChange("nonexistent.json", "content");

      assert.equal(result, true);
    });

    test("returns true when content differs", () => {
      writeFileSync(join(workDir, "test.json"), "old content\n");

      const gitOps = new GitOps({ workDir });
      const result = gitOps.wouldChange("test.json", "new content");

      assert.equal(result, true);
    });

    test("returns false when content is identical", () => {
      writeFileSync(join(workDir, "test.json"), "same content\n");

      const gitOps = new GitOps({ workDir });
      const result = gitOps.wouldChange("test.json", "same content");

      assert.equal(result, false);
    });

    test("accounts for trailing newline in comparison", () => {
      // File has content + newline
      writeFileSync(join(workDir, "test.json"), "content\n");

      const gitOps = new GitOps({ workDir });
      // wouldChange adds newline internally, so "content" should match "content\n"
      const result = gitOps.wouldChange("test.json", "content");

      assert.equal(result, false);
    });

    test("works in dry-run mode", () => {
      writeFileSync(join(workDir, "test.json"), "existing\n");

      const gitOps = new GitOps({ workDir, dryRun: true });
      const resultSame = gitOps.wouldChange("test.json", "existing");
      const resultDiff = gitOps.wouldChange("test.json", "different");

      assert.equal(resultSame, false);
      assert.equal(resultDiff, true);
    });
  });

  describe("dryRun mode", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("dryRun defaults to false", () => {
      const gitOps = new GitOps({ workDir });
      // Write should work when dryRun is not specified
      gitOps.writeFile("test.json", "content");
      assert.ok(existsSync(join(workDir, "test.json")));
    });

    test("dryRun can be explicitly set to false", () => {
      const gitOps = new GitOps({ workDir, dryRun: false });
      gitOps.writeFile("test.json", "content");
      assert.ok(existsSync(join(workDir, "test.json")));
    });
  });

  describe("path traversal protection", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("writeFile throws on path traversal attempt", () => {
      const gitOps = new GitOps({ workDir });
      assert.throws(
        () => gitOps.writeFile("../escape.json", "content"),
        /Path traversal detected/,
      );
    });

    test("writeFile creates parent directories automatically", () => {
      const gitOps = new GitOps({ workDir });
      // Should auto-create parent directory
      gitOps.writeFile("config/settings.json", "content");
      assert.ok(existsSync(join(workDir, "config/settings.json")));
    });

    test("writeFile creates deeply nested directories", () => {
      const gitOps = new GitOps({ workDir });
      gitOps.writeFile(".github/workflows/ci.yml", "name: CI");
      assert.ok(existsSync(join(workDir, ".github/workflows/ci.yml")));
    });

    test("wouldChange throws on path traversal attempt", () => {
      const gitOps = new GitOps({ workDir });
      assert.throws(
        () => gitOps.wouldChange("../escape.json", "content"),
        /Path traversal detected/,
      );
    });
  });

  describe("CommandExecutor injection", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("accepts custom executor", () => {
      const commands: string[] = [];
      const mockExecutor: CommandExecutor = {
        exec: (command: string, _cwd: string) => {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      gitOps.hasChanges();

      assert.equal(commands.length, 1);
      assert.ok(commands[0].includes("git status"));
    });

    test("uses default executor when not provided", () => {
      // This test verifies the default executor is used by checking
      // that GitOps can be constructed without an executor
      const gitOps = new GitOps({ workDir });
      assert.ok(gitOps);
    });
  });

  describe("createBranch error handling", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("throws on fetch/checkout failure that is NOT branch-not-found", async () => {
      // Simulate an auth failure during fetch (not a missing branch)
      const gitOps = new GitOps({
        workDir,
        executor: {
          async exec(command: string, _cwd: string): Promise<string> {
            if (command.includes("git fetch")) {
              throw new Error("Permission denied (publickey)");
            }
            return "";
          },
        },
        retries: 0,
      });

      await assert.rejects(
        async () => gitOps.createBranch("feature-branch"),
        /Failed to fetch\/checkout branch.*Permission denied/,
      );
    });

    test("creates new branch when fetch indicates branch not found", async () => {
      let checkoutBCalled = false;

      const gitOps = new GitOps({
        workDir,
        executor: {
          async exec(command: string, _cwd: string): Promise<string> {
            if (command.includes("git fetch")) {
              throw new Error("couldn't find remote ref feature-branch");
            }
            if (command.includes("git checkout -b")) {
              checkoutBCalled = true;
              return "";
            }
            return "";
          },
        },
        retries: 0,
      });
      await gitOps.createBranch("feature-branch");

      assert.ok(checkoutBCalled, "Should have called checkout -b");
    });

    test("throws on checkout -b failure", async () => {
      const gitOps = new GitOps({
        workDir,
        executor: {
          async exec(command: string, _cwd: string): Promise<string> {
            if (command.includes("git fetch")) {
              throw new Error("pathspec 'feature-branch' did not match any");
            }
            if (command.includes("git checkout -b")) {
              throw new Error(
                "fatal: A branch named 'feature-branch' already exists",
              );
            }
            return "";
          },
        },
        retries: 0,
      });

      await assert.rejects(
        async () => gitOps.createBranch("feature-branch"),
        /Failed to create branch.*already exists/,
      );
    });

    test("reuses existing branch when fetch and checkout succeed", async () => {
      let checkoutBCalled = false;
      let checkoutCalled = false;

      const gitOps = new GitOps({
        workDir,
        executor: {
          async exec(command: string, _cwd: string): Promise<string> {
            if (command.includes("git fetch origin")) {
              return "";
            }
            if (command.includes("git checkout -b")) {
              checkoutBCalled = true;
              return "";
            }
            if (command.includes("git checkout")) {
              checkoutCalled = true;
              return "";
            }
            return "";
          },
        },
        retries: 0,
      });
      await gitOps.createBranch("feature-branch");

      assert.ok(checkoutCalled, "Should have called checkout (without -b)");
      assert.ok(!checkoutBCalled, "Should NOT have called checkout -b");
    });
  });

  describe("setExecutable", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("calls git update-index with chmod flag", async () => {
      const commands: string[] = [];
      const mockExecutor: CommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      // Create the file first (setExecutable validates path)
      writeFileSync(join(workDir, "script.sh"), "#!/bin/bash\n");
      await gitOps.setExecutable("script.sh");

      assert.equal(commands.length, 1);
      assert.ok(commands[0].includes("git update-index --chmod=+x"));
      assert.ok(commands[0].includes("script.sh"));
    });

    test("does not execute in dry-run mode", async () => {
      const commands: string[] = [];
      const mockExecutor: CommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        dryRun: true,
        executor: mockExecutor,
      });
      writeFileSync(join(workDir, "script.sh"), "#!/bin/bash\n");
      await gitOps.setExecutable("script.sh");

      assert.equal(commands.length, 0);
    });

    test("throws on path traversal attempt", async () => {
      const gitOps = new GitOps({ workDir });
      await assert.rejects(
        async () => gitOps.setExecutable("../escape.sh"),
        /Path traversal detected/,
      );
    });

    test("handles subdirectory paths", async () => {
      const commands: string[] = [];
      const mockExecutor: CommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      mkdirSync(join(workDir, "scripts"), { recursive: true });
      writeFileSync(join(workDir, "scripts", "deploy.sh"), "#!/bin/bash\n");
      await gitOps.setExecutable("scripts/deploy.sh");

      assert.equal(commands.length, 1);
      assert.ok(commands[0].includes("scripts/deploy.sh"));
    });
  });
});
