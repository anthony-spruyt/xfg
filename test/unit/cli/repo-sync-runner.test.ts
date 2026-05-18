import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  runSingleRepo,
  type RepoIterationContext,
} from "../../../src/cli/repo-sync-runner.js";
import type { Config, RepoConfig } from "../../../src/config/index.js";
import type {
  SyncOptions,
  SettingsProcessorFactories,
  SyncResultEntry,
} from "../../../src/cli/types.js";
import type {
  ProcessorResult,
  IRepositoryProcessor,
} from "../../../src/sync/index.js";
import type {
  IRepoLifecycleManager,
  LifecycleActionKind,
} from "../../../src/lifecycle/index.js";
import type { LifecycleAction } from "../../../src/output/index.js";
import type { Logger, ILogger } from "../../../src/shared/logger.js";
import type { ProcessExecutor } from "../../../src/shared/command-executor.js";
import { ResultsCollector } from "../../../src/cli/results-collector.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface LogCall {
  method: string;
  args: unknown[];
}

function createMockLogger(): { logger: Logger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const logger: ILogger = {
    info: (...args: unknown[]) => calls.push({ method: "info", args }),
    warn: (...args: unknown[]) => calls.push({ method: "warn", args }),
    debug: (...args: unknown[]) => calls.push({ method: "debug", args }),
    log: (...args: unknown[]) => calls.push({ method: "log", args }),
    success: (...args: unknown[]) => calls.push({ method: "success", args }),
    error: (...args: unknown[]) => calls.push({ method: "error", args }),
    skip: (...args: unknown[]) => calls.push({ method: "skip", args }),
    progress: (...args: unknown[]) => calls.push({ method: "progress", args }),
    fileDiff: (...args: unknown[]) => calls.push({ method: "fileDiff", args }),
    diffSummary: (...args: unknown[]) =>
      calls.push({ method: "diffSummary", args }),
    setTotal: (...args: unknown[]) => calls.push({ method: "setTotal", args }),
  };
  return { logger: logger as unknown as Logger, calls };
}

function makeRepoConfig(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    git: "https://github.com/test-owner/test-repo.git",
    files: [{ fileName: "config.yaml", content: "test" }],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    id: "test-config",
    repos: [],
    ...overrides,
  };
}

function makeProcessorResult(
  overrides: Partial<ProcessorResult> = {}
): ProcessorResult {
  return {
    success: true,
    repoName: "test-owner/test-repo",
    message: "Synced successfully",
    fileChanges: [{ path: "config.yaml", action: "create" }],
    ...overrides,
  };
}

function createMockProcessor(result: ProcessorResult): {
  processor: IRepositoryProcessor;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const processor: IRepositoryProcessor = {
    process: async (...args: unknown[]) => {
      calls.push(args);
      return result;
    },
  };
  return { processor, calls };
}

function createMockLifecycleManager(
  action: LifecycleActionKind = "existed"
): IRepoLifecycleManager {
  return {
    ensureRepo: async (_repoConfig, repoInfo) => ({
      repoInfo,
      action,
    }),
  };
}

function createNoopSettingsFactories(): SettingsProcessorFactories {
  const noopFactory = () => ({
    process: async () => ({
      success: true,
      skipped: true,
      message: "No settings configured",
    }),
  });
  return {
    rulesets: noopFactory,
    labels: noopFactory,
    repo: noopFactory,
    codeScanning: noopFactory,
    variables: noopFactory,
  };
}

