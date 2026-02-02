import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert";
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
        (mockGitOps.clone as ReturnType<typeof mock.fn>).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.clone as ReturnType<typeof mock.fn>).mock.calls[0]
          .arguments,
        ["https://github.com/owner/repo.git"]
      );
    });

    it("push delegates directly to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.push("feature-branch", { force: true });

      assert.strictEqual(
        (mockGitOps.push as ReturnType<typeof mock.fn>).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.push as ReturnType<typeof mock.fn>).mock.calls[0].arguments,
        ["feature-branch", { force: true }]
      );
    });

    it("fetch delegates directly to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.fetch({ prune: true });

      assert.strictEqual(
        (mockGitOps.fetch as ReturnType<typeof mock.fn>).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.fetch as ReturnType<typeof mock.fn>).mock.calls[0]
          .arguments,
        [{ prune: true }]
      );
    });

    it("getDefaultBranch delegates directly to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      const result = await authOps.getDefaultBranch();

      assert.strictEqual(
        (mockGitOps.getDefaultBranch as ReturnType<typeof mock.fn>).mock.calls
          .length,
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

    it("clone uses authenticated command with -c url.insteadOf", async () => {
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

      // Verify the clone command includes the auth override
      assert.strictEqual(commands.length, 1);
      assert.ok(
        commands[0].includes("-c"),
        `Expected -c flag in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("url."),
        `Expected url. config in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("insteadOf"),
        `Expected insteadOf in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("test-token-123"),
        `Expected token in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("clone"),
        `Expected clone in command: ${commands[0]}`
      );
    });

    it("push uses authenticated command with -c url.insteadOf", async () => {
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

      // Verify the push command includes the auth override
      assert.strictEqual(commands.length, 1);
      assert.ok(
        commands[0].includes("-c"),
        `Expected -c flag in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("url."),
        `Expected url. config in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("test-token-123"),
        `Expected token in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("push"),
        `Expected push in command: ${commands[0]}`
      );
    });

    it("fetch uses authenticated command with -c url.insteadOf", async () => {
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

      // Verify the fetch command includes the auth override
      assert.strictEqual(commands.length, 1);
      assert.ok(
        commands[0].includes("-c"),
        `Expected -c flag in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("url."),
        `Expected url. config in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("test-token-123"),
        `Expected token in command: ${commands[0]}`
      );
      assert.ok(
        commands[0].includes("fetch"),
        `Expected fetch in command: ${commands[0]}`
      );
    });
  });

  describe("local operations pass through unchanged", () => {
    it("cleanWorkspace delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.cleanWorkspace();

      assert.strictEqual(
        (mockGitOps.cleanWorkspace as ReturnType<typeof mock.fn>).mock.calls
          .length,
        1
      );
    });

    it("createBranch delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.createBranch("new-branch");

      assert.strictEqual(
        (mockGitOps.createBranch as ReturnType<typeof mock.fn>).mock.calls
          .length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.createBranch as ReturnType<typeof mock.fn>).mock.calls[0]
          .arguments,
        ["new-branch"]
      );
    });

    it("writeFile delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.writeFile("test.txt", "content");

      assert.strictEqual(
        (mockGitOps.writeFile as ReturnType<typeof mock.fn>).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.writeFile as ReturnType<typeof mock.fn>).mock.calls[0]
          .arguments,
        ["test.txt", "content"]
      );
    });

    it("commit delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.commit("test message");

      assert.strictEqual(
        (mockGitOps.commit as ReturnType<typeof mock.fn>).mock.calls.length,
        1
      );
      assert.deepStrictEqual(
        (mockGitOps.commit as ReturnType<typeof mock.fn>).mock.calls[0]
          .arguments,
        ["test message"]
      );
    });

    it("getFileContent delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.getFileContent("test.txt");

      assert.strictEqual(
        (mockGitOps.getFileContent as ReturnType<typeof mock.fn>).mock.calls
          .length,
        1
      );
    });

    it("wouldChange delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.wouldChange("test.txt", "content");

      assert.strictEqual(
        (mockGitOps.wouldChange as ReturnType<typeof mock.fn>).mock.calls
          .length,
        1
      );
    });

    it("hasChanges delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.hasChanges();

      assert.strictEqual(
        (mockGitOps.hasChanges as ReturnType<typeof mock.fn>).mock.calls.length,
        1
      );
    });

    it("hasStagedChanges delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.hasStagedChanges();

      assert.strictEqual(
        (mockGitOps.hasStagedChanges as ReturnType<typeof mock.fn>).mock.calls
          .length,
        1
      );
    });

    it("fileExistsOnBranch delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.fileExistsOnBranch("test.txt", "main");

      assert.strictEqual(
        (mockGitOps.fileExistsOnBranch as ReturnType<typeof mock.fn>).mock.calls
          .length,
        1
      );
    });

    it("fileExists delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.fileExists("test.txt");

      assert.strictEqual(
        (mockGitOps.fileExists as ReturnType<typeof mock.fn>).mock.calls.length,
        1
      );
    });

    it("deleteFile delegates to GitOps", () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      authOps.deleteFile("test.txt");

      assert.strictEqual(
        (mockGitOps.deleteFile as ReturnType<typeof mock.fn>).mock.calls.length,
        1
      );
    });

    it("setExecutable delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.setExecutable("test.sh");

      assert.strictEqual(
        (mockGitOps.setExecutable as ReturnType<typeof mock.fn>).mock.calls
          .length,
        1
      );
    });

    it("getChangedFiles delegates to GitOps", async () => {
      const authOps = new AuthenticatedGitOps(mockGitOps);
      await authOps.getChangedFiles();

      assert.strictEqual(
        (mockGitOps.getChangedFiles as ReturnType<typeof mock.fn>).mock.calls
          .length,
        1
      );
    });
  });

  describe("buildAuthenticatedCommand", () => {
    it("uses repo-specific URL pattern for longer prefix match", async () => {
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

      // The URL pattern should include owner/repo for longer prefix match
      assert.ok(
        commands[0].includes("myorg/myrepo"),
        `Expected owner/repo in URL pattern: ${commands[0]}`
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

      // Use regex to verify the host appears in the correct URL position
      // (after https:// and before /)
      const hostPattern =
        /https:\/\/x-access-token:[^@]+@github\.mycompany\.com\//;
      assert.ok(
        hostPattern.test(commands[0]),
        `Expected custom host in URL override: ${commands[0]}`
      );
    });
  });
});
