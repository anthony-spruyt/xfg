import { describe, it, mock, beforeEach, type Mock } from "node:test";
import { strict as assert } from "node:assert";

// Helper type for mock function - avoids verbose casting
type MockFn = Mock<(...args: unknown[]) => unknown>;
import {
  AuthenticatedGitOps,
  GitAuthOptions,
} from "./authenticated-git-ops.js";
import { GitOps, GitOpsOptions as _GitOpsOptions } from "./git-ops.js";

describe("AuthenticatedGitOps", () => {
  let mockGitOps: GitOps;
  let _execCalls: Array<{ command: string; cwd?: string }>;

  beforeEach(() => {
    _execCalls = [];
    // Create a mock GitOps with spied methods
    mockGitOps = {
      clone: mock.fn(async () => {}),
      fetch: mock.fn(async () => {}),
      push: mock.fn(async () => {}),
      getDefaultBranch: mock.fn(async () => ({
        branch: "main",
        method: "test",
      })),
      cleanWorkspace: mock.fn(() => {}),
      createBranch: mock.fn(async () => {}),
      writeFile: mock.fn(() => {}),
      setExecutable: mock.fn(async () => {}),
      getFileContent: mock.fn(() => null),
      wouldChange: mock.fn(() => true),
      hasChanges: mock.fn(async () => true),
      getChangedFiles: mock.fn(async () => []),
      hasStagedChanges: mock.fn(async () => true),
      fileExistsOnBranch: mock.fn(async () => false),
      fileExists: mock.fn(() => false),
      deleteFile: mock.fn(() => {}),
      commit: mock.fn(async () => true),
    } as unknown as GitOps;
  });

  describe("without auth", () => {
    it("clone delegates directly to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.clone("https://github.com/owner/repo.git");

      assert.strictEqual(
        (mockGitOps.clone as unknown as MockFn).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.clone as unknown as MockFn).mock.calls[0].arguments,
        ["https://github.com/owner/repo.git"]
      );
    });

    it("push delegates directly to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.push("feature-branch", { force: true });

      assert.strictEqual(
        (mockGitOps.push as unknown as MockFn).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.push as unknown as MockFn).mock.calls[0].arguments,
        ["feature-branch", { force: true }]
      );
    });

    it("fetch delegates directly to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.fetch({ prune: true });

      assert.strictEqual(
        (mockGitOps.fetch as unknown as MockFn).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.fetch as unknown as MockFn).mock.calls[0].arguments,
        [{ prune: true }]
      );
    });

    it("getDefaultBranch delegates directly to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      const result = await authOps.getDefaultBranch();

      assert.strictEqual(
        (mockGitOps.getDefaultBranch as unknown as MockFn).mock.calls.length,
        1
      );
      assert.deepStrictEqual(result, { branch: "main", method: "test" });
    });
  });

  describe("with auth", () => {
    const authOptions: GitAuthOptions = {
      token: "test-token-123",
      host: "github.com",
      owner: "test-owner",
      repo: "test-repo",
    };

    it("clone uses authenticated URL directly", async () => {
      // Create a real GitOps with mock executor to verify command
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, authOptions);

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

    it("push uses plain git command (remote already has auth)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, authOptions);

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

    it("fetch uses plain git command (remote already has auth)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, authOptions);

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

  describe("local operations pass through unchanged", () => {
    it("cleanWorkspace delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.cleanWorkspace();

      assert.strictEqual(
        (mockGitOps.cleanWorkspace as unknown as MockFn).mock.calls.length,
        1
      );
    });

    it("createBranch delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.createBranch("new-branch");

      assert.strictEqual(
        (mockGitOps.createBranch as unknown as MockFn).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.createBranch as unknown as MockFn).mock.calls[0].arguments,
        ["new-branch"]
      );
    });

    it("writeFile delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.writeFile("test.txt", "content");

      assert.strictEqual(
        (mockGitOps.writeFile as unknown as MockFn).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.writeFile as unknown as MockFn).mock.calls[0].arguments,
        ["test.txt", "content"]
      );
    });

    it("commit delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.commit("test message");

      assert.strictEqual(
        (mockGitOps.commit as unknown as MockFn).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.commit as unknown as MockFn).mock.calls[0].arguments,
        ["test message"]
      );
    });

    it("getFileContent delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.getFileContent("test.txt");

      assert.strictEqual(
        (mockGitOps.getFileContent as unknown as MockFn).mock.calls.length,
        1
      );
    });

    it("wouldChange delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.wouldChange("test.txt", "content");

      assert.strictEqual(
        (mockGitOps.wouldChange as unknown as MockFn).mock.calls.length,
        1
      );
    });

    it("hasChanges delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.hasChanges();

      assert.strictEqual(
        (mockGitOps.hasChanges as unknown as MockFn).mock.calls.length,
        1
      );
    });

    it("hasStagedChanges delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.hasStagedChanges();

      assert.strictEqual(
        (mockGitOps.hasStagedChanges as unknown as MockFn).mock.calls.length,
        1
      );
    });

    it("fileExistsOnBranch delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.fileExistsOnBranch("test.txt", "main");

      assert.strictEqual(
        (mockGitOps.fileExistsOnBranch as unknown as MockFn).mock.calls.length,
        1
      );
    });

    it("fileExists delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.fileExists("test.txt");

      assert.strictEqual(
        (mockGitOps.fileExists as unknown as MockFn).mock.calls.length,
        1
      );
    });

    it("deleteFile delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.deleteFile("test.txt");

      assert.strictEqual(
        (mockGitOps.deleteFile as unknown as MockFn).mock.calls.length,
        1
      );
    });

    it("setExecutable delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.setExecutable("test.sh");

      assert.strictEqual(
        (mockGitOps.setExecutable as unknown as MockFn).mock.calls.length,
        1
      );
    });

    it("getChangedFiles delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.getChangedFiles();

      assert.strictEqual(
        (mockGitOps.getChangedFiles as unknown as MockFn).mock.calls.length,
        1
      );
    });
  });

  describe("authenticated URL embedding", () => {
    it("clone embeds auth token directly in URL", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "my-token",
        host: "github.com",
        owner: "myorg",
        repo: "myrepo",
      });

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

    it("handles GitHub Enterprise hosts", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "my-token",
        host: "github.mycompany.com",
        owner: "org",
        repo: "repo",
      });

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
    it("lsRemote uses plain git command (remote already has auth)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "abc123\trefs/heads/main\n";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "test-token",
        host: "github.com",
        owner: "owner",
        repo: "repo",
      });

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

    it("pushRefspec uses plain git command (remote already has auth)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "test-token",
        host: "github.com",
        owner: "owner",
        repo: "repo",
      });

      await authOps.pushRefspec("HEAD:feature-branch");

      assert.ok(commands[0].includes("push"));
      assert.ok(commands[0].includes("HEAD:feature-branch"));
      assert.ok(!commands[0].includes("insteadOf"), "Should not have -c flag");
    });

    it("pushRefspec with delete flag uses --delete", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "test-token",
        host: "github.com",
        owner: "owner",
        repo: "repo",
      });

      await authOps.pushRefspec("feature-branch", { delete: true });

      assert.ok(commands[0].includes("--delete"));
      assert.ok(commands[0].includes("feature-branch"));
    });

    it("fetchBranch uses plain git command (remote already has auth)", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "test-token",
        host: "github.com",
        owner: "owner",
        repo: "repo",
      });

      await authOps.fetchBranch("feature-branch");

      assert.ok(commands[0].includes("fetch origin"));
      assert.ok(commands[0].includes("feature-branch"));
      assert.ok(commands[0].includes("refs/remotes/origin/"));
      assert.ok(!commands[0].includes("insteadOf"), "Should not have -c flag");
    });

    it("lsRemote without auth uses plain git command", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "abc123\trefs/heads/main\n";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps); // No auth

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

    it("lsRemote with skipRetry does not retry on failure", async () => {
      let callCount = 0;
      const mockExecutor = {
        exec: async () => {
          callCount++;
          throw new Error("Command failed: git ls-remote");
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
        retries: 3, // Would normally retry 3 times
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "test-token",
        host: "github.com",
        owner: "owner",
        repo: "repo",
      });

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

    it("pushRefspec without auth uses plain git command", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps); // No auth

      await authOps.pushRefspec("HEAD:feature-branch");

      assert.ok(commands[0].startsWith("git push"));
      assert.ok(!commands[0].includes("insteadOf"));
    });

    it("fetchBranch without auth uses plain git command", async () => {
      const commands: string[] = [];
      const mockExecutor = {
        exec: async (cmd: string) => {
          commands.push(cmd);
          return "";
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps); // No auth

      await authOps.fetchBranch("feature-branch");

      assert.ok(commands[0].startsWith("git fetch"));
      assert.ok(!commands[0].includes("insteadOf"));
    });

    it("getDefaultBranch with auth uses remote show origin (plain git command)", async () => {
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
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "test-token",
        host: "github.com",
        owner: "owner",
        repo: "repo",
      });

      const result = await authOps.getDefaultBranch();

      assert.equal(result.branch, "develop");
      assert.equal(result.method, "remote HEAD");
      assert.ok(commands[0].includes("remote show origin"));
      assert.ok(!commands[0].includes("insteadOf"), "Should not have -c flag");
    });

    it("getDefaultBranch falls back to origin/main when remote show fails", async () => {
      let _callCount = 0;
      const mockExecutor = {
        exec: async (cmd: string) => {
          _callCount++;
          if (cmd.includes("remote show origin")) {
            throw new Error("remote not available");
          }
          if (cmd.includes("rev-parse --verify origin/main")) {
            return "abc123";
          }
          throw new Error("unexpected command");
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "test-token",
        host: "github.com",
        owner: "owner",
        repo: "repo",
      });

      const result = await authOps.getDefaultBranch();

      assert.equal(result.branch, "main");
      assert.equal(result.method, "origin/main exists");
    });

    it("getDefaultBranch falls back to origin/master when main not found", async () => {
      const mockExecutor = {
        exec: async (cmd: string) => {
          if (cmd.includes("remote show origin")) {
            throw new Error("remote not available");
          }
          if (cmd.includes("rev-parse --verify origin/main")) {
            throw new Error("not found");
          }
          if (cmd.includes("rev-parse --verify origin/master")) {
            return "abc123";
          }
          throw new Error("unexpected command");
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "test-token",
        host: "github.com",
        owner: "owner",
        repo: "repo",
      });

      const result = await authOps.getDefaultBranch();

      assert.equal(result.branch, "master");
      assert.equal(result.method, "origin/master exists");
    });

    it("getDefaultBranch returns fallback default when all methods fail", async () => {
      const mockExecutor = {
        exec: async () => {
          throw new Error("all methods fail");
        },
      };
      const gitOps = new GitOps({
        workDir: "/tmp/test",
        executor: mockExecutor,
      });
      const authOps = new AuthenticatedGitOps(gitOps, {
        token: "test-token",
        host: "github.com",
        owner: "owner",
        repo: "repo",
      });

      const result = await authOps.getDefaultBranch();

      assert.equal(result.branch, "main");
      assert.equal(result.method, "fallback default");
    });
  });
});