function createContext(
  overrides: Partial<RepoIterationContext> = {}
): RepoIterationContext {
  const { logger } = createMockLogger();
  const { processor } = createMockProcessor(makeProcessorResult());

  return {
    config: makeConfig(),
    options: { config: "xfg.yaml", dryRun: false },
    branchName: "chore/sync-config",
    processor,
    lifecycleManager: createMockLifecycleManager(),
    tokenManager: null,
    reportResults: [],
    lifecycleReportInputs: [],
    settingsCollector: new ResultsCollector(),
    factories: createNoopSettingsFactories(),
    logger,
    executor: { exec: async () => "" } as unknown as ProcessExecutor,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSingleRepo", () => {
  describe("successful sync run", () => {
    test("processes a GitHub repo through lifecycle and file sync phases", async () => {
      const processorResult = makeProcessorResult();
      const { processor, calls: processorCalls } =
        createMockProcessor(processorResult);
      const reportResults: SyncResultEntry[] = [];
      const lifecycleReportInputs: LifecycleAction[] = [];

      const ctx = createContext({
        processor,
        reportResults,
        lifecycleReportInputs,
      });

      await runSingleRepo(makeRepoConfig(), 0, ctx);

      // Lifecycle phase should run and record an action
      assert.equal(lifecycleReportInputs.length, 1);
      assert.equal(lifecycleReportInputs[0].repoName, "test-owner/test-repo");
      assert.equal(lifecycleReportInputs[0].action, "existed");

      // Processor should have been called once
      assert.equal(processorCalls.length, 1);

      // Report results should have one successful entry
      assert.equal(reportResults.length, 1);
      assert.equal(reportResults[0].success, true);
      assert.equal(reportResults[0].repoName, "test-owner/test-repo");
    });

    test("records PR URL and merge outcome in report results", async () => {
      const processorResult = makeProcessorResult({
        prUrl: "https://github.com/test-owner/test-repo/pull/42",
        mergeResult: { merged: true, message: "merged" },
      });
      const { processor } = createMockProcessor(processorResult);
      const reportResults: SyncResultEntry[] = [];

      const ctx = createContext({ processor, reportResults });

      await runSingleRepo(makeRepoConfig(), 0, ctx);

      assert.equal(reportResults.length, 1);
      assert.equal(
        reportResults[0].prUrl,
        "https://github.com/test-owner/test-repo/pull/42"
      );
      assert.equal(reportResults[0].mergeOutcome, "force");
    });

    test("logs success for a successful processor result", async () => {
      const processorResult = makeProcessorResult();
      const { processor } = createMockProcessor(processorResult);
      const { logger, calls: logCalls } = createMockLogger();
      const reportResults: SyncResultEntry[] = [];

      const ctx = createContext({ processor, logger, reportResults });

      await runSingleRepo(makeRepoConfig(), 0, ctx);

      const successCalls = logCalls.filter((c) => c.method === "success");
      assert.ok(
        successCalls.length > 0,
        "Expected at least one success log call"
      );
    });

    test("logs skip for a skipped processor result", async () => {
      const processorResult = makeProcessorResult({
        skipped: true,
        message: "No changes",
      });
      const { processor } = createMockProcessor(processorResult);
      const { logger, calls: logCalls } = createMockLogger();
      const reportResults: SyncResultEntry[] = [];

      const ctx = createContext({ processor, logger, reportResults });

      await runSingleRepo(makeRepoConfig(), 0, ctx);

      const skipCalls = logCalls.filter((c) => c.method === "skip");
      assert.ok(skipCalls.length > 0, "Expected at least one skip log call");
    });
  });

  describe("error handling", () => {
    test("captures error when processor throws without stopping execution", async () => {
      const processor: IRepositoryProcessor = {
        process: async () => {
          throw new Error("Connection reset");
        },
      };
      const reportResults: SyncResultEntry[] = [];

      const ctx = createContext({ processor, reportResults });

      // Should not throw
      await runSingleRepo(makeRepoConfig(), 0, ctx);

      assert.equal(reportResults.length, 1);
      assert.equal(reportResults[0].success, false);
      assert.equal(reportResults[0].repoName, "test-owner/test-repo");
      assert.ok(reportResults[0].error?.includes("Connection reset"));
    });

    test("captures error when processor returns a failure result", async () => {
      const processorResult = makeProcessorResult({
        success: false,
        message: "Merge conflict detected",
      });
      const { processor } = createMockProcessor(processorResult);
      const reportResults: SyncResultEntry[] = [];
      const { logger, calls: logCalls } = createMockLogger();

      const ctx = createContext({ processor, reportResults, logger });

      await runSingleRepo(makeRepoConfig(), 0, ctx);

      assert.equal(reportResults.length, 1);
      assert.equal(reportResults[0].success, false);
      assert.equal(reportResults[0].error, "Merge conflict detected");

      const errorCalls = logCalls.filter((c) => c.method === "error");
      assert.ok(errorCalls.length > 0, "Expected at least one error log call");
    });

    test("records failure when lifecycle phase throws", async () => {
      const lifecycleManager: IRepoLifecycleManager = {
        ensureRepo: async () => {
          throw new Error("Lifecycle check failed");
        },
      };
      const reportResults: SyncResultEntry[] = [];

      const ctx = createContext({ lifecycleManager, reportResults });

      await runSingleRepo(makeRepoConfig(), 0, ctx);

      assert.equal(reportResults.length, 1);
      assert.equal(reportResults[0].success, false);
      assert.ok(reportResults[0].error?.includes("Lifecycle check failed"));
    });

    test("skips file sync when lifecycle phase errors", async () => {
      const lifecycleManager: IRepoLifecycleManager = {
        ensureRepo: async () => {
          throw new Error("Lifecycle error");
        },
      };
      const { processor, calls: processorCalls } = createMockProcessor(
        makeProcessorResult()
      );
      const reportResults: SyncResultEntry[] = [];

      const ctx = createContext({
        lifecycleManager,
        processor,
        reportResults,
      });

      await runSingleRepo(makeRepoConfig(), 0, ctx);

      // Processor should NOT have been called since lifecycle errored
      assert.equal(processorCalls.length, 0);
    });

    test("records failure for invalid git URL", async () => {
      const reportResults: SyncResultEntry[] = [];
      const ctx = createContext({ reportResults });

      const invalidRepo = makeRepoConfig({ git: "not-a-valid-url" });

      await runSingleRepo(invalidRepo, 0, ctx);

      assert.equal(reportResults.length, 1);
      assert.equal(reportResults[0].success, false);
      assert.equal(reportResults[0].repoName, "not-a-valid-url");
    });
  });

  describe("options merging", () => {
    test("CLI merge option overrides repo config prOptions", async () => {
      const { processor, calls: processorCalls } = createMockProcessor(
        makeProcessorResult()
      );

      const options: SyncOptions = {
        config: "xfg.yaml",
        dryRun: false,
        merge: "direct",
      };
      const ctx = createContext({ processor, options });

      const repoConfig = makeRepoConfig({
        prOptions: { merge: "auto" },
      });

      await runSingleRepo(repoConfig, 0, ctx);

      assert.equal(processorCalls.length, 1);
      // The first arg to process() is the effective repoConfig
      const passedRepoConfig = processorCalls[0][0] as RepoConfig;
      assert.equal(passedRepoConfig.prOptions?.merge, "direct");
    });

    test("CLI branch option overrides repo config branch", async () => {
      const { processor, calls: processorCalls } = createMockProcessor(
        makeProcessorResult()
      );

      const options: SyncOptions = {
        config: "xfg.yaml",
        dryRun: false,
        branch: "chore/custom-branch",
      };
      const ctx = createContext({ processor, options });

      const repoConfig = makeRepoConfig({
        prOptions: { branch: "chore/original-branch" },
      });

      await runSingleRepo(repoConfig, 0, ctx);

      assert.equal(processorCalls.length, 1);
      const passedRepoConfig = processorCalls[0][0] as RepoConfig;
      assert.equal(passedRepoConfig.prOptions?.branch, "chore/custom-branch");
    });

    test("preserves repo config prOptions when no CLI overrides provided", async () => {
      const { processor, calls: processorCalls } = createMockProcessor(
        makeProcessorResult()
      );

      const options: SyncOptions = {
        config: "xfg.yaml",
        dryRun: false,
      };
      const ctx = createContext({ processor, options });

      const repoConfig = makeRepoConfig({
        prOptions: { merge: "force", branch: "chore/my-branch" },
      });

      await runSingleRepo(repoConfig, 0, ctx);

      assert.equal(processorCalls.length, 1);
      const passedRepoConfig = processorCalls[0][0] as RepoConfig;
      // When no CLI override options are specified, prOptions should be passed through unchanged
      assert.equal(passedRepoConfig.prOptions?.merge, "force");
      assert.equal(passedRepoConfig.prOptions?.branch, "chore/my-branch");
    });

    test("warns when mergeStrategy is set in direct mode", async () => {
      const { processor } = createMockProcessor(makeProcessorResult());
      const { logger, calls: logCalls } = createMockLogger();

      const options: SyncOptions = {
        config: "xfg.yaml",
        dryRun: false,
        merge: "direct",
        mergeStrategy: "squash",
      };
      const ctx = createContext({ processor, logger, options });

      await runSingleRepo(makeRepoConfig(), 0, ctx);

      const warnCalls = logCalls.filter((c) => c.method === "warn");
      assert.ok(
        warnCalls.length > 0,
        "Expected a warning about mergeStrategy in direct mode"
      );
      const warnMsg = String(warnCalls[0].args[0]);
      assert.match(warnMsg, /mergeStrategy/);
      assert.match(warnMsg, /ignored/);
    });
  });

  describe("dry run with lifecycle creation", () => {
    test("skips file sync and records success on dry-run with non-existed lifecycle", async () => {
      const lifecycleManager = createMockLifecycleManager("created");
      const { processor, calls: processorCalls } = createMockProcessor(
        makeProcessorResult()
      );
      const reportResults: SyncResultEntry[] = [];

      const options: SyncOptions = {
        config: "xfg.yaml",
        dryRun: true,
      };

      const ctx = createContext({
        lifecycleManager,
        processor,
        reportResults,
        options,
      });

      await runSingleRepo(makeRepoConfig(), 0, ctx);

      // File sync should be skipped in dry-run when lifecycle action is "created"
      assert.equal(processorCalls.length, 0);

      // But a success result should still be recorded
      assert.equal(reportResults.length, 1);
      assert.equal(reportResults[0].success, true);
    });
  });
});
