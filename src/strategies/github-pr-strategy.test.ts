import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GitHubPRStrategy } from "./github-pr-strategy.js";
import { GitHubRepoInfo } from "../repo-detector.js";
import { PRStrategyOptions } from "./pr-strategy.js";
import { CommandExecutor } from "../command-executor.js";

const testDir = join(process.cwd(), "test-github-strategy-tmp");

// Mock executor for testing - implements CommandExecutor interface
function createMockExecutor(): CommandExecutor & {
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

describe("GitHubPRStrategy with mock executor", () => {
  const githubRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
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

  describe("checkExistingPR", () => {
    test("returns PR URL when PR exists", async () => {
      mockExecutor.responses.set(
        "gh pr list",
        "https://github.com/owner/repo/pull/123",
      );

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.checkExistingPR(options);

      assert.equal(result, "https://github.com/owner/repo/pull/123");
      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("gh pr list"));
      assert.ok(mockExecutor.calls[0].command.includes("test-branch"));
    });

    test("returns null when no PR exists", async () => {
      mockExecutor.responses.set("gh pr list", "");

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.checkExistingPR(options);

      assert.equal(result, null);
    });

    test("throws on permanent error (auth failure)", async () => {
      const authError = new Error("401 Unauthorized - Bad credentials");
      mockExecutor.responses.set("gh pr list", authError);

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await assert.rejects(() => strategy.checkExistingPR(options), /401/);
    });

    test("returns null on transient error", async () => {
      const networkError = new Error("Connection timed out");
      mockExecutor.responses.set("gh pr list", networkError);

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.checkExistingPR(options);
      assert.equal(result, null);
    });
  });

  describe("create", () => {
    test("creates PR and returns URL", async () => {
      mockExecutor.responses.set(
        "gh pr create",
        "Creating pull request...\nhttps://github.com/owner/repo/pull/456",
      );

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.create(options);

      assert.equal(result.success, true);
      assert.equal(result.url, "https://github.com/owner/repo/pull/456");
      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("gh pr create"));
      assert.ok(mockExecutor.calls[0].command.includes("Test PR"));
    });

    test("extracts URL from verbose output", async () => {
      mockExecutor.responses.set(
        "gh pr create",
        "Some prefix text\nhttps://github.com/owner/repo/pull/789\nSome suffix text",
      );

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.create(options);

      assert.equal(result.url, "https://github.com/owner/repo/pull/789");
    });

    test("cleans up body file after success", async () => {
      mockExecutor.responses.set(
        "gh pr create",
        "https://github.com/owner/repo/pull/123",
      );

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await strategy.create(options);

      const bodyFile = join(testDir, ".pr-body.md");
      assert.equal(existsSync(bodyFile), false);
    });

    test("cleans up body file after error", async () => {
      mockExecutor.responses.set("gh pr create", new Error("Command failed"));

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await assert.rejects(() => strategy.create(options));

      const bodyFile = join(testDir, ".pr-body.md");
      assert.equal(existsSync(bodyFile), false);
    });
  });

  describe("execute (full workflow)", () => {
    test("returns existing PR if found", async () => {
      mockExecutor.responses.set(
        "gh pr list",
        "https://github.com/owner/repo/pull/existing",
      );

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.execute(options);

      assert.equal(result.success, true);
      assert.equal(result.url, "https://github.com/owner/repo/pull/existing");
      assert.ok(result.message.includes("already exists"));
      // Should only call checkExistingPR, not create
      assert.equal(mockExecutor.calls.length, 1);
    });

    test("creates new PR if none exists", async () => {
      mockExecutor.responses.set("gh pr list", "");
      mockExecutor.responses.set(
        "gh pr create",
        "https://github.com/owner/repo/pull/new",
      );

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.execute(options);

      assert.equal(result.success, true);
      assert.equal(result.url, "https://github.com/owner/repo/pull/new");
      // Should call both checkExistingPR and create
      assert.equal(mockExecutor.calls.length, 2);
    });

    test("returns failure on error", async () => {
      mockExecutor.responses.set("gh pr list", "");
      mockExecutor.responses.set("gh pr create", new Error("Failed to create"));

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: githubRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.execute(options);

      assert.equal(result.success, false);
      assert.ok(result.message.includes("Failed to create PR"));
    });
  });
});

describe("GitHubPRStrategy URL extraction", () => {
  test("extracts URL from gh output with extra text", () => {
    const regex = /https:\/\/github\.com\/[^\s]+/;

    const outputs = [
      "https://github.com/owner/repo/pull/123",
      "Creating pull request for branch...\nhttps://github.com/owner/repo/pull/456",
      "https://github.com/owner/repo/pull/789\nDone!",
    ];

    for (const output of outputs) {
      const match = output.match(regex);
      assert.ok(match, `Should extract URL from: ${output}`);
      assert.ok(match[0].startsWith("https://github.com/"));
    }
  });

  test("handles output without URL", () => {
    const regex = /https:\/\/github\.com\/[^\s]+/;
    const output = "Error: something went wrong";

    const match = output.match(regex);
    assert.equal(match, null);
  });
});
