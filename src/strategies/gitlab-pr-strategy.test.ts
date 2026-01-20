import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GitLabPRStrategy } from "./gitlab-pr-strategy.js";
import { GitLabRepoInfo, AzureDevOpsRepoInfo } from "../repo-detector.js";
import { PRStrategyOptions } from "./pr-strategy.js";
import { CommandExecutor } from "../command-executor.js";

const testDir = join(process.cwd(), "test-gitlab-strategy-tmp");

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

describe("GitLabPRStrategy with mock executor", () => {
  const gitlabRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.com:myorg/myrepo.git",
    owner: "myorg",
    namespace: "myorg",
    repo: "myrepo",
    host: "gitlab.com",
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
    test("returns MR URL when MR exists", async () => {
      mockExecutor.responses.set(
        "glab mr list",
        '[{"iid": 123, "title": "Test MR"}]',
      );

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.checkExistingPR(options);

      assert.equal(
        result,
        "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
      );
      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("glab mr list"));
      assert.ok(mockExecutor.calls[0].command.includes("test-branch"));
    });

    test("returns null when no MR exists", async () => {
      mockExecutor.responses.set("glab mr list", "[]");

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.checkExistingPR(options);

      assert.equal(result, null);
    });

    test("returns null when response is empty", async () => {
      mockExecutor.responses.set("glab mr list", "");

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
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
      mockExecutor.responses.set("glab mr list", authError);

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
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
      mockExecutor.responses.set("glab mr list", networkError);

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
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
    test("creates MR and returns URL from output", async () => {
      mockExecutor.responses.set(
        "glab mr create",
        "Creating merge request...\nhttps://gitlab.com/myorg/myrepo/-/merge_requests/456",
      );

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.create(options);

      assert.equal(result.success, true);
      assert.equal(
        result.url,
        "https://gitlab.com/myorg/myrepo/-/merge_requests/456",
      );
      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("glab mr create"));
      assert.ok(mockExecutor.calls[0].command.includes("Test MR"));
    });

    test("creates MR and builds URL from MR number in output", async () => {
      mockExecutor.responses.set(
        "glab mr create",
        "Merge request !789 created",
      );

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.create(options);

      assert.equal(result.success, true);
      assert.equal(
        result.url,
        "https://gitlab.com/myorg/myrepo/-/merge_requests/789",
      );
    });

    test("cleans up description file after success", async () => {
      mockExecutor.responses.set(
        "glab mr create",
        "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
      );

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await strategy.create(options);

      const descFile = join(testDir, ".mr-description.md");
      assert.equal(existsSync(descFile), false);
    });

    test("cleans up description file after error", async () => {
      mockExecutor.responses.set("glab mr create", new Error("Command failed"));

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await assert.rejects(() => strategy.create(options));

      const descFile = join(testDir, ".mr-description.md");
      assert.equal(existsSync(descFile), false);
    });

    test("throws error when output contains no URL or MR number", async () => {
      mockExecutor.responses.set(
        "glab mr create",
        "Error: failed to create merge request",
      );

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await assert.rejects(
        () => strategy.create(options),
        /Could not parse MR URL/,
      );
    });
  });

  describe("execute (full workflow)", () => {
    test("returns existing MR if found", async () => {
      mockExecutor.responses.set(
        "glab mr list",
        '[{"iid": 999, "title": "Existing MR"}]',
      );

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.execute(options);

      assert.equal(result.success, true);
      assert.equal(
        result.url,
        "https://gitlab.com/myorg/myrepo/-/merge_requests/999",
      );
      assert.ok(result.message.includes("already exists"));
      // Should only call checkExistingPR, not create
      assert.equal(mockExecutor.calls.length, 1);
    });

    test("creates new MR if none exists", async () => {
      mockExecutor.responses.set("glab mr list", "[]");
      mockExecutor.responses.set(
        "glab mr create",
        "https://gitlab.com/myorg/myrepo/-/merge_requests/888",
      );

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.execute(options);

      assert.equal(result.success, true);
      assert.equal(
        result.url,
        "https://gitlab.com/myorg/myrepo/-/merge_requests/888",
      );
      // Should call both checkExistingPR and create
      assert.equal(mockExecutor.calls.length, 2);
    });

    test("returns failure on error", async () => {
      mockExecutor.responses.set("glab mr list", "[]");
      mockExecutor.responses.set(
        "glab mr create",
        new Error("Failed to create"),
      );

      const strategy = new GitLabPRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
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

describe("GitLabPRStrategy with nested groups", () => {
  const nestedRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.com:org/group/subgroup/repo.git",
    owner: "org",
    namespace: "org/group/subgroup",
    repo: "repo",
    host: "gitlab.com",
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

  test("builds correct MR URL for nested groups", async () => {
    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 42, "title": "Test MR"}]',
    );

    const strategy = new GitLabPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: nestedRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    const result = await strategy.checkExistingPR(options);

    assert.equal(
      result,
      "https://gitlab.com/org/group/subgroup/repo/-/merge_requests/42",
    );
  });

  test("uses correct repo flag for nested groups", async () => {
    mockExecutor.responses.set("glab mr list", "[]");

    const strategy = new GitLabPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: nestedRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    await strategy.checkExistingPR(options);

    assert.ok(
      mockExecutor.calls[0].command.includes("org/group/subgroup/repo"),
    );
  });
});

describe("GitLabPRStrategy closeExistingPR", () => {
  const gitlabRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.com:myorg/myrepo.git",
    owner: "myorg",
    namespace: "myorg",
    repo: "myrepo",
    host: "gitlab.com",
  };

  let mockExecutor: ReturnType<typeof createMockExecutor>;
  const testDirClose = join(process.cwd(), "test-gitlab-strategy-close-tmp");

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

  test("returns false when no MR exists", async () => {
    mockExecutor.responses.set("glab mr list", "[]");

    const strategy = new GitLabPRStrategy(mockExecutor);
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.equal(result, false);
  });

  test("closes MR and deletes branch when MR exists", async () => {
    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 123, "title": "Test MR"}]',
    );
    mockExecutor.responses.set("glab mr close", "");
    mockExecutor.responses.set("git push origin --delete", "");

    const strategy = new GitLabPRStrategy(mockExecutor);
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.equal(result, true);
    const closeCall = mockExecutor.calls.find((c) =>
      c.command.includes("glab mr close"),
    );
    assert.ok(closeCall);
    assert.ok(closeCall.command.includes("123"));
  });

  test("returns false when close command fails", async () => {
    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 123, "title": "Test MR"}]',
    );
    mockExecutor.responses.set("glab mr close", new Error("Close failed"));

    const strategy = new GitLabPRStrategy(mockExecutor);
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.equal(result, false);
  });

  test("deletes branch after closing MR", async () => {
    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 123, "title": "Test MR"}]',
    );
    mockExecutor.responses.set("glab mr close", "");
    mockExecutor.responses.set("git push origin --delete", "");

    const strategy = new GitLabPRStrategy(mockExecutor);
    await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    const deleteBranchCall = mockExecutor.calls.find((c) =>
      c.command.includes("git push origin --delete"),
    );
    assert.ok(deleteBranchCall, "Should call git push --delete");
    assert.ok(deleteBranchCall.command.includes("test-branch"));
  });

  test("returns true even when branch deletion fails", async () => {
    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 123, "title": "Test MR"}]',
    );
    mockExecutor.responses.set("glab mr close", "");
    mockExecutor.responses.set(
      "git push origin --delete",
      new Error("Branch deletion failed"),
    );

    const strategy = new GitLabPRStrategy(mockExecutor);
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    // Should still return true because MR was closed successfully
    assert.equal(result, true);
  });
});

