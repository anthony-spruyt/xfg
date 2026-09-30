import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncWorkflow } from "../../../src/sync/sync-workflow.js";
import type {
  IAuthOptionsBuilder,
  IRepositorySession,
  IBranchManager,
  ICommitPushManager,
  IPRMergeHandler,
  IWorkStrategy,
  WorkResult,
  CreateAndMergeInput,
  ProcessorOptions,
} from "../../../src/sync/index.js";
import type { RepoConfig } from "../../../src/config/index.js";
import type {
  ChangeDescription,
  DescribeInput,
  IChangeDescriber,
} from "../../../src/ai/index.js";
import type { GitHubRepoInfo } from "../../../src/repo/index.js";
import {
  createMockLogger,
  createMockAuthenticatedGitOps,
  createMockExecutor,
} from "../../mocks/index.js";

describe("SyncWorkflow", () => {
  const testDir = join(tmpdir(), `sync-workflow-test-${Date.now()}`);
  let workDir: string;

  const mockRepoConfig: RepoConfig = {
    git: "git@github.com:test/repo.git",
    files: [],
  };

  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test/repo.git",
    owner: "test",
    repo: "repo",
    host: "github.com",
  };

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createMockComponents() {
    const { gitOps } = createMockAuthenticatedGitOps({
      hasChanges: true,
    });
    const callOrder: string[] = [];

    const authOptionsBuilder: IAuthOptionsBuilder = {
      async resolve() {
        return {
          ok: true,
          token: "test-token",
          authOptions: {
            token: "test-token",
            host: "github.com",
            owner: "test",
            repo: "repo",
          },
        };
      },
    };

    const repositorySession: IRepositorySession = {
      async setup() {
        callOrder.push("session.setup");
        return {
          gitOps,
          baseBranch: "main",
          cleanup: () => {
            callOrder.push("session.cleanup");
          },
        };
      },
    };

    const branchManager: IBranchManager = {
      async setupBranch() {},
    };

    const commitPushManager: ICommitPushManager = {
      async commitAndPush() {
        return { success: true };
      },
    };

    const prMergeHandler: IPRMergeHandler = {
      async createAndMerge() {
        return {
          success: true,
          repoName: "test/repo",
          message: "PR created",
          prUrl: "https://github.com/test/repo/pull/1",
        };
      },
    };

    const changeDescriber: IChangeDescriber & { calls: DescribeInput[] } = {
      calls: [],
      async describe(input) {
        this.calls.push(input);
        return null;
      },
    };

    return {
      authOptionsBuilder,
      repositorySession,
      branchManager,
      commitPushManager,
      prMergeHandler,
      changeDescriber,
      callOrder,
    };
  }

  test("returns skip result when auth fails", async () => {
    const components = createMockComponents();
    components.authOptionsBuilder.resolve = async () => ({
      ok: false as const,
      skipResult: {
        success: true,
        repoName: "test/repo",
        message: "No installation found",
        skipped: true,
      },
    });

    const { mock: mockLogger } = createMockLogger();
    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      components.changeDescriber,
      mockLogger
    );

    const mockStrategy: IWorkStrategy = {
      async execute() {
        return null;
      },
    };

    const result = await workflow.execute(
      mockRepoConfig,
      mockRepoInfo,
      {
        branchName: "test",
        workDir,
        configId: "test",
        executor: createMockExecutor().mock,
      },
      mockStrategy
    );

    assert.equal(result.skipped, true);
    assert.equal(result.message, "No installation found");
  });

  test("returns skip result when strategy returns null", async () => {
    const components = createMockComponents();
    const { mock: mockLogger } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      components.changeDescriber,
      mockLogger
    );

    const mockStrategy: IWorkStrategy = {
      async execute() {
        return null;
      },
    };

    const result = await workflow.execute(
      mockRepoConfig,
      mockRepoInfo,
      {
        branchName: "test",
        workDir,
        configId: "test",
        executor: createMockExecutor().mock,
      },
      mockStrategy
    );

    assert.equal(result.skipped, true);
    assert.equal(result.message, "No changes detected");
  });

  test("creates PR when changes exist and not direct mode", async () => {
    const components = createMockComponents();
    const { mock: mockLogger } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      components.changeDescriber,
      mockLogger
    );

    const workResult: WorkResult = {
      fileChanges: new Map([
        [
          "test.txt",
          { fileName: "test.txt", content: "test", action: "create" },
        ],
      ]),
      changedFiles: [{ fileName: "test.txt", action: "create" }],
      commitMessage: "test commit",
      fileChangeDetails: [{ path: "test.txt", action: "create" }],
    };

    const mockStrategy: IWorkStrategy = {
      async execute() {
        return workResult;
      },
    };

    const result = await workflow.execute(
      mockRepoConfig,
      mockRepoInfo,
      {
        branchName: "test",
        workDir,
        configId: "test",
        executor: createMockExecutor().mock,
      },
      mockStrategy
    );

    assert.equal(result.success, true);
    assert.equal(result.prUrl, "https://github.com/test/repo/pull/1");
  });

  test("pushes directly when direct mode", async () => {
    const components = createMockComponents();
    const { mock: mockLogger, messages } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      components.changeDescriber,
      mockLogger
    );

    const workResult: WorkResult = {
      fileChanges: new Map([
        [
          "test.txt",
          { fileName: "test.txt", content: "test", action: "create" },
        ],
      ]),
      changedFiles: [{ fileName: "test.txt", action: "create" }],
      commitMessage: "test commit",
      fileChangeDetails: [{ path: "test.txt", action: "create" }],
    };

    const mockStrategy: IWorkStrategy = {
      async execute() {
        return workResult;
      },
    };

    const repoConfigDirect: RepoConfig = {
      ...mockRepoConfig,
      prOptions: { merge: "direct" },
    };

    const result = await workflow.execute(
      repoConfigDirect,
      mockRepoInfo,
      {
        branchName: "test",
        workDir,
        configId: "test",
        executor: createMockExecutor().mock,
      },
      mockStrategy
    );

    assert.equal(result.success, true);
    assert.ok(result.message.includes("directly"));
    assert.ok(messages.some((m) => m.includes("pushed directly")));
  });

  // mergeStrategy-in-direct-mode warning moved to CLI layer (sync-command.ts)

  test("cleanup runs after strategy execution even when strategy throws", async () => {
    const components = createMockComponents();
    const { mock: mockLogger } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      components.changeDescriber,
      mockLogger
    );

    const mockStrategy: IWorkStrategy = {
      async execute() {
        components.callOrder.push("strategy.execute");
        throw new Error("Intentional test error");
      },
    };

    try {
      await workflow.execute(
        mockRepoConfig,
        mockRepoInfo,
        {
          branchName: "test",
          workDir,
          configId: "test",
          executor: createMockExecutor().mock,
        },
        mockStrategy
      );
    } catch {
      // Expected error
    }

    assert.ok(
      components.callOrder.includes("session.cleanup"),
      "cleanup must be called even when strategy throws"
    );
    const setupIdx = components.callOrder.indexOf("session.setup");
    const executeIdx = components.callOrder.indexOf("strategy.execute");
    const cleanupIdx = components.callOrder.indexOf("session.cleanup");
    assert.ok(setupIdx < executeIdx, "setup must precede strategy execution");
    assert.ok(
      executeIdx < cleanupIdx,
      "cleanup must run after strategy execution"
    );
  });

  test("cleanup runs after successful execution", async () => {
    const components = createMockComponents();
    const { mock: mockLogger } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      components.changeDescriber,
      mockLogger
    );

    const workResult: WorkResult = {
      fileChanges: new Map([
        [
          "test.txt",
          { fileName: "test.txt", content: "test", action: "create" },
        ],
      ]),
      changedFiles: [{ fileName: "test.txt", action: "create" }],
      commitMessage: "test commit",
      fileChangeDetails: [{ path: "test.txt", action: "create" }],
    };

    const mockStrategy: IWorkStrategy = {
      async execute() {
        components.callOrder.push("strategy.execute");
        return workResult;
      },
    };

    await workflow.execute(
      mockRepoConfig,
      mockRepoInfo,
      {
        branchName: "test",
        workDir,
        configId: "test",
        executor: createMockExecutor().mock,
      },
      mockStrategy
    );

    const setupIdx = components.callOrder.indexOf("session.setup");
    const executeIdx = components.callOrder.indexOf("strategy.execute");
    const cleanupIdx = components.callOrder.indexOf("session.cleanup");
    assert.ok(setupIdx >= 0, "setup must be called");
    assert.ok(executeIdx >= 0, "strategy must be called");
    assert.ok(cleanupIdx >= 0, "cleanup must be called on success path");
    assert.ok(setupIdx < executeIdx, "setup must precede strategy execution");
    assert.ok(
      executeIdx < cleanupIdx,
      "cleanup must run after strategy execution"
    );
  });

  test("returns skip when commit skipped (no changes after staging)", async () => {
    const components = createMockComponents();
    components.commitPushManager.commitAndPush = async () => ({
      success: true,
      skipped: true,
    });

    const { mock: mockLogger } = createMockLogger();

    const workflow = new SyncWorkflow(
      components.authOptionsBuilder,
      components.repositorySession,
      components.branchManager,
      components.commitPushManager,
      components.prMergeHandler,
      components.changeDescriber,
      mockLogger
    );

    const workResult: WorkResult = {
      fileChanges: new Map(),
      changedFiles: [],
      commitMessage: "test",
      fileChangeDetails: [],
      diffStats: {
        newCount: 0,
        modifiedCount: 0,
        unchangedCount: 0,
        deletedCount: 0,
      },
    };

    const mockStrategy: IWorkStrategy = {
      async execute() {
        return workResult;
      },
    };

    const result = await workflow.execute(
      mockRepoConfig,
      mockRepoInfo,
      {
        branchName: "test",
        workDir,
        configId: "test",
        executor: createMockExecutor().mock,
      },
      mockStrategy
    );

    assert.equal(result.skipped, true);
    assert.ok(result.message.includes("No changes detected after staging"));
  });

  describe("AI commit messages", () => {
    const AI_DESCRIPTION = {
      subject: "ci(workflows): pin actions/checkout to v5",
      body: "Bumps checkout from v4 to v5.",
      prSummary: "Updates checkout to v5.",
    };

    function aiWorkResult(): WorkResult {
      return {
        fileChanges: new Map([
          ["ci.yaml", { fileName: "ci.yaml", content: "x", action: "update" }],
        ]),
        changedFiles: [{ fileName: "ci.yaml", action: "update" }],
        commitMessage: "chore: sync ci.yaml",
        fileChangeDetails: [
          { path: "ci.yaml", action: "update", diffLines: ["+x"] },
        ],
      };
    }

    function setup(describeResult: ChangeDescription | null) {
      const components = createMockComponents();
      const commitMessages: string[] = [];
      const prInputs: CreateAndMergeInput[] = [];
      components.commitPushManager.commitAndPush = async (opts) => {
        commitMessages.push(opts.commitMessage);
        return { success: true };
      };
      components.prMergeHandler.createAndMerge = async (input) => {
        prInputs.push(input);
        return { success: true, repoName: "test/repo", message: "PR" };
      };
      components.changeDescriber.describe = async function (input) {
        components.changeDescriber.calls.push(input);
        return describeResult;
      };
      const { mock: mockLogger, messages } = createMockLogger();
      const workflow = new SyncWorkflow(
        components.authOptionsBuilder,
        components.repositorySession,
        components.branchManager,
        components.commitPushManager,
        components.prMergeHandler,
        components.changeDescriber,
        mockLogger
      );
      const strategy: IWorkStrategy = {
        async execute() {
          return aiWorkResult();
        },
      };
      return {
        components,
        workflow,
        strategy,
        commitMessages,
        prInputs,
        messages,
      };
    }

    function run(
      ctx: ReturnType<typeof setup>,
      prOptions: RepoConfig["prOptions"],
      extra: Partial<ProcessorOptions> = {}
    ) {
      return ctx.workflow.execute(
        { ...mockRepoConfig, prOptions },
        mockRepoInfo,
        {
          branchName: "test",
          workDir,
          configId: "test",
          executor: createMockExecutor().mock,
          retries: 2,
          ...extra,
        },
        ctx.strategy
      );
    }

    test("PR mode: overrides commit message and passes PR title/summary", async () => {
      const ctx = setup(AI_DESCRIPTION);
      await run(ctx, { merge: "manual", ai: { provider: "anthropic" } });

      assert.deepEqual(ctx.commitMessages, [
        "ci(workflows): pin actions/checkout to v5\n\nBumps checkout from v4 to v5.",
      ]);
      assert.equal(ctx.prInputs[0].prTitle, AI_DESCRIPTION.subject);
      assert.equal(ctx.prInputs[0].prSummary, AI_DESCRIPTION.prSummary);
      const call = ctx.components.changeDescriber.calls[0];
      assert.deepEqual(call.options, { provider: "anthropic" });
      assert.equal(call.retries, 2);
      assert.deepEqual(call.files, aiWorkResult().fileChangeDetails);
    });

    test("subject-only description commits just the subject", async () => {
      const ctx = setup({ subject: "fix: x", prSummary: "s" });
      await run(ctx, { ai: { provider: "anthropic" } });
      assert.deepEqual(ctx.commitMessages, ["fix: x"]);
    });

    test("direct mode uses the AI message", async () => {
      const ctx = setup(AI_DESCRIPTION);
      await run(ctx, { merge: "direct", ai: { provider: "anthropic" } });
      assert.match(ctx.commitMessages[0], /^ci\(workflows\): pin/);
      assert.equal(ctx.prInputs.length, 0);
    });

    test("describer returning null keeps the default message", async () => {
      const ctx = setup(null);
      await run(ctx, { ai: { provider: "anthropic" } });
      assert.deepEqual(ctx.commitMessages, ["chore: sync ci.yaml"]);
      assert.equal(ctx.prInputs[0].prTitle, undefined);
      assert.equal(ctx.prInputs[0].prSummary, undefined);
    });

    test("ai unset: describer not called", async () => {
      const ctx = setup(AI_DESCRIPTION);
      await run(ctx, { merge: "manual" });
      assert.equal(ctx.components.changeDescriber.calls.length, 0);
      assert.deepEqual(ctx.commitMessages, ["chore: sync ci.yaml"]);
    });

    test("noAi: describer not called", async () => {
      const ctx = setup(AI_DESCRIPTION);
      await run(ctx, { ai: { provider: "anthropic" } }, { noAi: true });
      assert.equal(ctx.components.changeDescriber.calls.length, 0);
      assert.deepEqual(ctx.commitMessages, ["chore: sync ci.yaml"]);
    });

    test("dry run: describer not called, logs intent", async () => {
      const ctx = setup(AI_DESCRIPTION);
      await run(ctx, { ai: { provider: "anthropic" } }, { dryRun: true });
      assert.equal(ctx.components.changeDescriber.calls.length, 0);
      assert.ok(
        ctx.messages.some((m) => m.includes("Would generate AI commit message"))
      );
    });
  });
});
