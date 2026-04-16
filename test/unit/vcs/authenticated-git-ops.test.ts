import { describe, test } from "node:test";
import { strict as assert } from "node:assert";

import { AuthenticatedGitOps } from "../../../src/vcs/authenticated-git-ops.js";
import type { GitAuthOptions } from "../../../src/vcs/types.js";
import type { ILocalGitOps } from "../../../src/vcs/types.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";
import type { DebugLog } from "../../../src/shared/logger.js";

function createAuthOps(
  localOps: ILocalGitOps,
  executor: ICommandExecutor,
  workDir: string,
  retries: number,
  auth?: GitAuthOptions,
  log?: DebugLog
): AuthenticatedGitOps {
  return new AuthenticatedGitOps({
    localOps,
    executor,
    workDir,
    retries,
    auth,
    log,
  });
}

// Minimal ILocalGitOps mock for tests that only exercise network methods
function createMockLocalOps(): ILocalGitOps {
  return {
    cleanWorkspace() {},
    async createBranch() {},
    async commit() {
      return true;
    },
    writeFile() {},
    async setExecutable() {},
    getFileContent() {
      return null;
    },
    wouldChange() {
      return true;
    },
    async hasChanges() {
      return false;
    },
    async getChangedFiles() {
      return [];
    },
    async stageAll() {},
    async hasStagedChanges() {
      return false;
    },
    async fileExistsOnBranch() {
      return false;
    },
    fileExists() {
      return false;
    },
    deleteFile() {},
    async getDefaultBranchLocal() {
      return { branch: "main", method: "mock fallback" };
    },
  };
}