describe("GitLabPRStrategy merge", () => {
  const gitlabRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.com:myorg/myrepo.git",
    owner: "myorg",
    namespace: "myorg",
    repo: "myrepo",
    host: "gitlab.com",
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

  describe("merge with manual mode", () => {
    test("returns success without making any calls", async () => {
      const strategy = new GitLabPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
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
    test("enables auto-merge when pipeline succeeds", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        config: { mode: "auto" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, false);
      assert.equal(result.autoMergeEnabled, true);
      assert.ok(result.message.includes("Auto-merge enabled"));

      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("glab mr merge"));
      assert.ok(
        mockExecutor.calls[0].command.includes("--when-pipeline-succeeds"),
      );
    });

    test("uses squash strategy when configured", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor);
      await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        config: { mode: "auto", strategy: "squash" },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls.find((c) =>
        c.command.includes("glab mr merge"),
      );
      assert.ok(mergeCall, "Should have called glab mr merge");
      assert.ok(mergeCall.command.includes("--squash"));
    });

    test("uses rebase strategy when configured", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor);
      await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        config: { mode: "auto", strategy: "rebase" },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls.find((c) =>
        c.command.includes("glab mr merge"),
      );
      assert.ok(mergeCall);
      assert.ok(mergeCall.command.includes("--rebase"));
    });

    test("uses remove-source-branch flag when configured", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor);
      await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        config: { mode: "auto", deleteBranch: true },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls.find((c) =>
        c.command.includes("glab mr merge"),
      );
      assert.ok(mergeCall);
      assert.ok(mergeCall.command.includes("--remove-source-branch"));
    });

    test("returns failure when glab mr merge fails", async () => {
      mockExecutor.responses.set("glab mr merge", new Error("Merge failed"));

      const strategy = new GitLabPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
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
    test("merges immediately without waiting for pipeline", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, true);
      assert.ok(result.message.includes("merged successfully"));

      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("glab mr merge"));
      // Should NOT have --when-pipeline-succeeds for force mode
      assert.ok(
        !mockExecutor.calls[0].command.includes("--when-pipeline-succeeds"),
      );
    });

    test("uses merge strategy with force mode", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor);
      await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        config: { mode: "force", strategy: "squash", deleteBranch: true },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls[0];
      assert.ok(mergeCall.command.includes("--squash"));
      assert.ok(mergeCall.command.includes("--remove-source-branch"));
    });

    test("returns failure when force merge fails", async () => {
      mockExecutor.responses.set(
        "glab mr merge",
        new Error("Merge not allowed"),
      );

      const strategy = new GitLabPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, false);
      assert.equal(result.merged, false);
      assert.ok(result.message.includes("Failed to force merge"));
    });
  });

  describe("merge URL parsing", () => {
    test("parses MR URL for nested groups", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl:
          "https://gitlab.com/org/group/subgroup/repo/-/merge_requests/456",
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.ok(
        mockExecutor.calls[0].command.includes("org/group/subgroup/repo"),
      );
    });

    test("returns failure for invalid MR URL", async () => {
      const strategy = new GitLabPRStrategy(mockExecutor);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/invalid-url",
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("Invalid GitLab MR URL"));
    });
  });
});

