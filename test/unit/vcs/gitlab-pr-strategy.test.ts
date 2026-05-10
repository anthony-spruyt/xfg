import { describe, test, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitLabPRStrategy } from "../../../src/vcs/gitlab-pr-strategy.js";
import { PRWorkflowExecutor } from "../../../src/vcs/pr-strategy.js";
import {
  GitLabRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../../src/repo/index.js";
import type { PRStrategyOptions } from "../../../src/vcs/types.js";
import {
  createMockExecutor,
  type ExecutorMockResult,
} from "../../mocks/executor.mock.js";

const testDir = join(tmpdir(), "test-gitlab-strategy-tmp");

describe("GitLabPRStrategy with mock executor", () => {
  const gitlabRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.com:myorg/myrepo.git",
    owner: "myorg",
    namespace: "myorg",
    repo: "myrepo",
    host: "gitlab.com",
  };

  let mockExecutor: ExecutorMockResult;

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

  describe("findExistingPRUrl", () => {
    test("returns MR URL when MR exists", async () => {
      mockExecutor.responses.set(
        "glab mr list",
        '[{"iid": 123, "title": "Test MR"}]'
      );

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.findExistingPRUrl(options);

      assert.equal(
        result,
        "https://gitlab.com/myorg/myrepo/-/merge_requests/123"
      );
      assert.equal(mockExecutor.calls.length, 1);
      assert.equal(mockExecutor.calls[0].executable, "glab");
      assert.ok(mockExecutor.calls[0].args.includes("list"));
      assert.ok(mockExecutor.calls[0].args.includes("test-branch"));
    });

    test("returns null when no MR exists", async () => {
      mockExecutor.responses.set("glab mr list", "[]");

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.findExistingPRUrl(options);

      assert.equal(result, null);
    });

    test("returns null when response is empty", async () => {
      mockExecutor.responses.set("glab mr list", "");

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.findExistingPRUrl(options);

      assert.equal(result, null);
    });

    test("throws on permanent error (auth failure)", async () => {
      const authError = new Error("401 Unauthorized - Bad credentials");
      mockExecutor.responses.set("glab mr list", authError);

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
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
        () => strategy.findExistingPRUrl(options),
        /401 Unauthorized/
      );
    });

    test("returns null on transient error", async () => {
      const networkError = new Error("Connection timed out");
      mockExecutor.responses.set("glab mr list", networkError);

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.findExistingPRUrl(options);
      assert.equal(result, null);
    });

    test("returns null and logs debug on transient error with stderr", async () => {
      const errorWithStderr = Object.assign(new Error("Command failed"), {
        stderr: "glab: connection refused",
      });
      mockExecutor.responses.set("glab mr list", errorWithStderr);

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.findExistingPRUrl(options);
      assert.equal(result, null);
    });
  });

  describe("create", () => {
    test("creates MR and returns URL from output", async () => {
      mockExecutor.responses.set(
        "glab mr create",
        "Creating merge request...\nhttps://gitlab.com/myorg/myrepo/-/merge_requests/456"
      );

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
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
        "https://gitlab.com/myorg/myrepo/-/merge_requests/456"
      );
      assert.equal(mockExecutor.calls.length, 1);
      assert.equal(mockExecutor.calls[0].executable, "glab");
      assert.ok(mockExecutor.calls[0].args.includes("create"));
      assert.ok(mockExecutor.calls[0].args.includes("Test MR"));
      assert.ok(mockExecutor.calls[0].args.includes("--description"));
      assert.ok(mockExecutor.calls[0].args.includes("Test body"));
    });

    test("creates MR and builds URL from MR number in output", async () => {
      mockExecutor.responses.set(
        "glab mr create",
        "Merge request !789 created"
      );

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
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
        "https://gitlab.com/myorg/myrepo/-/merge_requests/789"
      );
    });

    test("throws error when output contains no URL or MR number", async () => {
      mockExecutor.responses.set(
        "glab mr create",
        "Error: failed to create merge request"
      );

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
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
        /Could not parse MR URL/
      );
    });

    test("passes body via --description arg", async () => {
      mockExecutor.responses.set(
        "glab mr create",
        "https://gitlab.com/myorg/myrepo/-/merge_requests/100"
      );

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Large MR body content",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await strategy.create(options);

      const descIndex = mockExecutor.calls[0].args.indexOf("--description");
      assert.ok(descIndex !== -1, "Should have --description flag");
      assert.equal(
        mockExecutor.calls[0].args[descIndex + 1],
        "Large MR body content"
      );
    });
  });

  describe("execute (full workflow)", () => {
    test("returns existing MR if found", async () => {
      mockExecutor.responses.set(
        "glab mr list",
        '[{"iid": 999, "title": "Existing MR"}]'
      );

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await new PRWorkflowExecutor(strategy).execute(options);

      assert.equal(result.success, true);
      assert.equal(
        result.url,
        "https://gitlab.com/myorg/myrepo/-/merge_requests/999"
      );
      assert.ok(result.message.includes("already exists"));
      // Should only call findExistingPRUrl, not create
      assert.equal(mockExecutor.calls.length, 1);
    });

    test("creates new MR if none exists", async () => {
      mockExecutor.responses.set("glab mr list", "[]");
      mockExecutor.responses.set(
        "glab mr create",
        "https://gitlab.com/myorg/myrepo/-/merge_requests/888"
      );

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await new PRWorkflowExecutor(strategy).execute(options);

      assert.equal(result.success, true);
      assert.equal(
        result.url,
        "https://gitlab.com/myorg/myrepo/-/merge_requests/888"
      );
      // Should call both findExistingPRUrl and create
      assert.equal(mockExecutor.calls.length, 2);
    });

    test("returns failure on error", async () => {
      mockExecutor.responses.set("glab mr list", "[]");
      mockExecutor.responses.set(
        "glab mr create",
        new Error("Failed to create")
      );

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: gitlabRepoInfo,
        title: "Test MR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await new PRWorkflowExecutor(strategy).execute(options);

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

  let mockExecutor: ExecutorMockResult;

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
      '[{"iid": 42, "title": "Test MR"}]'
    );

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
    const options: PRStrategyOptions = {
      repoInfo: nestedRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    const result = await strategy.findExistingPRUrl(options);

    assert.equal(
      result,
      "https://gitlab.com/org/group/subgroup/repo/-/merge_requests/42"
    );
  });

  test("uses correct repo flag for nested groups", async () => {
    mockExecutor.responses.set("glab mr list", "[]");

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
    const options: PRStrategyOptions = {
      repoInfo: nestedRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    await strategy.findExistingPRUrl(options);

    assert.ok(mockExecutor.calls[0].args.includes("org/group/subgroup/repo"));
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

  let mockExecutor: ExecutorMockResult;
  const testDirClose = join(tmpdir(), "test-gitlab-strategy-close-tmp");

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

  test("returns no_pr when no MR exists", async () => {
    mockExecutor.responses.set("glab mr list", "[]");

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.deepStrictEqual(result, { status: "no_pr" });
  });

  test("closes MR and deletes branch when MR exists", async () => {
    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 123, "title": "Test MR"}]'
    );
    mockExecutor.responses.set("glab mr close", "");
    mockExecutor.responses.set("git push origin --delete", "");

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.deepStrictEqual(result, { status: "closed" });
    const closeCall = mockExecutor.calls.find(
      (c) => c.executable === "glab" && c.args.includes("close")
    );
    assert.ok(closeCall);
    assert.ok(closeCall.args.includes("123"));
  });

  test("returns close_failed when close command fails", async () => {
    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 123, "title": "Test MR"}]'
    );
    mockExecutor.responses.set("glab mr close", new Error("Close failed"));

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.equal(result.status, "close_failed");
  });

  test("deletes branch after closing MR", async () => {
    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 123, "title": "Test MR"}]'
    );
    mockExecutor.responses.set("glab mr close", "");
    mockExecutor.responses.set("git push origin --delete", "");

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
    await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    const deleteBranchCall = mockExecutor.calls.find(
      (c) =>
        c.executable === "git" &&
        c.args.includes("push") &&
        c.args.includes("--delete")
    );
    assert.ok(deleteBranchCall, "Should call git push --delete");
    assert.ok(deleteBranchCall.args.includes("test-branch"));
  });

  test("returns close_failed when branch deletion fails", async () => {
    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 123, "title": "Test MR"}]'
    );
    mockExecutor.responses.set("glab mr close", "");
    mockExecutor.responses.set(
      "git push origin --delete",
      new Error("Branch deletion failed")
    );

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.strictEqual(result.status, "close_failed");
    assert.ok(
      "message" in result &&
        result.message.includes("branch test-branch deletion failed")
    );
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

  let mockExecutor: ExecutorMockResult;

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
      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        repoInfo: gitlabRepoInfo,
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

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        repoInfo: gitlabRepoInfo,
        config: { mode: "auto" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, false);
      assert.equal(result.autoMergeEnabled, true);
      assert.ok(result.message.includes("Auto-merge enabled"));

      assert.equal(mockExecutor.calls.length, 1);
      assert.equal(mockExecutor.calls[0].executable, "glab");
      assert.ok(mockExecutor.calls[0].args.includes("merge"));
      assert.ok(
        mockExecutor.calls[0].args.includes("--when-pipeline-succeeds")
      );
    });

    test("uses squash strategy when configured", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        repoInfo: gitlabRepoInfo,
        config: { mode: "auto", strategy: "squash" },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls.find(
        (c) => c.executable === "glab" && c.args.includes("merge")
      );
      assert.ok(mergeCall, "Should have called glab mr merge");
      assert.ok(mergeCall.args.includes("--squash"));
    });

    test("uses rebase strategy when configured", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        repoInfo: gitlabRepoInfo,
        config: { mode: "auto", strategy: "rebase" },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls.find(
        (c) => c.executable === "glab" && c.args.includes("merge")
      );
      assert.ok(mergeCall);
      assert.ok(mergeCall.args.includes("--rebase"));
    });

    test("uses remove-source-branch flag when configured", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        repoInfo: gitlabRepoInfo,
        config: { mode: "auto", deleteBranch: true },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls.find(
        (c) => c.executable === "glab" && c.args.includes("merge")
      );
      assert.ok(mergeCall);
      assert.ok(mergeCall.args.includes("--remove-source-branch"));
    });

    test("returns failure when glab mr merge fails", async () => {
      mockExecutor.responses.set("glab mr merge", new Error("Merge failed"));

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        repoInfo: gitlabRepoInfo,
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

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        repoInfo: gitlabRepoInfo,
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, true);
      assert.ok(result.message.includes("merged successfully"));

      assert.equal(mockExecutor.calls.length, 1);
      assert.equal(mockExecutor.calls[0].executable, "glab");
      assert.ok(mockExecutor.calls[0].args.includes("merge"));
      // Should NOT have --when-pipeline-succeeds for force mode
      assert.ok(
        !mockExecutor.calls[0].args.includes("--when-pipeline-succeeds")
      );
    });

    test("uses merge strategy with force mode", async () => {
      mockExecutor.responses.set("glab mr merge", "");

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        repoInfo: gitlabRepoInfo,
        config: { mode: "force", strategy: "squash", deleteBranch: true },
        workDir: testDir,
        retries: 0,
      });

      const mergeCall = mockExecutor.calls[0];
      assert.ok(mergeCall.args.includes("--squash"));
      assert.ok(mergeCall.args.includes("--remove-source-branch"));
    });

    test("returns failure when force merge fails", async () => {
      mockExecutor.responses.set(
        "glab mr merge",
        new Error("Merge not allowed")
      );

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/123",
        repoInfo: gitlabRepoInfo,
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

      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl:
          "https://gitlab.com/org/group/subgroup/repo/-/merge_requests/456",
        repoInfo: gitlabRepoInfo,
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.ok(mockExecutor.calls[0].args.includes("org/group/subgroup/repo"));
    });

    test("returns failure for invalid MR URL", async () => {
      const strategy = new GitLabPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: "https://gitlab.com/invalid-url",
        repoInfo: gitlabRepoInfo,
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

  let mockExecutor: ExecutorMockResult;
  const testDirEdge = join(tmpdir(), "test-gitlab-strategy-edge-tmp");

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
      "MR created: https://gitlab.com/owner/repo/-/merge_requests/123."
    );

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
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
      "URL should not include trailing period"
    );
  });

  test("rejects non-MR GitLab URLs (issue URL)", async () => {
    mockExecutor.responses.set(
      "glab mr create",
      "See related: https://gitlab.com/owner/repo/-/issues/456"
    );

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
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
      /Could not parse MR URL/
    );
  });

  test("rejects non-MR GitLab URLs (commit URL)", async () => {
    mockExecutor.responses.set(
      "glab mr create",
      "Based on commit https://gitlab.com/owner/repo/-/commit/abc123"
    );

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
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
      /Could not parse MR URL/
    );
  });

  test("extracts valid MR URL with trailing newline", async () => {
    mockExecutor.responses.set(
      "glab mr create",
      "https://gitlab.com/owner/repo/-/merge_requests/789\n"
    );

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
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
      "https://gitlab.com/owner/repo/-/merge_requests/789"
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

  let mockExecutor: ExecutorMockResult;

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

  test("findExistingPRUrl throws for non-GitLab repo", async () => {
    const strategy = new GitLabPRStrategy(mockExecutor.mock);
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
      () => strategy.findExistingPRUrl(options),
      /requires GitLab repositories/
    );
  });

  test("create throws for non-GitLab repo", async () => {
    const strategy = new GitLabPRStrategy(mockExecutor.mock);
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
      /requires GitLab repositories/
    );
  });

  test("closeExistingPR throws for non-GitLab repo", async () => {
    const strategy = new GitLabPRStrategy(mockExecutor.mock);

    await assert.rejects(
      () =>
        strategy.closeExistingPR({
          repoInfo: azureRepoInfo,
          branchName: "test-branch",
          baseBranch: "main",
          workDir: testDir,
          retries: 0,
        }),
      /requires GitLab repositories/
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

  let mockExecutor: ExecutorMockResult;

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
      '[{"iid": 77, "title": "Test MR"}]'
    );

    const strategy = new GitLabPRStrategy(mockExecutor.mock);
    const options: PRStrategyOptions = {
      repoInfo: selfHostedRepoInfo,
      title: "Test MR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    const result = await strategy.findExistingPRUrl(options);

    assert.equal(
      result,
      "https://gitlab.example.com/myorg/myrepo/-/merge_requests/77"
    );
  });
});

