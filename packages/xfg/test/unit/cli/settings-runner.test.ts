import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { applyRepoSettings } from "../../../src/cli/settings-runner.js";
import { ResultsCollector } from "../../../src/cli/results-collector.js";
import type {
  ApplyRepoSettingsContext,
  SettingsResult,
  SettingsProcessorFactories,
  SyncOptions,
} from "../../../src/cli/types.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../../src/repo/index.js";
import type { RepoConfig } from "../../../src/config/index.js";
import type { ILogger, Logger } from "../../../src/shared/logger.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "git@github.com:org/repo.git",
  owner: "org",
  repo: "repo",
  host: "github.com",
};

const adoRepo: AzureDevOpsRepoInfo = {
  type: "azure-devops",
  gitUrl: "https://dev.azure.com/org/proj/_git/repo",
  owner: "org",
  organization: "org",
  project: "proj",
  repo: "repo",
};

const options: SyncOptions = { config: "xfg.yaml", dryRun: false };

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

/**
 * Creates a mock processor factory that returns the given result.
 * The `called` array is mutated each time the factory is invoked.
 */
function createMockFactory(
  result: SettingsResult,
  called: boolean[] = []
): () => { process: () => Promise<SettingsResult> } {
  return () => {
    called.push(true);
    return { process: async () => result };
  };
}

/**
 * Creates a mock processor factory that throws when process() is called.
 */
function createThrowingFactory(
  error: unknown
): () => { process: () => Promise<SettingsResult> } {
  return () => ({
    process: async () => {
      throw error;
    },
  });
}

/** A factory that should never be invoked — fails the test if called. */
function neverCalledFactory(): () => {
  process: () => Promise<SettingsResult>;
} {
  return () => {
    assert.fail("factory should not have been called");
  };
}

const successResult: SettingsResult = {
  success: true,
  skipped: false,
  repoName: "org/repo",
  message: "done",
};

const skippedResult: SettingsResult = {
  success: true,
  skipped: true,
  repoName: "org/repo",
  message: "skipped",
};

const failResult: SettingsResult = {
  success: false,
  skipped: false,
  repoName: "org/repo",
  message: "something went wrong",
};

/**
 * Build a minimal context. Override individual fields as needed per test.
 */
