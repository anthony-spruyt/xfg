import { describe, test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GitCommitStrategy } from "../../../src/strategies/git-commit-strategy.js";
import { GitHubRepoInfo } from "../../../src/repo-detector.js";
import { CommitOptions } from "../../../src/strategies/commit-strategy.js";
import { ICommandExecutor } from "../../../src/command-executor.js";
import { IAuthenticatedGitOps } from "../../../src/authenticated-git-ops.js";

const testDir = join(process.cwd(), "test-git-commit-strategy-tmp");

// Mock executor for testing - implements ICommandExecutor interface
function createMockExecutor(): ICommandExecutor & {
  calls: Array<{ command: string; cwd: string }>;
  responses: Map<string, string | Error>;
  reset: () => void;
} {
  const calls: Array<{ command: string; cwd: string }> = [];
  const responses = new Map<string, string | Error>();

  return {
    calls,
    responses,
    async exec(command: string, cwd: string): Promise<string> {
      calls.push({ command, cwd });

      // Check for matching response
      for (const [pattern, response] of responses) {
        if (command.includes(pattern)) {
          if (response instanceof Error) {
            throw response;
          }
          return response;
        }
      }

      // Default: return empty string
      return "";
    },
    reset(): void {
      calls.length = 0;
      responses.clear();
    },
  };
}

describe("GitCommitStrategy", () => {
  const githubRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
    host: "github.com",
  };

  let mockExecutor: ReturnType<typeof createMockExecutor>;

  beforeEach(() => {
    mockExecutor = createMockExecutor();
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

  describe("commit", () => {
    test("stages files, commits, and pushes", async () => {
      // Set up mock to return a commit SHA after commit
      mockExecutor.responses.set("git rev-parse HEAD", "abc123def456");

      const strategy = new GitCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "test-branch",
        message: "Test commit message",
        fileChanges: [
          { path: "file1.txt", content: "content1" },
          { path: "file2.txt", content: "content2" },
        ],
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.commit(options);

      // Verify the result
      assert.equal(result.sha, "abc123def456");
      assert.equal(result.verified, false);
      assert.equal(result.pushed, true);

      // Verify git commands were called in order: add, commit, push, rev-parse
      const commands = mockExecutor.calls.map((c) => c.command);

      // Should have git add -A
      const addCall = commands.find((c) => c.includes("git add -A"));
      assert.ok(addCall, "Should have called git add -A");

      // Should have git commit with the message
      const commitCall = commands.find((c) => c.includes("git commit"));
      assert.ok(commitCall, "Should have called git commit");
      assert.ok(
        commitCall.includes("Test commit message"),
        "Commit should include the message"
      );

      // Should have git push with force-with-lease
      const pushCall = commands.find((c) => c.includes("git push"));
      assert.ok(pushCall, "Should have called git push");
      assert.ok(
        pushCall.includes("--force-with-lease"),
        "Push should use --force-with-lease"
      );
      assert.ok(
        pushCall.includes("test-branch"),
        "Push should include branch name"
      );

      // Should have git rev-parse to get the SHA
      const revParseCall = commands.find((c) => c.includes("git rev-parse"));
      assert.ok(revParseCall, "Should have called git rev-parse HEAD");
    });

    test("uses retry for push failures", async () => {
      // First push fails, second succeeds
      let pushAttempts = 0;
      const originalExec = mockExecutor.exec.bind(mockExecutor);

      mockExecutor.exec = async (command: string, cwd: string) => {
        if (command.includes("git push")) {
          pushAttempts++;
          if (pushAttempts === 1) {
            throw new Error("Connection timed out");
          }
          return "";
        }
        if (command.includes("git rev-parse HEAD")) {
          return "abc123";
        }
        return originalExec(command, cwd);
      };

      const strategy = new GitCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "test-branch",
        message: "Test commit",
        fileChanges: [],
        workDir: testDir,
        retries: 3,
      };

      const result = await strategy.commit(options);

      assert.equal(result.pushed, true);
      assert.equal(
        pushAttempts,
        2,
        "Push should have been attempted twice (initial + 1 retry)"
      );
    });

    test("escapes branch name in push command", async () => {
      mockExecutor.responses.set("git rev-parse HEAD", "abc123");

      const strategy = new GitCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "feature/branch-with-special'chars",
        message: "Test commit",
        fileChanges: [],
        workDir: testDir,
        retries: 0,
      };

      await strategy.commit(options);

      // Find the push command
      const pushCall = mockExecutor.calls.find((c) =>
        c.command.includes("git push")
      );
      assert.ok(pushCall, "Should have called git push");

      // The branch name should be properly escaped with single quotes
      // escapeShellArg wraps in single quotes and escapes internal single quotes
      assert.ok(
        pushCall.command.includes("'feature/branch-with-special'"),
        `Push command should escape branch name. Got: ${pushCall.command}`
      );
    });

    test("throws on permanent push error", async () => {
      mockExecutor.responses.set(
        "git push",
        new Error("Permission denied (publickey)")
      );

      const strategy = new GitCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "test-branch",
        message: "Test commit",
        fileChanges: [],
        workDir: testDir,
        retries: 3,
      };

      await assert.rejects(
        () => strategy.commit(options),
        /Permission denied/,
        "Should throw on permanent error without retrying"
      );
    });

    test("uses gitOps.push() when gitOps is provided", async () => {
      const mockGitOps = {
        push: mock.fn(async () => {}),
      };

      mockExecutor.responses.set("git rev-parse HEAD", "abc123def456");

      const strategy = new GitCommitStrategy(mockExecutor);

      await strategy.commit({
        repoInfo: githubRepoInfo,
        branchName: "test-branch",
        message: "test commit",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
        gitOps: mockGitOps as unknown as IAuthenticatedGitOps,
        force: true,
      });

      // Verify gitOps.push was called
      assert.strictEqual(
        mockGitOps.push.mock.calls.length,
        1,
        "gitOps.push should be called once"
      );
      assert.deepStrictEqual(mockGitOps.push.mock.calls[0].arguments, [
        "test-branch",
        { force: true },
      ]);

      // Verify raw git push was NOT called
      const pushCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("git push")
      );
      assert.strictEqual(
        pushCalls.length,
        0,
        "Should not call raw git push when gitOps is provided"
      );
    });

    test("falls back to raw git push when gitOps is not provided", async () => {
      mockExecutor.responses.set("git rev-parse HEAD", "abc123def456");

      const strategy = new GitCommitStrategy(mockExecutor);

      await strategy.commit({
        repoInfo: githubRepoInfo,
        branchName: "test-branch",
        message: "test commit",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
        // gitOps NOT provided
        force: true,
      });

      // Verify raw git push WAS called
      const pushCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("git push")
      );
      assert.strictEqual(
        pushCalls.length,
        1,
        "Should call raw git push when no gitOps"
      );
      assert.ok(
        pushCalls[0].command.includes("--force-with-lease"),
        "Should use force flag"
      );
    });
  });
});
