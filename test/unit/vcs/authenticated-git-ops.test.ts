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
    async clearExecutable() {},
    async getFileMode() {
      return "100644" as const;
    },
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
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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

      assert.strictEqual(calls.length, 1);
      assert.ok(
        calls[0].args.includes("clone"),
        `Expected clone in args: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.includes("--"),
        `Expected -- separator to prevent argument injection: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        !calls[0].args.some((a) => a.includes("x-access-token")),
        `Should not have auth token: ${calls[0].args.join(" ")}`
      );
    });

    test("push runs plain git push", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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

      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        calls[0].executable,
        "git",
        `Expected git executable: ${calls[0].executable}`
      );
      assert.ok(
        calls[0].args.includes("push"),
        `Expected push in args: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.includes("feature-branch"),
        `Expected branch name: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.includes("--force-with-lease"),
        `Expected force flag: ${calls[0].args.join(" ")}`
      );
    });

    test("fetch runs plain git fetch", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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

      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        calls[0].executable,
        "git",
        `Expected git executable: ${calls[0].executable}`
      );
      assert.ok(
        calls[0].args.includes("fetch"),
        `Expected fetch in args: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.includes("--prune"),
        `Expected --prune flag: ${calls[0].args.join(" ")}`
      );
    });

    test("getDefaultBranch delegates to localOps fallback when remote show fails", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec() {
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
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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
      assert.strictEqual(calls.length, 1);

      // Clone with authenticated URL (token embedded)
      assert.ok(
        calls[0].args.includes("clone"),
        `Expected clone in args: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.includes("--"),
        `Expected -- separator to prevent argument injection: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.some((a) => a.includes("test-token-123")),
        `Expected token in args: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.some((a) => a.includes("x-access-token")),
        `Expected x-access-token in args: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.some((a) =>
          a.includes("github.com/test-owner/test-repo")
        ),
        `Expected repo path in args: ${calls[0].args.join(" ")}`
      );
    });

    test("push uses plain git command (remote already has auth)", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        calls[0].executable,
        "git",
        `Expected git executable: ${calls[0].executable}`
      );
      assert.ok(
        calls[0].args.includes("push"),
        `Expected push in args: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        !calls[0].args.some((a) => a.includes("insteadOf")),
        `Should not have -c flag: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.includes("feature-branch"),
        `Expected branch name in args: ${calls[0].args.join(" ")}`
      );
    });

    test("fetch uses plain git command (remote already has auth)", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        calls[0].executable,
        "git",
        `Expected git executable: ${calls[0].executable}`
      );
      assert.ok(
        calls[0].args.includes("fetch"),
        `Expected fetch in args: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        !calls[0].args.some((a) => a.includes("insteadOf")),
        `Should not have -c flag: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.includes("--prune"),
        `Expected --prune flag in args: ${calls[0].args.join(" ")}`
      );
    });
  });

  describe("authenticated URL embedding", () => {
    test("clone embeds auth token directly in URL", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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
        calls[0].args.some((a) =>
          a.includes("x-access-token:my-token@github.com/myorg/myrepo")
        ),
        `Expected authenticated URL: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        !calls[0].args.some((a) => a.includes("insteadOf")),
        `Should not use insteadOf: ${calls[0].args.join(" ")}`
      );
    });

    test("handles GitHub Enterprise hosts", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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
        calls[0].args.some((a) => hostPattern.test(a)),
        `Expected custom host in authenticated URL: ${calls[0].args.join(" ")}`
      );
    });
  });

  describe("specialized network operations", () => {
    test("lsRemote uses plain git command (remote already has auth)", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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

      assert.ok(calls[0].args.includes("ls-remote"));
      assert.ok(calls[0].args.includes("--exit-code"));
      assert.ok(calls[0].args.includes("--heads"));
      assert.ok(calls[0].args.includes("origin"));
      assert.ok(calls[0].args.includes("main"));
      // Check that we're not using -c url.insteadOf pattern
      assert.ok(
        !calls[0].args.some((a) => a.includes("insteadOf")),
        "Should not use insteadOf"
      );
      assert.strictEqual(
        calls[0].executable,
        "git",
        "Should be plain git command"
      );
      assert.equal(result, "abc123\trefs/heads/main\n");
    });

    test("pushRefspec uses plain git command (remote already has auth)", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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

      assert.ok(calls[0].args.includes("push"));
      assert.ok(calls[0].args.includes("HEAD:feature-branch"));
      assert.ok(
        !calls[0].args.some((a) => a.includes("insteadOf")),
        "Should not have -c flag"
      );
    });

    test("pushRefspec with delete flag uses --delete", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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

      assert.ok(calls[0].args.includes("--delete"));
      assert.ok(calls[0].args.includes("feature-branch"));
    });

    test("fetchBranch uses plain git command (remote already has auth)", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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

      assert.ok(calls[0].args.includes("fetch"));
      assert.ok(calls[0].args.includes("origin"));
      assert.ok(
        calls[0].args.some((a) => a.includes("feature-branch")),
        `Expected feature-branch in args: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        calls[0].args.some((a) => a.includes("refs/remotes/origin/")),
        `Expected refs/remotes/origin/ in args: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        !calls[0].args.some((a) => a.includes("insteadOf")),
        "Should not have -c flag"
      );
      assert.ok(
        calls[0].args.some((a) => a.startsWith("+")),
        "Should use + prefix in refspec to allow non-fast-forward updates"
      );
    });

    test("fetchBranch uses + refspec prefix to allow non-fast-forward updates", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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
      const refspecArg = calls[0].args.find(
        (a) =>
          a.includes("chore/sync-config") && a.includes("refs/remotes/origin")
      );
      assert.ok(
        refspecArg?.startsWith("+"),
        "Refspec must have + prefix to allow non-fast-forward updates"
      );
    });

    test("lsRemote without auth uses plain git command", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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

      assert.ok(calls.length > 0, `No commands captured`);
      assert.strictEqual(
        calls[0].executable,
        "git",
        `Expected executable to be 'git', got: ${calls[0].executable}`
      );
      assert.ok(
        calls[0].args.includes("ls-remote"),
        `Expected ls-remote in args, got: ${calls[0].args.join(" ")}`
      );
      assert.ok(
        !calls[0].args.some((a) => a.includes("insteadOf")),
        `Expected no insteadOf in args, got: ${calls[0].args.join(" ")}`
      );
    });

    test("lsRemote with skipRetry does not retry on failure", async () => {
      let callCount = 0;
      const mockExecutor: ICommandExecutor = {
        async exec() {
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
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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

      assert.strictEqual(calls[0].executable, "git");
      assert.ok(calls[0].args.includes("push"));
      assert.ok(!calls[0].args.some((a) => a.includes("insteadOf")));
    });

    test("fetchBranch without auth uses plain git command", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
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

      assert.strictEqual(calls[0].executable, "git");
      assert.ok(calls[0].args.includes("fetch"));
      assert.ok(!calls[0].args.some((a) => a.includes("insteadOf")));
    });

    test("getDefaultBranch with auth uses remote show origin (plain git command)", async () => {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const mockExecutor: ICommandExecutor = {
        async exec(exe: string, args: string[]) {
          calls.push({ executable: exe, args });
          if (args.includes("remote") && args.includes("show")) {
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
      assert.ok(calls[0].args.includes("remote"));
      assert.ok(calls[0].args.includes("show"));
      assert.ok(calls[0].args.includes("origin"));
      assert.ok(
        !calls[0].args.some((a) => a.includes("insteadOf")),
        "Should not have -c flag"
      );
    });

    test("getDefaultBranch falls back to main when remote HEAD is (unknown) for empty repo", async () => {
      const mockExecutor: ICommandExecutor = {
        async exec(_exe: string, args: string[]) {
          if (args.includes("remote") && args.includes("show")) {
            return "* remote origin\n  HEAD branch: (unknown)\n";
          }
          if (
            args.includes("rev-parse") &&
            args.some((a) => a.includes("origin/main"))
          ) {
            throw new Error("not found");
          }
          if (
            args.includes("rev-parse") &&
            args.some((a) => a.includes("origin/master"))
          ) {
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
      const mockExecutor: ICommandExecutor = {
        async exec() {
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
      const mockExecutor: ICommandExecutor = {
        async exec() {
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
      let capturedFileName = "";
      const localOps = {
        ...createMockLocalOps(),
        async setExecutable(fileName: string) {
          capturedFileName = fileName;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      await authOps.setExecutable("script.sh");
      assert.strictEqual(capturedFileName, "script.sh");
    });

    test("getFileContent delegates to localOps", () => {
      let capturedFileName = "";
      const localOps = {
        ...createMockLocalOps(),
        getFileContent(fileName: string) {
          capturedFileName = fileName;
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
      assert.strictEqual(capturedFileName, "test.json");
    });

    test("wouldChange delegates to localOps", () => {
      let capturedFileName = "";
      let capturedContent = "";
      const localOps = {
        ...createMockLocalOps(),
        wouldChange(fileName: string, content: string) {
          capturedFileName = fileName;
          capturedContent = content;
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
      assert.strictEqual(capturedFileName, "test.json");
      assert.strictEqual(capturedContent, "content");
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
      let capturedFileName = "";
      let capturedBranch = "";
      const localOps = {
        ...createMockLocalOps(),
        async fileExistsOnBranch(fileName: string, branch: string) {
          capturedFileName = fileName;
          capturedBranch = branch;
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
      assert.strictEqual(capturedFileName, "test.json");
      assert.strictEqual(capturedBranch, "main");
    });

    test("fileExists delegates to localOps", () => {
      let capturedFileName = "";
      const localOps = {
        ...createMockLocalOps(),
        fileExists(fileName: string) {
          capturedFileName = fileName;
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
      assert.strictEqual(capturedFileName, "test.json");
    });

    test("deleteFile delegates to localOps", () => {
      let capturedFileName = "";
      const localOps = {
        ...createMockLocalOps(),
        deleteFile(fileName: string) {
          capturedFileName = fileName;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );

      authOps.deleteFile("test.json");
      assert.strictEqual(capturedFileName, "test.json");
    });

    test("commit delegates to localOps", async () => {
      let capturedMessage = "";
      const localOps = {
        ...createMockLocalOps(),
        async commit(message: string) {
          capturedMessage = message;
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
      assert.strictEqual(capturedMessage, "test commit");
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

    test("clearExecutable delegates to localOps", async () => {
      let cleared = "";
      const localOps = {
        ...createMockLocalOps(),
        async clearExecutable(fileName: string) {
          cleared = fileName;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );
      await authOps.clearExecutable("script.sh");
      assert.equal(cleared, "script.sh");
    });

    test("getFileMode delegates to localOps", async () => {
      let capturedFileName = "";
      const localOps = {
        ...createMockLocalOps(),
        async getFileMode(fileName: string) {
          capturedFileName = fileName;
          return "100755" as const;
        },
      };
      const authOps = createAuthOps(
        localOps,
        { exec: async () => "" },
        "/tmp/test",
        3
      );
      const mode = await authOps.getFileMode("script.sh");
      assert.equal(mode, "100755");
      assert.strictEqual(capturedFileName, "script.sh");
    });
  });
});