function buildCtx(
  overrides: Partial<ApplyRepoSettingsContext>
): ApplyRepoSettingsContext {
  const { logger } = createMockLogger();
  const factories: SettingsProcessorFactories = {
    rulesets:
      neverCalledFactory() as unknown as SettingsProcessorFactories["rulesets"],
    labels:
      neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
    repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
    codeScanning:
      neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
    variables:
      neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
  };
  return {
    repoConfig: { name: "org/repo" } as unknown as RepoConfig,
    repoInfo: githubRepo,
    repoName: "org/repo",
    repoNumber: 1,
    options,
    token: undefined,
    settingsCollector: new ResultsCollector(),
    factories,
    logger,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyRepoSettings", () => {
  // 1. Non-GitHub repo — returns early without calling any factory
  test("returns early for non-GitHub repo", async () => {
    const rulesetsCalledLog: boolean[] = [];
    const { logger, calls } = createMockLogger();
    const ctx = buildCtx({
      repoInfo: adoRepo,
      repoConfig: {
        name: "org/repo",
        settings: {
          rulesets: { "my-rule": { enforcement: "active", target: "branch" } },
        },
      } as unknown as RepoConfig,
      factories: {
        rulesets: createMockFactory(
          successResult,
          rulesetsCalledLog
        ) as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning:
          neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    assert.equal(
      rulesetsCalledLog.length,
      0,
      "rulesets factory must not be called for ADO repos"
    );
    assert.equal(calls.length, 0, "logger must not be called");
  });

  // 2. settings is undefined — returns early without calling any factory
  test("returns early when settings is undefined", async () => {
    const rulesetsCalledLog: boolean[] = [];
    const { logger, calls } = createMockLogger();
    const ctx = buildCtx({
      repoConfig: { name: "org/repo" } as unknown as RepoConfig,
      factories: {
        rulesets: createMockFactory(
          successResult,
          rulesetsCalledLog
        ) as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning:
          neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    assert.equal(
      rulesetsCalledLog.length,
      0,
      "rulesets factory must not be called when settings absent"
    );
    assert.equal(calls.length, 0, "logger must not be called");
  });

  // 3. Descriptor key present but empty object — descriptor is skipped
  test("skips descriptor when its settings value is an empty object", async () => {
    const rulesetsCalledLog: boolean[] = [];
    const { logger, calls } = createMockLogger();
    const ctx = buildCtx({
      repoConfig: {
        name: "org/repo",
        settings: {
          rulesets: {},
        },
      } as unknown as RepoConfig,
      factories: {
        rulesets: createMockFactory(
          successResult,
          rulesetsCalledLog
        ) as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning:
          neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    assert.equal(
      rulesetsCalledLog.length,
      0,
      "factory must not run for empty rulesets object"
    );
    assert.equal(
      calls.length,
      0,
      "logger must not be called for skipped descriptor"
    );
  });

  // 4. Successful result — logger.success called with correct args
  test("calls logger.success when processor returns success", async () => {
    const { logger, calls } = createMockLogger();
    const ctx = buildCtx({
      repoConfig: {
        name: "org/repo",
        settings: {
          rulesets: { "my-rule": { enforcement: "active", target: "branch" } },
        },
      } as unknown as RepoConfig,
      repoNumber: 3,
      repoName: "org/repo",
      factories: {
        rulesets: createMockFactory(
          successResult
        ) as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning:
          neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    const successCalls = calls.filter((c) => c.method === "success");
    assert.equal(successCalls.length, 1, "logger.success must be called once");
    assert.equal(successCalls[0].args[0], 3, "repoNumber forwarded to logger");
    assert.equal(
      successCalls[0].args[1],
      "org/repo",
      "repoName forwarded to logger"
    );
    assert.ok(
      (successCalls[0].args[2] as string).includes("done"),
      "success message includes processor message"
    );
  });

  // 5. Failed result — logger.error called and settingsCollector.appendError called
  test("calls logger.error and settingsCollector.appendError for failed result", async () => {
    const { logger, calls } = createMockLogger();
    const collector = new ResultsCollector();
    const ctx = buildCtx({
      repoConfig: {
        name: "org/repo",
        settings: {
          rulesets: { "my-rule": { enforcement: "active", target: "branch" } },
        },
      } as unknown as RepoConfig,
      settingsCollector: collector,
      factories: {
        rulesets: createMockFactory(
          failResult
        ) as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning:
          neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    const errorCalls = calls.filter((c) => c.method === "error");
    assert.equal(errorCalls.length, 1, "logger.error must be called once");
    assert.ok(
      (errorCalls[0].args[2] as string).includes("something went wrong"),
      "error message contains the processor message"
    );

    const collectorEntry = collector.findOrCreate("org/repo");
    assert.ok(
      collectorEntry.error?.includes("something went wrong"),
      "error appended to collector"
    );
  });

  // 6. Plan output — logger.info called for each line
  test("logs plan output lines via logger.info", async () => {
    const planResult: SettingsResult = {
      success: true,
      skipped: false,
      repoName: "org/repo",
      message: "plan",
      planOutput: { lines: ["line1", "line2"] },
    };
    const { logger, calls } = createMockLogger();
    const ctx = buildCtx({
      repoConfig: {
        name: "org/repo",
        settings: {
          rulesets: { "my-rule": { enforcement: "active", target: "branch" } },
        },
      } as unknown as RepoConfig,
      repoName: "org/repo",
      factories: {
        rulesets: createMockFactory(
          planResult
        ) as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning:
          neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    const infoCalls = calls.filter((c) => c.method === "info");
    const infoMessages = infoCalls.map((c) => c.args[0] as string);
    assert.ok(infoMessages.includes("line1"), "line1 must be logged via info");
    assert.ok(infoMessages.includes("line2"), "line2 must be logged via info");
    // logger.success must NOT be called because planOutput.lines is non-empty
    assert.equal(calls.filter((c) => c.method === "success").length, 0);
  });

  // 7. Plan output with warnings — logger.warn called for each warning
  test("logs warnings via logger.warn when planOutput and warnings both present", async () => {
    const planWithWarnings: SettingsResult = {
      success: true,
      skipped: false,
      repoName: "org/repo",
      message: "plan",
      planOutput: { lines: ["change-line"] },
      warnings: ["watch out", "also this"],
    };
    const { logger, calls } = createMockLogger();
    const ctx = buildCtx({
      repoConfig: {
        name: "org/repo",
        settings: {
          rulesets: { "my-rule": { enforcement: "active", target: "branch" } },
        },
      } as unknown as RepoConfig,
      factories: {
        rulesets: createMockFactory(
          planWithWarnings
        ) as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning:
          neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    const warnCalls = calls.filter((c) => c.method === "warn");
    assert.equal(warnCalls.length, 2, "one warn call per warning");
    assert.equal(warnCalls[0].args[0], "watch out");
    assert.equal(warnCalls[1].args[0], "also this");
  });

  // 8. Thrown error — logger.error and settingsCollector.appendError called
  test("handles thrown error: calls logger.error and appendError on the collector", async () => {
    const thrownError = new Error("network failure");
    const { logger, calls } = createMockLogger();
    const collector = new ResultsCollector();
    const ctx = buildCtx({
      repoConfig: {
        name: "org/repo",
        settings: {
          rulesets: { "my-rule": { enforcement: "active", target: "branch" } },
        },
      } as unknown as RepoConfig,
      settingsCollector: collector,
      factories: {
        rulesets: createThrowingFactory(
          thrownError
        ) as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning:
          neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    const errorCalls = calls.filter((c) => c.method === "error");
    assert.equal(
      errorCalls.length,
      1,
      "logger.error must be called once on thrown error"
    );
    assert.ok(
      (errorCalls[0].args[2] as string).includes("network failure"),
      "error message surfaced to logger"
    );

    const collectorEntry = collector.findOrCreate("org/repo");
    assert.ok(
      collectorEntry.error?.includes("network failure"),
      "thrown error appended to collector"
    );
  });

  // 9. Non-skipped result stored in collector via findOrCreate
  test("stores non-skipped result in the collector", async () => {
    const collector = new ResultsCollector();
    const { logger } = createMockLogger();
    const ctx = buildCtx({
      repoConfig: {
        name: "org/repo",
        settings: {
          rulesets: { "my-rule": { enforcement: "active", target: "branch" } },
        },
      } as unknown as RepoConfig,
      settingsCollector: collector,
      factories: {
        rulesets: createMockFactory(
          successResult
        ) as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning:
          neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    const all = collector.getAll();
    assert.equal(all.length, 1, "collector must have one entry");
    assert.equal(all[0].repoName, "org/repo");
    // rulesetResult is assigned on the entry by the assign callback
    assert.ok(
      "rulesetResult" in all[0],
      "rulesetResult must be stored on the collector entry"
    );
  });

  // 10. codeScanning descriptor exercises the codeScanning factory
  test("exercises codeScanning descriptor when codeScanning settings present", async () => {
    const codeScanningCalled: boolean[] = [];
    const { logger } = createMockLogger();
    const collector = new ResultsCollector();
    const ctx = buildCtx({
      repoConfig: {
        name: "org/repo",
        settings: {
          codeScanning: {
            defaultSetup: { state: "configured" },
          },
        },
      } as unknown as RepoConfig,
      settingsCollector: collector,
      factories: {
        rulesets:
          neverCalledFactory() as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning: createMockFactory(
          successResult,
          codeScanningCalled
        ) as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    assert.equal(
      codeScanningCalled.length,
      1,
      "codeScanning factory must be called"
    );
    const all = collector.getAll();
    assert.equal(all.length, 1);
    assert.ok(
      "codeScanningResult" in all[0],
      "codeScanningResult must be stored"
    );
  });

  // 11. Skipped result not stored in collector
  test("does not store skipped result in the collector", async () => {
    const collector = new ResultsCollector();
    const { logger } = createMockLogger();
    const ctx = buildCtx({
      repoConfig: {
        name: "org/repo",
        settings: {
          rulesets: { "my-rule": { enforcement: "active", target: "branch" } },
        },
      } as unknown as RepoConfig,
      settingsCollector: collector,
      factories: {
        rulesets: createMockFactory(
          skippedResult
        ) as unknown as SettingsProcessorFactories["rulesets"],
        labels:
          neverCalledFactory() as unknown as SettingsProcessorFactories["labels"],
        repo: neverCalledFactory() as unknown as SettingsProcessorFactories["repo"],
        codeScanning:
          neverCalledFactory() as unknown as SettingsProcessorFactories["codeScanning"],
        variables:
          neverCalledFactory() as unknown as SettingsProcessorFactories["variables"],
      },
      logger,
    });

    await applyRepoSettings(ctx);

    // skipped results must not be written into the collector
    assert.equal(
      collector.getAll().length,
      0,
      "collector must remain empty for skipped results"
    );
  });
});
