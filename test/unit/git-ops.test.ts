import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  GitOps,
  sanitizeBranchName,
  validateBranchName,
} from "../../src/vcs/git-ops.js";
import { ICommandExecutor } from "../../src/shared/command-executor.js";

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
      "my-complex-config-v2-0"
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
        /cannot start with "." or "-"/
      );
    });

    test("rejects branch starting with dash", () => {
      assert.throws(
        () => validateBranchName("-feature"),
        /cannot start with "." or "-"/
      );
    });

    test("rejects branch with spaces", () => {
      assert.throws(
        () => validateBranchName("my branch"),
        /invalid characters/
      );
    });

    test("rejects branch with tilde", () => {
      assert.throws(
        () => validateBranchName("feature~1"),
        /invalid characters/
      );
    });

    test("rejects branch with caret", () => {
      assert.throws(
        () => validateBranchName("feature^2"),
        /invalid characters/
      );
    });

    test("rejects branch with colon", () => {
      assert.throws(
        () => validateBranchName("feature:test"),
        /invalid characters/
      );
    });

    test("rejects branch with question mark", () => {
      assert.throws(
        () => validateBranchName("feature?test"),
        /invalid characters/
      );
    });

    test("rejects branch with asterisk", () => {
      assert.throws(
        () => validateBranchName("feature*test"),
        /invalid characters/
      );
    });

    test("rejects branch with bracket", () => {
      assert.throws(
        () => validateBranchName("feature[test]"),
        /invalid characters/
      );
    });

    test("rejects branch with backslash", () => {
      assert.throws(
        () => validateBranchName("feature\\test"),
        /invalid characters/
      );
    });

    test("rejects branch with consecutive dots", () => {
      assert.throws(
        () => validateBranchName("feature..test"),
        /invalid characters/
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
        /invalid characters/
      );
    });

    test("rejects pipe injection with spaces", () => {
      assert.throws(
        () => validateBranchName("test | cat /etc/passwd"),
        /invalid characters/
      );
    });

    test("rejects newline injection via tilde path", () => {
      assert.throws(
        () => validateBranchName("feature~1"),
        /invalid characters/
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
        /Path traversal detected/
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
        /Path traversal detected/
      );
    });
  });

  describe("ICommandExecutor injection", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("accepts custom executor", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
        exec: async (command: string, _cwd: string) => {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      await gitOps.hasChanges();

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

  describe("createBranch", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("creates new branch with checkout -b", async () => {
      let checkoutBCalled = false;

      const gitOps = new GitOps({
        workDir,
        executor: {
          async exec(command: string, _cwd: string): Promise<string> {
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
            if (command.includes("git checkout -b")) {
              throw new Error(
                "fatal: A branch named 'feature-branch' already exists"
              );
            }
            return "";
          },
        },
        retries: 0,
      });

      await assert.rejects(
        async () => gitOps.createBranch("feature-branch"),
        /Failed to create branch.*already exists/
      );
    });
  });

  describe("setExecutable", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("calls git update-index with chmod flag", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
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
      assert.ok(commands[0].includes("git update-index --add --chmod=+x"));
      assert.ok(commands[0].includes("script.sh"));
    });

    test("does not execute in dry-run mode", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
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
        /Path traversal detected/
      );
    });

    test("handles subdirectory paths", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
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

    test("sets filesystem executable permission (chmod 755)", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(_command: string, _cwd: string): Promise<string> {
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      const filePath = join(workDir, "script.sh");
      writeFileSync(filePath, "#!/bin/bash\necho hello\n");

      // Verify file is NOT executable before setExecutable
      const modeBefore = statSync(filePath).mode;
      const executableBefore = (modeBefore & 0o111) !== 0;
      assert.equal(
        executableBefore,
        false,
        "File should not be executable before setExecutable"
      );

      await gitOps.setExecutable("script.sh");

      // Verify file IS executable after setExecutable
      const modeAfter = statSync(filePath).mode;
      const executableAfter = (modeAfter & 0o111) !== 0;
      assert.equal(
        executableAfter,
        true,
        "File should be executable after setExecutable"
      );
    });

    test("does not set filesystem permissions in dry-run mode", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(_command: string, _cwd: string): Promise<string> {
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        dryRun: true,
        executor: mockExecutor,
      });
      const filePath = join(workDir, "script.sh");
      writeFileSync(filePath, "#!/bin/bash\necho hello\n");

      await gitOps.setExecutable("script.sh");

      // Verify file is still NOT executable (dry-run should skip chmod)
      const mode = statSync(filePath).mode;
      const executable = (mode & 0o111) !== 0;
      assert.equal(
        executable,
        false,
        "File should not be executable in dry-run mode"
      );
    });
  });

  describe("commit", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("returns true in dry-run mode without running commands", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
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
      const result = await gitOps.commit("test commit");

      assert.equal(result, true);
      assert.equal(commands.length, 0);
    });

    test("stages and commits changes when there are staged changes", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          // git diff --cached --quiet exits with code 1 when there are changes
          if (command.includes("git diff --cached --quiet")) {
            throw new Error("exit code 1");
          }
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      const result = await gitOps.commit("test commit");

      assert.equal(result, true);
      assert.ok(commands.some((c) => c.includes("git add -A")));
      assert.ok(commands.some((c) => c.includes("git commit")));
      assert.ok(commands.some((c) => c.includes("--no-verify")));
    });

    test("returns false when no staged changes after git add", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          // git diff --cached --quiet exits with code 0 when no changes
          if (command.includes("git diff --cached --quiet")) {
            return ""; // No error = no staged changes
          }
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      const result = await gitOps.commit("test commit");

      assert.equal(result, false);
      assert.ok(commands.some((c) => c.includes("git add -A")));
      // Should not have called git commit since there were no changes
      assert.ok(!commands.some((c) => c.includes("git commit")));
    });
  });

  describe("push", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("does nothing in dry-run mode", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
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
      await gitOps.push("feature-branch");

      assert.equal(commands.length, 0);
    });

    test("pushes to origin with -u flag", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      await gitOps.push("feature-branch");

      assert.equal(commands.length, 1);
      assert.ok(commands[0].includes("git push -u origin"));
      assert.ok(commands[0].includes("feature-branch"));
    });

    test("uses --force-with-lease when force option is true", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      await gitOps.push("sync-branch", { force: true });

      assert.equal(commands.length, 1);
      assert.ok(
        commands[0].includes("--force-with-lease"),
        "Should include --force-with-lease flag"
      );
      assert.ok(commands[0].includes("-u origin"));
      assert.ok(commands[0].includes("sync-branch"));
    });

    test("does not use force flag when force option is false", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      await gitOps.push("main", { force: false });

      assert.equal(commands.length, 1);
      assert.ok(
        !commands[0].includes("--force"),
        "Should NOT include any force flag"
      );
      assert.ok(commands[0].includes("git push -u origin"));
      assert.ok(commands[0].includes("main"));
    });

    test("does not use force flag when options is undefined", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      await gitOps.push("main");

      assert.equal(commands.length, 1);
      assert.ok(
        !commands[0].includes("--force"),
        "Should NOT include any force flag when options undefined"
      );
    });
  });

  describe("fetch", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("fetches from origin without prune by default", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      await gitOps.fetch();

      assert.equal(commands.length, 1);
      assert.ok(commands[0].includes("git fetch origin"));
      assert.ok(!commands[0].includes("--prune"));
    });

    test("fetches with prune flag when prune option is true", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      await gitOps.fetch({ prune: true });

      assert.equal(commands.length, 1);
      assert.ok(commands[0].includes("git fetch origin --prune"));
    });

    test("does not include prune when prune option is false", async () => {
      const commands: string[] = [];
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          commands.push(command);
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      await gitOps.fetch({ prune: false });

      assert.equal(commands.length, 1);
      assert.ok(commands[0].includes("git fetch origin"));
      assert.ok(!commands[0].includes("--prune"));
    });
  });

  describe("getDefaultBranch", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("returns branch from remote HEAD when available", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          if (command.includes("git remote show origin")) {
            return "HEAD branch: main\n  Remote branches:";
          }
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      const result = await gitOps.getDefaultBranch();

      assert.equal(result.branch, "main");
      assert.equal(result.method, "remote HEAD");
    });

    test("falls back to origin/main when remote show fails", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          if (command.includes("git remote show origin")) {
            throw new Error("remote show failed");
          }
          if (command.includes("git rev-parse --verify origin/main")) {
            return "abc123"; // main exists
          }
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      const result = await gitOps.getDefaultBranch();

      assert.equal(result.branch, "main");
      assert.equal(result.method, "origin/main exists");
    });

    test("falls back to origin/master when main does not exist", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          if (command.includes("git remote show origin")) {
            throw new Error("remote show failed");
          }
          if (command.includes("git rev-parse --verify origin/main")) {
            throw new Error("main does not exist");
          }
          if (command.includes("git rev-parse --verify origin/master")) {
            return "abc123"; // master exists
          }
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      const result = await gitOps.getDefaultBranch();

      assert.equal(result.branch, "master");
      assert.equal(result.method, "origin/master exists");
    });

    test("falls back to main when remote HEAD is (unknown) for empty repo", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          if (command.includes("git remote show origin")) {
            return "HEAD branch: (unknown)\n  Remote branches:";
          }
          if (command.includes("git rev-parse --verify origin/main")) {
            throw new Error("main does not exist");
          }
          if (command.includes("git rev-parse --verify origin/master")) {
            throw new Error("master does not exist");
          }
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      const result = await gitOps.getDefaultBranch();

      assert.equal(result.branch, "main");
      assert.equal(result.method, "fallback default");
    });

    test("falls back to main as default when nothing works", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          if (command.includes("git remote show origin")) {
            throw new Error("remote show failed");
          }
          if (command.includes("git rev-parse --verify origin/main")) {
            throw new Error("main does not exist");
          }
          if (command.includes("git rev-parse --verify origin/master")) {
            throw new Error("master does not exist");
          }
          return "";
        },
      };

      const gitOps = new GitOps({
        workDir,
        executor: mockExecutor,
        retries: 0,
      });
      const result = await gitOps.getDefaultBranch();

      assert.equal(result.branch, "main");
      assert.equal(result.method, "fallback default");
    });
  });

  describe("getFileContent", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("returns file content when file exists", () => {
      writeFileSync(join(workDir, "test.json"), '{"key": "value"}');

      const gitOps = new GitOps({ workDir });
      const content = gitOps.getFileContent("test.json");

      assert.equal(content, '{"key": "value"}');
    });

    test("returns null when file does not exist", () => {
      const gitOps = new GitOps({ workDir });
      const content = gitOps.getFileContent("nonexistent.json");

      assert.equal(content, null);
    });

    test("throws on path traversal attempt", () => {
      const gitOps = new GitOps({ workDir });
      assert.throws(
        () => gitOps.getFileContent("../escape.json"),
        /Path traversal detected/
      );
    });
  });

  describe("getChangedFiles", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("returns empty array when no changes", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          if (command.includes("git status --porcelain")) {
            return "";
          }
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      const files = await gitOps.getChangedFiles();

      assert.deepEqual(files, []);
    });

    test("returns list of changed files", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          if (command.includes("git status --porcelain")) {
            return " M config.json\n?? new-file.txt\nA  added.json";
          }
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      const files = await gitOps.getChangedFiles();

      assert.deepEqual(files, ["config.json", "new-file.txt", "added.json"]);
    });
  });

  describe("fileExistsOnBranch", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("returns true when file exists on branch", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          if (command.includes("git show")) {
            return "file content";
          }
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      const exists = await gitOps.fileExistsOnBranch("config.json", "main");

      assert.equal(exists, true);
    });

    test("returns false when file does not exist on branch", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(command: string, _cwd: string): Promise<string> {
          if (command.includes("git show")) {
            throw new Error("file not found");
          }
          return "";
        },
      };

      const gitOps = new GitOps({ workDir, executor: mockExecutor });
      const exists = await gitOps.fileExistsOnBranch("config.json", "main");

      assert.equal(exists, false);
    });
  });

  describe("fileExists", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("returns true when file exists", () => {
      writeFileSync(join(workDir, "test.json"), '{"key": "value"}');

      const gitOps = new GitOps({ workDir });
      const exists = gitOps.fileExists("test.json");

      assert.equal(exists, true);
    });

    test("returns false when file does not exist", () => {
      const gitOps = new GitOps({ workDir });
      const exists = gitOps.fileExists("nonexistent.json");

      assert.equal(exists, false);
    });

    test("throws on path traversal attempt", () => {
      const gitOps = new GitOps({ workDir });
      assert.throws(
        () => gitOps.fileExists("../escape.json"),
        /Path traversal detected/
      );
    });
  });

  describe("deleteFile", () => {
    beforeEach(() => {
      mkdirSync(workDir, { recursive: true });
    });

    test("deletes existing file", () => {
      const filePath = join(workDir, "test.json");
      writeFileSync(filePath, '{"key": "value"}');
      assert.ok(existsSync(filePath));

      const gitOps = new GitOps({ workDir });
      gitOps.deleteFile("test.json");

      assert.ok(!existsSync(filePath));
    });

    test("does nothing when file does not exist", () => {
      const gitOps = new GitOps({ workDir });
      // Should not throw
      gitOps.deleteFile("nonexistent.json");
    });

    test("does nothing in dry-run mode", () => {
      const filePath = join(workDir, "test.json");
      writeFileSync(filePath, '{"key": "value"}');

      const gitOps = new GitOps({ workDir, dryRun: true });
      gitOps.deleteFile("test.json");

      assert.ok(existsSync(filePath));
    });

    test("throws on path traversal attempt", () => {
      const gitOps = new GitOps({ workDir });
      assert.throws(
        () => gitOps.deleteFile("../escape.json"),
        /Path traversal detected/
      );
    });

    test("handles subdirectory paths", () => {
      const subDir = join(workDir, "subdir");
      mkdirSync(subDir, { recursive: true });
      const filePath = join(subDir, "nested.json");
      writeFileSync(filePath, '{"key": "value"}');
      assert.ok(existsSync(filePath));

      const gitOps = new GitOps({ workDir });
      gitOps.deleteFile("subdir/nested.json");

      assert.ok(!existsSync(filePath));
    });
  });
});
