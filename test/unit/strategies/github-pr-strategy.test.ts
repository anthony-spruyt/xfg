import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GitHubPRStrategy } from "../../../src/vcs/github-pr-strategy.js";
import { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import { PRStrategyOptions } from "../../../src/vcs/pr-strategy.js";
import { ICommandExecutor } from "../../../src/shared/command-executor.js";

const testDir = join(process.cwd(), "test-github-strategy-tmp");

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

describe("GitHubPRStrategy with mock executor", () => {
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

  describe("checkExistingPR", () => {
    test("returns PR URL when PR exists", async () => {
      mockExecutor.responses.set(
        "gh pr list",
        "https://github.com/owner/repo/pull/123"
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
        "Creating pull request...\nhttps://github.com/owner/repo/pull/456"
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
        "Some prefix text\nhttps://github.com/owner/repo/pull/789\nSome suffix text"
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

    test("uses github.com as default host when host is undefined", async () => {
      mockExecutor.responses.set(
        "gh pr create",
        "https://github.com/owner/repo/pull/999"
      );

      // Test defensive fallback when host is undefined at runtime
      const repoInfoWithoutHost = {
        type: "github" as const,
        gitUrl: "git@github.com:owner/repo.git",
        owner: "owner",
        repo: "repo",
      } as GitHubRepoInfo;

      const strategy = new GitHubPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: repoInfoWithoutHost,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.create(options);

      assert.equal(result.success, true);
      // URL regex should still match using default github.com
      assert.equal(result.url, "https://github.com/owner/repo/pull/999");
    });

    test("cleans up body file after success", async () => {
      mockExecutor.responses.set(
        "gh pr create",
        "https://github.com/owner/repo/pull/123"
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
        "https://github.com/owner/repo/pull/existing"
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
        "https://github.com/owner/repo/pull/999"
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
      assert.equal(result.url, "https://github.com/owner/repo/pull/999");
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

describe("GitHubPRStrategy cleanup error handling", () => {
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

  test("succeeds and cleans up temp file on success", async () => {
    mockExecutor.responses.set(
      "gh pr create",
      "https://github.com/owner/repo/pull/123"
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
    const bodyFile = join(testDir, ".pr-body.md");
    assert.equal(existsSync(bodyFile), false, "Temp file should be cleaned up");
  });

  test("cleans up temp file even when PR creation fails", async () => {
    mockExecutor.responses.set("gh pr create", new Error("PR creation failed"));

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
    assert.equal(
      existsSync(bodyFile),
      false,
      "Temp file should be cleaned up even on error"
    );
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

describe("GitHubPRStrategy URL extraction edge cases (TDD for issue #92)", () => {
  const githubRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
    host: "github.com",
  };

  let mockExecutor: ReturnType<typeof createMockExecutor>;
  const testDirEdge = join(process.cwd(), "test-github-strategy-edge-tmp");

  beforeEach(() => {
    mockExecutor = createMockExecutor();
    if (existsSync(testDirEdge)) {
      rmSync(testDirEdge, { recursive: true, force: true });
    }
    mkdirSync(testDirEdge, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDirEdge)) {
      rmSync(testDirEdge, { recursive: true, force: true });
    }
  });

  test("throws error when output contains no URL", async () => {
    // BUG: Currently returns the error message as the URL instead of throwing
    mockExecutor.responses.set(
      "gh pr create",
      "Error: failed to create pull request"
    );

    const strategy = new GitHubPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: githubRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    await assert.rejects(
      () => strategy.create(options),
      /Could not parse PR URL/
    );
  });

  test("does not capture trailing punctuation in URL", async () => {
    // BUG: [^\s]+ captures trailing period/punctuation
    mockExecutor.responses.set(
      "gh pr create",
      "PR created: https://github.com/owner/repo/pull/123."
    );

    const strategy = new GitHubPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: githubRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    const result = await strategy.create(options);

    assert.equal(
      result.url,
      "https://github.com/owner/repo/pull/123",
      "URL should not include trailing period"
    );
  });

  test("rejects non-PR GitHub URLs (issue URL)", async () => {
    // BUG: Current regex matches any GitHub URL, not just PR URLs
    mockExecutor.responses.set(
      "gh pr create",
      "See related: https://github.com/owner/repo/issues/456"
    );

    const strategy = new GitHubPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: githubRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    await assert.rejects(
      () => strategy.create(options),
      /Could not parse PR URL/
    );
  });

  test("rejects non-PR GitHub URLs (commit URL)", async () => {
    // BUG: Current regex matches any GitHub URL, not just PR URLs
    mockExecutor.responses.set(
      "gh pr create",
      "Based on commit https://github.com/owner/repo/commit/abc123"
    );

    const strategy = new GitHubPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: githubRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    await assert.rejects(
      () => strategy.create(options),
      /Could not parse PR URL/
    );
  });

  test("extracts valid PR URL with trailing newline", async () => {
    mockExecutor.responses.set(
      "gh pr create",
      "https://github.com/owner/repo/pull/789\n"
    );

    const strategy = new GitHubPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: githubRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    const result = await strategy.create(options);

    assert.equal(result.url, "https://github.com/owner/repo/pull/789");
  });
});

describe("GitHubPRStrategy closeExistingPR", () => {
  const githubRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
    host: "github.com",
  };

  let mockExecutor: ReturnType<typeof createMockExecutor>;
  const testDirClose = join(process.cwd(), "test-github-strategy-close-tmp");

  beforeEach(() => {
    mockExecutor = createMockExecutor();
    if (existsSync(testDirClose)) {
      rmSync(testDirClose, { recursive: true, force: true });
    }
    mkdirSync(testDirClose, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDirClose)) {
      rmSync(testDirClose, { recursive: true, force: true });
    }
  });

  test("returns false when no PR exists", async () => {
    mockExecutor.responses.set("gh pr list", "");

    const strategy = new GitHubPRStrategy(mockExecutor);
    const result = await strategy.closeExistingPR({
      repoInfo: githubRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.equal(result, false);
  });

  test("closes PR and returns true when PR exists", async () => {
    mockExecutor.responses.set(
      "gh pr list",
      "https://github.com/owner/repo/pull/123"
    );
    mockExecutor.responses.set("gh pr close", "");

    const strategy = new GitHubPRStrategy(mockExecutor);
    const result = await strategy.closeExistingPR({
      repoInfo: githubRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.equal(result, true);
    const closeCall = mockExecutor.calls.find((c) =>
      c.command.includes("gh pr close")
    );
    assert.ok(closeCall);
    assert.ok(closeCall.command.includes("123"));
    assert.ok(closeCall.command.includes("--delete-branch"));
  });

  test("throws error when PR number cannot be extracted from URL (issue #93)", async () => {
    // This tests the fix for issue #93: when checkExistingPR returns a URL
    // but we can't extract the PR number, we should throw an error rather
    // than returning false (which would incorrectly indicate no PR exists)
    mockExecutor.responses.set(
      "gh pr list",
      "https://github.com/owner/repo/invalid-url-format"
    );

    const strategy = new GitHubPRStrategy(mockExecutor);

    await assert.rejects(
      () =>
        strategy.closeExistingPR({
          repoInfo: githubRepoInfo,
          branchName: "test-branch",
          baseBranch: "main",
          workDir: testDirClose,
          retries: 0,
        }),
      /Could not extract PR number from URL/
    );
  });

  test("returns false when close command fails", async () => {
    mockExecutor.responses.set(
      "gh pr list",
      "https://github.com/owner/repo/pull/123"
    );
    mockExecutor.responses.set("gh pr close", new Error("Close failed"));

    const strategy = new GitHubPRStrategy(mockExecutor);
    const result = await strategy.closeExistingPR({
      repoInfo: githubRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.equal(result, false);
  });
});

describe("GitHubPRStrategy with GitHub Enterprise Server", () => {
  const gheRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.mycompany.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
    host: "github.mycompany.com",
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

  test("uses HOST/OWNER/REPO format for GHE in pr list", async () => {
    mockExecutor.responses.set("gh pr list", "");

    const strategy = new GitHubPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: gheRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    await strategy.checkExistingPR(options);

    assert.ok(mockExecutor.calls[0].command.includes("--repo"));
    assert.ok(
      mockExecutor.calls[0].command.includes(
        "'github.mycompany.com/owner/repo'"
      )
    );
  });

  test("uses --hostname flag for gh api on GHE", async () => {
    mockExecutor.responses.set("gh api", "true");

    const strategy = new GitHubPRStrategy(mockExecutor);
    await strategy.checkAutoMergeEnabled(gheRepoInfo, testDir, 0);

    assert.ok(mockExecutor.calls[0].command.includes("--hostname"));
    assert.ok(mockExecutor.calls[0].command.includes("'github.mycompany.com'"));
  });

  test("extracts GHE PR URL correctly", async () => {
    mockExecutor.responses.set(
      "gh pr create",
      "https://github.mycompany.com/owner/repo/pull/123"
    );

    const strategy = new GitHubPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: gheRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    const result = await strategy.create(options);

    assert.equal(
      result.url,
      "https://github.mycompany.com/owner/repo/pull/123"
    );
  });

  test("uses HOST/OWNER/REPO format for GHE in pr close", async () => {
    mockExecutor.responses.set(
      "gh pr list",
      "https://github.mycompany.com/owner/repo/pull/123"
    );
    mockExecutor.responses.set("gh pr close", "");

    const strategy = new GitHubPRStrategy(mockExecutor);
    await strategy.closeExistingPR({
      repoInfo: gheRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    });

    const closeCall = mockExecutor.calls.find((c) =>
      c.command.includes("gh pr close")
    );
    assert.ok(closeCall);
    assert.ok(closeCall.command.includes("'github.mycompany.com/owner/repo'"));
  });
});

describe("GitHubPRStrategy merge", () => {
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

  describe("checkAutoMergeEnabled", () => {
    test("returns true when auto-merge is enabled", async () => {
      mockExecutor.responses.set("gh api repos", "true");

      const strategy = new GitHubPRStrategy(mockExecutor);
      const result = await strategy.checkAutoMergeEnabled(
        githubRepoInfo,
        testDir,
        0
      );

      assert.equal(result, true);
      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("gh api repos"));
      assert.ok(mockExecutor.calls[0].command.includes("allow_auto_merge"));
    });

    test("returns false when auto-merge is disabled", async () => {
      mockExecutor.responses.set("gh api repos", "false");

      const strategy = new GitHubPRStrategy(mockExecutor);
      const result = await strategy.checkAutoMergeEnabled(
        githubRepoInfo,
        testDir,
        0
      );

      assert.equal(result, false);
    });

    test("returns false on API error", async () => {
      mockExecutor.responses.set("gh api repos", new Error("API error"));

      const strategy = new GitHubPRStrategy(mockExecutor);
      const result = await strategy.checkAutoMergeEnabled(
        githubRepoInfo,
        testDir,
        0
      );

      assert.equal(result, false);
    });
  });

  describe("merge with manual mode", () => {
    test("returns success without making any calls", async () => {
      const strategy = new GitHubPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://github.com/owner/repo/pull/123",
        config: { mode: "manual" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, false);
      assert.ok(result.message.includes("manual review"));
      assert.equal(mockExecutor.calls.length, 0);
    });
  });

  describe("merge with auto mode", () => {
    test("enables auto-merge when repo has it enabled", async () => {
      mockExecutor.responses.set("gh api repos", "true");
      mockExecutor.responses.set("gh pr merge", "");

      const strategy = new GitHubPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://github.com/owner/repo/pull/123",
        config: { mode: "auto" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, false);
      assert.equal(result.autoMergeEnabled, true);
      assert.ok(result.message.includes("Auto-merge enabled"));

      // Should call gh api to check, then gh pr merge --auto
      assert.equal(mockExecutor.calls.length, 2);
      assert.ok(mockExecutor.calls[1].command.includes("gh pr merge"));
      assert.ok(mockExecutor.calls[1].command.includes("--auto"));
    });

    test("falls back to manual when auto-merge not enabled on repo", async () => {
      mockExecutor.responses.set("gh api repos", "false");

      const strategy = new GitHubPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://github.com/owner/repo/pull/123",
        config: { mode: "auto" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, false);
      assert.equal(result.autoMergeEnabled, false);
      assert.ok(result.message.includes("Auto-merge not enabled"));

      // Should only call gh api to check, not gh pr merge
      assert.equal(mockExecutor.calls.length, 1);
    });

    test("uses squash strategy when configured", async () => {
      mockExecutor.responses.set("gh api repos", "true");
      mockExecutor.responses.set("gh pr merge", "");

      const strategy = new GitHubPRStrategy(mockExecutor);
      await strategy.merge({
        prUrl: "https://github.com/owner/repo/pull/123",
        config: { mode: "auto", strategy: "squash" },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls.find((c) =>
        c.command.includes("gh pr merge")
      );
      assert.ok(mergeCall, "Should have called gh pr merge");
      assert.ok(mergeCall.command.includes("--squash"));
    });

    test("uses rebase strategy when configured", async () => {
      mockExecutor.responses.set("gh api repos", "true");
      mockExecutor.responses.set("gh pr merge", "");

      const strategy = new GitHubPRStrategy(mockExecutor);
      await strategy.merge({
        prUrl: "https://github.com/owner/repo/pull/123",
        config: { mode: "auto", strategy: "rebase" },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls.find((c) =>
        c.command.includes("gh pr merge")
      );
      assert.ok(mergeCall);
      assert.ok(mergeCall.command.includes("--rebase"));
    });

    test("uses delete-branch flag when configured", async () => {
      mockExecutor.responses.set("gh api repos", "true");
      mockExecutor.responses.set("gh pr merge", "");

      const strategy = new GitHubPRStrategy(mockExecutor);
      await strategy.merge({
        prUrl: "https://github.com/owner/repo/pull/123",
        config: { mode: "auto", deleteBranch: true },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls.find((c) =>
        c.command.includes("gh pr merge")
      );
      assert.ok(mergeCall);
      assert.ok(mergeCall.command.includes("--delete-branch"));
    });

    test("returns failure when gh pr merge fails", async () => {
      mockExecutor.responses.set("gh api repos", "true");
      mockExecutor.responses.set("gh pr merge", new Error("Merge failed"));

      const strategy = new GitHubPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://github.com/owner/repo/pull/123",
        config: { mode: "auto" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, false);
      assert.equal(result.merged, false);
      assert.ok(result.message.includes("Failed to enable auto-merge"));
    });
  });

  describe("merge with force mode", () => {
    test("uses admin flag to bypass requirements", async () => {
      mockExecutor.responses.set("gh pr merge", "");

      const strategy = new GitHubPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://github.com/owner/repo/pull/123",
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, true);
      assert.ok(result.message.includes("admin privileges"));

      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("gh pr merge"));
      assert.ok(mockExecutor.calls[0].command.includes("--admin"));
    });

    test("uses merge strategy with force mode", async () => {
      mockExecutor.responses.set("gh pr merge", "");

      const strategy = new GitHubPRStrategy(mockExecutor);
      await strategy.merge({
        prUrl: "https://github.com/owner/repo/pull/123",
        config: { mode: "force", strategy: "squash", deleteBranch: true },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls[0];
      assert.ok(mergeCall.command.includes("--admin"));
      assert.ok(mergeCall.command.includes("--squash"));
      assert.ok(mergeCall.command.includes("--delete-branch"));
    });

    test("returns failure when force merge fails", async () => {
      mockExecutor.responses.set(
        "gh pr merge",
        new Error("Must be admin to merge")
      );

      const strategy = new GitHubPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://github.com/owner/repo/pull/123",
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, false);
      assert.equal(result.merged, false);
      assert.ok(result.message.includes("Failed to force merge"));
    });
  });
});

describe("GitHubPRStrategy with token parameter", () => {
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

  test("checkExistingPR uses GH_TOKEN env prefix when token is provided", async () => {
    mockExecutor.responses.set(
      "gh pr list",
      "https://github.com/owner/repo/pull/123"
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
      token: "ghs_test_token_12345",
    };

    await strategy.checkExistingPR(options);

    assert.ok(mockExecutor.calls[0].command.startsWith("GH_TOKEN="));
    assert.ok(
      mockExecutor.calls[0].command.includes("ghs_test_token_12345"),
      "Command should include the token"
    );
  });

  test("create uses GH_TOKEN env prefix when token is provided", async () => {
    mockExecutor.responses.set(
      "gh pr create",
      "https://github.com/owner/repo/pull/456"
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
      token: "ghs_test_token_12345",
    };

    await strategy.create(options);

    const createCall = mockExecutor.calls.find((c) =>
      c.command.includes("gh pr create")
    );
    assert.ok(createCall, "Should have called gh pr create");
    assert.ok(
      createCall.command.startsWith("GH_TOKEN="),
      "Command should start with GH_TOKEN="
    );
    assert.ok(
      createCall.command.includes("ghs_test_token_12345"),
      "Command should include the token"
    );
  });

  test("closeExistingPR uses GH_TOKEN env prefix when token is provided", async () => {
    mockExecutor.responses.set(
      "gh pr list",
      "https://github.com/owner/repo/pull/123"
    );
    mockExecutor.responses.set("gh pr close", "");

    const strategy = new GitHubPRStrategy(mockExecutor);
    await strategy.closeExistingPR({
      repoInfo: githubRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
      token: "ghs_test_token_12345",
    });

    // Both list and close should use the token
    const listCall = mockExecutor.calls.find((c) =>
      c.command.includes("gh pr list")
    );
    const closeCall = mockExecutor.calls.find((c) =>
      c.command.includes("gh pr close")
    );

    assert.ok(listCall?.command.startsWith("GH_TOKEN="));
    assert.ok(closeCall?.command.startsWith("GH_TOKEN="));
  });

  test("merge uses GH_TOKEN env prefix when token is provided", async () => {
    mockExecutor.responses.set("gh api repos", "true");
    mockExecutor.responses.set("gh pr merge", "");

    const strategy = new GitHubPRStrategy(mockExecutor);
    await strategy.merge({
      prUrl: "https://github.com/owner/repo/pull/123",
      config: { mode: "auto" },
      workDir: testDir,
      retries: 0,
      token: "ghs_test_token_12345",
    });

    // Both api and merge should use the token
    const apiCall = mockExecutor.calls.find((c) =>
      c.command.includes("gh api")
    );
    const mergeCall = mockExecutor.calls.find((c) =>
      c.command.includes("gh pr merge")
    );

    assert.ok(
      apiCall?.command.startsWith("GH_TOKEN="),
      "gh api call should use token"
    );
    assert.ok(
      mergeCall?.command.startsWith("GH_TOKEN="),
      "gh pr merge call should use token"
    );
  });

  test("commands without token do not have GH_TOKEN prefix", async () => {
    mockExecutor.responses.set(
      "gh pr list",
      "https://github.com/owner/repo/pull/123"
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
      // No token provided
    };

    await strategy.checkExistingPR(options);

    assert.ok(
      !mockExecutor.calls[0].command.startsWith("GH_TOKEN="),
      "Command should not have GH_TOKEN prefix when no token is provided"
    );
    assert.ok(
      mockExecutor.calls[0].command.startsWith("gh pr list"),
      "Command should start with gh pr list"
    );
  });
});