describe("AuthenticatedGitOps", () => {
  describe("without auth", () => {
    test("clone runs plain git clone", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3
      );

      await authOps.clone("https://github.com/owner/repo.git");

      assert.strictEqual(commands.length, 1);
      assert.ok(
        commands[0].includes("clone"),
        `Expected clone in command: ${commands[0]}`
      );
      assert.ok(
        !commands[0].includes("x-access-token"),
        `Should not have auth token: ${commands[0]}`
      );
    });

    test("push runs plain git push", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3
      );

      await authOps.push("feature-branch", { force: true });

      assert.strictEqual(commands.length, 1);
      assert.ok(
        commands[0].startsWith("git push"),
        `Expected git push command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("feature-branch"),
        `Expected branch name: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("--force-with-lease"),
        `Expected force flag: ${commands[0]}`
      );
    });

    test("fetch runs plain git fetch", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3
      );

      await authOps.fetch({ prune: true });

      assert.strictEqual(commands.length, 1);
      assert.ok(
        commands[0].startsWith("git fetch"),
        `Expected git fetch command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("--prune"),
        `Expected --prune flag: ${commands[0]}`
      );
    });

    test("getDefaultBranch delegates to localOps fallback when remote show fails", async () => {
      const mockExecutor = {
        exec: async () => {
          throw new Error("remote not available");
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        0
      );

      const result = await authOps.getDefaultBranch();

      // Falls back to localOps.getDefaultBranchLocal()
      assert.deepStrictEqual(result, {
        branch: "main",
        method: "mock fallback",
      });
    });
  });

  describe("with auth", () => {
    const authOptions: GitAuthOptions = {
      token: "test-token-123",
      host: "github.com",
      owner: "test-owner",
      repo: "test-repo",
    };

    test("clone uses authenticated URL directly", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        authOptions
      );

      await authOps.clone("https://github.com/test-owner/test-repo.git");

      // Verify clone command uses authenticated URL directly
      assert.strictEqual(commands.length, 1);

      // Clone with authenticated URL (token embedded)
      assert.ok(
        commands[0].includes("clone"),
        `Expected clone in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("test-token-123"),
        `Expected token in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("x-access-token"),
        `Expected x-access-token in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("github.com/test-owner/test-repo"),
        `Expected repo path in command: ${commands[0]}`
      );
    });

    test("push uses plain git command (remote already has auth)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        authOptions
      );

      await authOps.push("feature-branch");

      // Verify plain git push (no -c flag needed, remote URL has auth)
      assert.strictEqual(commands.length, 1);
      assert.ok(
        commands[0].startsWith("git push"),
        `Expected git push command: ${commands[0]}`
      );
      assert.ok(
        !commands[0].includes("insteadOf"),
        `Should not have -c flag: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("feature-branch"),
        `Expected branch name in command: ${commands[0]}`
      );
    });

    test("fetch uses plain git command (remote already has auth)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        authOptions
      );

      await authOps.fetch({ prune: true });

      // Verify plain git fetch (no -c flag needed, remote URL has auth)
      assert.strictEqual(commands.length, 1);
      assert.ok(
        commands[0].startsWith("git fetch"),
        `Expected git fetch command: ${commands[0]}`
      );
      assert.ok(
        !commands[0].includes("insteadOf"),
        `Should not have -c flag: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("--prune"),
        `Expected --prune flag in command: ${commands[0]}`
      );
    });
  });

  describe("authenticated URL embedding", () => {
    test("clone embeds auth token directly in URL", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        {
          token: "my-token",
          host: "github.com",
          owner: "myorg",
          repo: "myrepo",
        }
      );

      await authOps.clone("https://github.com/myorg/myrepo.git");

      // Clone uses authenticated URL directly (no insteadOf)
      assert.ok(
        commands[0].includes("x-access-token:my-token@github.com/myorg/myrepo"),
        `Expected authenticated URL: ${commands[0]}`
      );
      assert.ok(
        !commands[0].includes("insteadOf"),
        `Should not use insteadOf: ${commands[0]}`
      );
    });

    test("handles GitHub Enterprise hosts", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        {
          token: "my-token",
          host: "github.mycompany.com",
          owner: "org",
          repo: "repo",
        }
      );

      await authOps.clone("https://github.mycompany.com/org/repo.git");

      // Clone uses authenticated URL with custom host
      const hostPattern =
        /https:\/\/x-access-token:[^@]+@github\.mycompany\.com\/org\/repo/;
      assert.ok(
        hostPattern.test(commands[0]),
        `Expected custom host in authenticated URL: ${commands[0]}`
      );
    });
  });

  describe("specialized network operations", () => {
    test("lsRemote uses plain git command (remote already has auth)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "abc123\trefs/heads/main\n";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        {
          token: "test-token",
          host: "github.com",
          owner: "owner",
          repo: "repo",
        }
      );

      const result = await authOps.lsRemote("main");

      assert.ok(commands[0].includes("ls-remote --exit-code --heads origin"));
      // Check that we're not using -c url.insteadOf pattern
      assert.ok(!commands[0].includes("insteadOf"), "Should not use insteadOf");
      assert.ok(
        commands[0].startsWith("git ls-remote"),
        "Should be plain git command"
      );
      assert.equal(result, "abc123\trefs/heads/main\n");
    });

    test("pushRefspec uses plain git command (remote already has auth)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        {
          token: "test-token",
          host: "github.com",
          owner: "owner",
          repo: "repo",
        }
      );

      await authOps.pushRefspec("HEAD:feature-branch");

      assert.ok(commands[0].includes("push"));
      assert.ok(commands[0].includes("HEAD:feature-branch"));
      assert.ok(!commands[0].includes("insteadOf"), "Should not have -c flag");
    });

    test("pushRefspec with delete flag uses --delete", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        {
          token: "test-token",
          host: "github.com",
          owner: "owner",
          repo: "repo",
        }
      );

      await authOps.pushRefspec("feature-branch", { delete: true });

      assert.ok(commands[0].includes("--delete"));
      assert.ok(commands[0].includes("feature-branch"));
    });

    test("fetchBranch uses plain git command (remote already has auth)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        {
          token: "test-token",
          host: "github.com",
          owner: "owner",
          repo: "repo",
        }
      );

      await authOps.fetchBranch("feature-branch");

      assert.ok(commands[0].includes("fetch origin"));
      assert.ok(commands[0].includes("feature-branch"));
      assert.ok(commands[0].includes("refs/remotes/origin/"));
      assert.ok(!commands[0].includes("insteadOf"), "Should not have -c flag");
      assert.ok(
        commands[0].includes("+"),
        "Should use + prefix in refspec to allow non-fast-forward updates"
      );
    });

    test("fetchBranch uses + refspec prefix to allow non-fast-forward updates", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        {
          token: "test-token",
          host: "github.com",
          owner: "owner",
          repo: "repo",
        }
      );

      await authOps.fetchBranch("chore/sync-config");

      // Regression: without +, git fetch rejects non-fast-forward updates
      // when a PR branch (e.g. chore/sync-config) has been rebased or force-pushed
      assert.match(
        commands[0],
        /\+.*chore\/sync-config.*:refs\/remotes\/origin/,
        "Refspec must have + prefix to allow non-fast-forward updates"
      );
    });

    test("lsRemote without auth uses plain git command", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "abc123\trefs/heads/main\n";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3
      ); // No auth

      await authOps.lsRemote("main");

      assert.ok(commands.length > 0, `No commands captured`);
      assert.ok(
        commands[0].startsWith("git ls-remote"),
        `Expected command to start with 'git ls-remote', got: ${commands[0]}`
      );
      assert.ok(
        !commands[0].includes("insteadOf"),
        `Expected no insteadOf in command, got: ${commands[0]}`
      );
    });

    test("lsRemote with skipRetry does not retry on failure", async () => {
      let callCount = 0;
      const mockExecutor = {
        exec: async () => {
          callCount++;
          throw new Error("Command failed: git ls-remote");
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3, // Would normally retry 3 times
        {
          token: "test-token",
          host: "github.com",
          owner: "owner",
          repo: "repo",
        }
      );

      await assert.rejects(
        async () => authOps.lsRemote("nonexistent-branch", { skipRetry: true }),
        /Command failed: git ls-remote/
      );

      // With skipRetry: true, should only be called once (no retries)
      assert.strictEqual(
        callCount,
        1,
        "Should not retry when skipRetry is true"
      );
    });

    test("pushRefspec without auth uses plain git command", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3
      ); // No auth

      await authOps.pushRefspec("HEAD:feature-branch");

      assert.ok(commands[0].startsWith("git push"));
      assert.ok(!commands[0].includes("insteadOf"));
    });

    test("fetchBranch without auth uses plain git command", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3
      ); // No auth

      await authOps.fetchBranch("feature-branch");

      assert.ok(commands[0].startsWith("git fetch"));
      assert.ok(!commands[0].includes("insteadOf"));
    });

    test("getDefaultBranch with auth uses remote show origin (plain git command)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          if (cmd.includes("remote show origin")) {
            return "* remote origin\n  HEAD branch: develop\n";
          }
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        3,
        {
          token: "test-token",
          host: "github.com",
          owner: "owner",
          repo: "repo",
        }
      );

      const result = await authOps.getDefaultBranch();

      assert.equal(result.branch, "develop");
      assert.equal(result.method, "remote HEAD");
      assert.ok(commands[0].includes("remote show origin"));
      assert.ok(!commands[0].includes("insteadOf"), "Should not have -c flag");
    });

    test("getDefaultBranch falls back to main when remote HEAD is (unknown) for empty repo", async () => {
      const mockExecutor = {
        exec: async (cmd: string) => {
          if (cmd.includes("remote show origin")) {
            return "* remote origin\n  HEAD branch: (unknown)\n";
          }
          if (cmd.includes("rev-parse --verify origin/main")) {
            throw new Error("not found");
          }
          if (cmd.includes("rev-parse --verify origin/master")) {
            throw new Error("not found");
          }
          return "";
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        0,
        {
          token: "test-token",
          host: "github.com",
          owner: "owner",
          repo: "repo",
        }
      );

      const result = await authOps.getDefaultBranch();

      // Falls back to localOps.getDefaultBranchLocal() when HEAD is (unknown)
      assert.equal(result.branch, "main");
      assert.equal(result.method, "mock fallback");
    });

    test("getDefaultBranch delegates to localOps.getDefaultBranchLocal when remote show fails", async () => {
      const mockExecutor = {
        exec: async () => {
          throw new Error("remote not available");
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        0,
        {
          token: "test-token",
          host: "github.com",
          owner: "owner",
          repo: "repo",
        }
      );

      const result = await authOps.getDefaultBranch();

      // Falls back to localOps.getDefaultBranchLocal()
      assert.equal(result.branch, "main");
      assert.equal(result.method, "mock fallback");
    });

    test("getDefaultBranch logs debug message when remote show fails", async () => {
      const debugMessages: string[] = [];
      const mockLogger = {
        debug(msg: string) {
          debugMessages.push(msg);
        },
      };
      const mockExecutor = {
        exec: async () => {
          throw new Error("remote not available");
        },
      };
      const authOps = createAuthOps(
        createMockLocalOps(),
        mockExecutor,
        "/tmp/test",
        0,
        {
          token: "test-token",
          host: "github.com",
          owner: "owner",
          repo: "repo",
        },
        mockLogger
      );

      const result = await authOps.getDefaultBranch();

      assert.equal(result.branch, "main");
      assert.equal(result.method, "mock fallback");
      assert.ok(
        debugMessages.some((m) => m.includes("git remote show origin failed"))
      );
    });
  });

  describe("ILocalGitOps delegation", () => {
    test("createBranch delegates to localOps", async () => {
      let branchCreated = "";
      const localOps = {
        ...createMockLocalOps(),
        async createBranch(branchName: string) {
          branchCreated = branchName;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      await authOps.createBranch("feature-branch");
      assert.strictEqual(branchCreated, "feature-branch");
    });

    test("writeFile delegates to localOps", () => {
      const calls: string[] = [];
      const localOps = {
        ...createMockLocalOps(),
        writeFile(fileName: string, content: string) {
          calls.push(`writeFile:${fileName}:${content}`);
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      authOps.writeFile("test.json", '{"key":"value"}');
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0].startsWith("writeFile:test.json:"));
    });

    test("setExecutable delegates to localOps", async () => {
      let called = false;
      const localOps = {
        ...createMockLocalOps(),
        async setExecutable(_fileName: string) {
          called = true;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      await authOps.setExecutable("script.sh");
      assert.ok(called);
    });

    test("getFileContent delegates to localOps", () => {
      const localOps = {
        ...createMockLocalOps(),
        getFileContent(_fileName: string) {
          return "file-content";
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      assert.strictEqual(authOps.getFileContent("test.json"), "file-content");
    });

    test("wouldChange delegates to localOps", () => {
      const localOps = {
        ...createMockLocalOps(),
        wouldChange(_fileName: string, _content: string) {
          return false;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      assert.strictEqual(authOps.wouldChange("test.json", "content"), false);
    });

    test("hasChanges delegates to localOps", async () => {
      const localOps = {
        ...createMockLocalOps(),
        async hasChanges() {
          return true;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      assert.strictEqual(await authOps.hasChanges(), true);
    });

    test("getChangedFiles delegates to localOps", async () => {
      const localOps = {
        ...createMockLocalOps(),
        async getChangedFiles() {
          return ["file1.ts", "file2.ts"];
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      assert.deepStrictEqual(await authOps.getChangedFiles(), [
        "file1.ts",
        "file2.ts",
      ]);
    });

    test("hasStagedChanges delegates to localOps", async () => {
      const localOps = {
        ...createMockLocalOps(),
        async hasStagedChanges() {
          return true;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      assert.strictEqual(await authOps.hasStagedChanges(), true);
    });

    test("fileExistsOnBranch delegates to localOps", async () => {
      const localOps = {
        ...createMockLocalOps(),
        async fileExistsOnBranch(_fileName: string, _branch: string) {
          return true;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      assert.strictEqual(
        await authOps.fileExistsOnBranch("test.json", "main"),
        true
      );
    });

    test("fileExists delegates to localOps", () => {
      const localOps = {
        ...createMockLocalOps(),
        fileExists(_fileName: string) {
          return true;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      assert.strictEqual(authOps.fileExists("test.json"), true);
    });

    test("deleteFile delegates to localOps", () => {
      let deleted = false;
      const localOps = {
        ...createMockLocalOps(),
        deleteFile(_fileName: string) {
          deleted = true;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      authOps.deleteFile("test.json");
      assert.ok(deleted);
    });

    test("commit delegates to localOps", async () => {
      const localOps = {
        ...createMockLocalOps(),
        async commit(_message: string) {
          return true;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      assert.strictEqual(await authOps.commit("test commit"), true);
    });

    test("getDefaultBranchLocal delegates to localOps", async () => {
      const localOps = {
        ...createMockLocalOps(),
        async getDefaultBranchLocal() {
          return { branch: "develop", method: "custom" };
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      const result = await authOps.getDefaultBranchLocal();
      assert.deepStrictEqual(result, { branch: "develop", method: "custom" });
    });
  });
});