describe("GitLabPRStrategy URL extraction edge cases", () => {
  const gitlabRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.com:owner/repo.git",
    owner: "owner",
    namespace: "owner",
    repo: "repo",
    host: "gitlab.com",
  };

  let mockExecutor: ReturnType<typeof createMockExecutor>;
  const testDirEdge = join(process.cwd(), "test-gitlab-strategy-edge-tmp");

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

  test("does not capture trailing punctuation in URL", async () => {
    mockExecutor.responses.set(
      "glab mr create",
      "MR created: https://gitlab.com/owner/repo/-/merge_requests/123.",
    );

    const strategy = new GitLabPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: gitlabRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    const result = await strategy.create(options);

    assert.equal(
      result.url,
      "https://gitlab.com/owner/repo/-/merge_requests/123",
      "URL should not include trailing period",
    );
  });

  test("rejects non-MR GitLab URLs (issue URL)", async () => {
    mockExecutor.responses.set(
      "glab mr create",
      "See related: https://gitlab.com/owner/repo/-/issues/456",
    );

    const strategy = new GitLabPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: gitlabRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    await assert.rejects(
      () => strategy.create(options),
      /Could not parse MR URL/,
    );
  });

  test("rejects non-MR GitLab URLs (commit URL)", async () => {
    mockExecutor.responses.set(
      "glab mr create",
      "Based on commit https://gitlab.com/owner/repo/-/commit/abc123",
    );

    const strategy = new GitLabPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: gitlabRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    await assert.rejects(
      () => strategy.create(options),
      /Could not parse MR URL/,
    );
  });

  test("extracts valid MR URL with trailing newline", async () => {
    mockExecutor.responses.set(
      "glab mr create",
      "https://gitlab.com/owner/repo/-/merge_requests/789\n",
    );

    const strategy = new GitLabPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: gitlabRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    const result = await strategy.create(options);

    assert.equal(
      result.url,
      "https://gitlab.com/owner/repo/-/merge_requests/789",
    );
  });
});

describe("GitLabPRStrategy type guards", () => {
  const azureRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "git@ssh.dev.azure.com:v3/org/project/repo",
    owner: "org",
    repo: "repo",
    organization: "org",
    project: "project",
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

  test("checkExistingPR throws for non-GitLab repo", async () => {
    const strategy = new GitLabPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: azureRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    await assert.rejects(
      () => strategy.checkExistingPR(options),
      /Expected GitLab repository/,
    );
  });

  test("create throws for non-GitLab repo", async () => {
    const strategy = new GitLabPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: azureRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    await assert.rejects(
      () => strategy.create(options),
      /Expected GitLab repository/,
    );
  });

  test("closeExistingPR throws for non-GitLab repo", async () => {
    const strategy = new GitLabPRStrategy(mockExecutor);

    await assert.rejects(
      () =>
        strategy.closeExistingPR({
          repoInfo: azureRepoInfo,
          branchName: "test-branch",
          baseBranch: "main",
          workDir: testDir,
          retries: 0,
        }),
      /Expected GitLab repository/,
    );
  });
});

describe("GitLabPRStrategy self-hosted", () => {
  const selfHostedRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.example.com:myorg/myrepo.git",
    owner: "myorg",
    namespace: "myorg",
    repo: "myrepo",
    host: "gitlab.example.com",
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

  test("builds correct MR URL for self-hosted GitLab", async () => {
    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 77, "title": "Test MR"}]',
    );

    const strategy = new GitLabPRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: selfHostedRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    const result = await strategy.checkExistingPR(options);

    assert.equal(
      result,
      "https://gitlab.example.com/myorg/myrepo/-/merge_requests/77",
    );
  });
});