describe("GitLabPRStrategy merge unknown mode", () => {
  const gitlabRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.com:myorg/myrepo.git",
    owner: "myorg",
    namespace: "myorg",
    repo: "myrepo",
    host: "gitlab.com",
  };

  test("returns failure for unknown merge mode", async () => {
    const mockExecutor = createMockExecutor();
    const strategy = new GitLabPRStrategy(mockExecutor.mock);
    const result = await strategy.merge({
      prUrl: "https://gitlab.com/myorg/myrepo/-/merge_requests/1",
      repoInfo: gitlabRepoInfo,
      config: { mode: "unknown" as "manual" },
      workDir: testDir,
      retries: 0,
    });

    assert.equal(result.success, false);
    assert.equal(result.merged, false);
    assert.ok(result.message.includes("Merge not applicable for mode:"));
  });
});

describe("GitLabPRStrategy logger coverage", () => {
  const gitlabRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.com:myorg/myrepo.git",
    owner: "myorg",
    namespace: "myorg",
    repo: "myrepo",
    host: "gitlab.com",
  };

  let mockExecutor: ExecutorMockResult;

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

  test("findExistingPRUrl logs debug on error with stderr", async () => {
    const debugMessages: string[] = [];
    const mockLogger = {
      debug(msg: string) {
        debugMessages.push(msg);
      },
      warn() {},
      info() {},
    };

    const errorWithStderr = Object.assign(new Error("Command failed"), {
      stderr: "glab: connection refused",
    });
    mockExecutor.responses.set("glab mr list", errorWithStderr);

    const strategy = new GitLabPRStrategy(mockExecutor.mock, mockLogger);
    const result = await strategy.findExistingPRUrl({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    });

    assert.equal(result, null);
    assert.ok(debugMessages.some((m) => m.includes("GitLab MR check failed")));
  });

  test("closeExistingPR logs warn on close error", async () => {
    const warnMessages: string[] = [];
    const mockLogger = {
      debug() {},
      warn(msg: string) {
        warnMessages.push(msg);
      },
      info() {},
    };

    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 123, "title": "Test MR"}]'
    );
    mockExecutor.responses.set("glab mr close", new Error("Close failed"));

    const strategy = new GitLabPRStrategy(mockExecutor.mock, mockLogger);
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    });

    assert.equal(result.status, "close_failed");
    assert.ok(
      warnMessages.some((m) => m.includes("Failed to close existing MR"))
    );
  });

  test("closeExistingPR logs warn on branch deletion failure", async () => {
    const warnMessages: string[] = [];
    const mockLogger = {
      debug() {},
      warn(msg: string) {
        warnMessages.push(msg);
      },
      info() {},
    };

    mockExecutor.responses.set(
      "glab mr list",
      '[{"iid": 123, "title": "Test MR"}]'
    );
    mockExecutor.responses.set("glab mr close", "");
    mockExecutor.responses.set(
      "git push origin --delete",
      new Error("Branch deletion failed")
    );

    const strategy = new GitLabPRStrategy(mockExecutor.mock, mockLogger);
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    });

    assert.strictEqual(result.status, "close_failed");
    assert.ok(
      "message" in result &&
        result.message.includes("branch test-branch deletion failed")
    );
    assert.ok(warnMessages.some((m) => m.includes("deletion failed")));
  });
});

describe("GitLabPRStrategy closeExistingPR with unparseable URL", () => {
  const gitlabRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.com:myorg/myrepo.git",
    owner: "myorg",
    namespace: "myorg",
    repo: "myrepo",
    host: "gitlab.com",
  };

  test("returns false when findExistingPRUrl returns unparseable URL", async () => {
    class TestableGitLabPRStrategy extends GitLabPRStrategy {
      override async findExistingPRUrl(): Promise<string | null> {
        return "https://not-a-gitlab-url.com/invalid";
      }
    }

    const warnings: string[] = [];
    const localMockExecutor = createMockExecutor();
    const strategy = new TestableGitLabPRStrategy(localMockExecutor.mock, {
      debug() {},
      warn(msg: string) {
        warnings.push(msg);
      },
      info() {},
    });
    const result = await strategy.closeExistingPR({
      repoInfo: gitlabRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    });

    assert.equal(result.status, "close_failed");
    assert.ok(
      result.status === "close_failed" &&
        result.message.includes("Could not extract MR IID from URL")
    );
  });
});
