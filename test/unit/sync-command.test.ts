import {
  test,
  describe,
  beforeEach,
  afterEach,
  mock,
  type Mock,
} from "node:test";
import { strict as assert } from "node:assert";
type MockFn = Mock<(...args: unknown[]) => unknown>;
import { writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runSync, type SyncOptions } from "../../src/cli/sync-command.js";
import type { ProcessorResult } from "../../src/sync/repository-processor.js";
import type {
  IRepositoryProcessor,
  IRepoSettingsProcessor,
  ILabelsProcessor,
} from "../../src/cli/types.js";
import type { IRulesetProcessor } from "../../src/settings/rulesets/processor.js";
import type { RulesetProcessorResult } from "../../src/settings/rulesets/processor.js";
import type { LabelsProcessorResult } from "../../src/settings/labels/processor.js";
import type { RepoSettingsProcessorResult } from "../../src/settings/repo-settings/processor.js";
import type { RulesetPlanResult } from "../../src/settings/rulesets/formatter.js";
import type { LabelsPlanResult } from "../../src/settings/labels/formatter.js";
import type { RepoSettingsPlanResult } from "../../src/settings/repo-settings/formatter.js";
import {
  noopLifecycleManager,
  failingLifecycleManager,
  creatingLifecycleManager,
} from "../mocks/index.js";

const testDir = join(process.cwd(), "test-sync-cmd-tmp");
const testConfigPath = join(testDir, "test-config.yaml");

// Minimal files section to satisfy validation
const MINIMAL_FILES = `files:
  .placeholder:
    content: "placeholder"
`;

function createMockProcessor(
  overrides: Partial<ProcessorResult> = {}
): IRepositoryProcessor {
  const result: ProcessorResult = {
    success: true,
    skipped: false,
    message: "Processed",
    repoName: "test/repo",
    fileChanges: [],
    ...overrides,
  };
  return {
    process: mock.fn(async (): Promise<ProcessorResult> => result),
  };
}

describe("sync-command", () => {
  let originalExit: typeof process.exit;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let exitCode: number | undefined;
  let consoleOutput: string[];

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    originalExit = process.exit;
    exitCode = undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as never;

    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    consoleOutput = [];
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("lifecycle integration", () => {
    test("handles lifecycle error and continues to next repo", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo1
    upstream: https://github.com/other/upstream
  - git: https://github.com/test/repo2
`
      );

      const mockProcessor = createMockProcessor();

      await assert.rejects(
        async () =>
          runSync(
            { config: testConfigPath, dryRun: true, workDir: testDir },
            {
              processorFactory: () => mockProcessor,
              lifecycleManager: failingLifecycleManager,
            }
          ),
        /process\.exit\(1\)/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Lifecycle error"));
      assert.equal(exitCode, 1);
    });

    test("processes repo successfully when lifecycle check passes", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
`
      );

      const mockProcessor = createMockProcessor({
        success: true,
        message: "PR created",
        fileChanges: [
          { path: ".gitignore", action: "create" as const },
          { path: "config.json", action: "modify" as const },
        ],
      });

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => mockProcessor,
          lifecycleManager: noopLifecycleManager,
        }
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("PR created"));
    });

    test("handles skipped result", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
`
      );

      const mockProcessor = createMockProcessor({
        success: true,
        skipped: true,
        message: "No changes needed",
      });

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => mockProcessor,
          lifecycleManager: noopLifecycleManager,
        }
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("No changes needed"));
    });

    test("handles failed processor result", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
`
      );

      const mockProcessor = createMockProcessor({
        success: false,
        message: "Clone failed",
      });

      await assert.rejects(
        async () =>
          runSync(
            { config: testConfigPath, dryRun: true, workDir: testDir },
            {
              processorFactory: () => mockProcessor,
              lifecycleManager: noopLifecycleManager,
            }
          ),
        /process\.exit\(1\)/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Clone failed"));
      assert.equal(exitCode, 1);
    });

    test("skips repo processing in dry-run when lifecycle would create repo", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
`
      );

      const mockProcessor = createMockProcessor();

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => mockProcessor,
          lifecycleManager: creatingLifecycleManager,
        }
      );

      // Processor should NOT be called — repo doesn't exist in dry-run
      assert.equal(
        (mockProcessor.process as MockFn).mock.calls.length,
        0,
        "processor.process should not be called for non-existent repo in dry-run"
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("CREATE"));
    });

    test("handles processor exception", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
`
      );

      const mockProcessor: IRepositoryProcessor = {
        process: mock.fn(async () => {
          throw new Error("Network error");
        }),
      };

      await assert.rejects(
        async () =>
          runSync(
            { config: testConfigPath, dryRun: true, workDir: testDir },
            {
              processorFactory: () => mockProcessor,
              lifecycleManager: noopLifecycleManager,
            }
          ),
        /process\.exit\(1\)/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Network error"));
      assert.equal(exitCode, 1);
    });
  });

  describe("config file not found", () => {
    test("exits with code 1 when config file does not exist", async () => {
      const options: SyncOptions = {
        config: "/nonexistent/config.yaml",
        dryRun: true,
      };

      await assert.rejects(async () => runSync(options), /process\.exit\(1\)/);
      assert.equal(exitCode, 1);
    });
  });

  describe("invalid git URL", () => {
    test("handles invalid git URL and continues to next repo", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: invalid-url-format
  - git: https://github.com/test/repo
`
      );

      const mockProcessor = createMockProcessor();

      // Exits with error code 1 because of the failed repo
      await assert.rejects(
        async () =>
          runSync(
            { config: testConfigPath, dryRun: true, workDir: testDir },
            {
              processorFactory: () => mockProcessor,
              lifecycleManager: noopLifecycleManager,
            }
          ),
        /process\.exit\(1\)/
      );

      const output = consoleOutput.join("\n");
      // Should log error for invalid URL
      assert.ok(output.includes("invalid-url-format"));
      assert.equal(exitCode, 1);
    });
  });

  describe("settings processing", () => {
    // Valid config snippets for settings
    const VALID_RULESET = `
        my-ruleset:
          target: branch
          enforcement: active
          conditions:
            ref_name:
              include: ["~DEFAULT_BRANCH"]
              exclude: []
          rules: []
`;

    const VALID_LABELS = `
        bug:
          color: "d73a4a"
          description: "Something isn't working"
`;

    function emptyRulesetPlanOutput(): RulesetPlanResult {
      return {
        lines: [],
        creates: 0,
        updates: 0,
        deletes: 0,
        unchanged: 0,
        entries: [],
      };
    }

    function emptyLabelsPlanOutput(): LabelsPlanResult {
      return {
        lines: [],
        creates: 0,
        updates: 0,
        deletes: 0,
        unchanged: 0,
        entries: [],
      };
    }

    function emptyRepoSettingsPlanOutput(): RepoSettingsPlanResult {
      return {
        lines: [],
        adds: 0,
        changes: 0,
        warnings: [],
        entries: [],
      };
    }

    function createMockRulesetProcessor(
      overrides: Partial<RulesetProcessorResult> = {}
    ): IRulesetProcessor {
      return {
        process: mock.fn(
          async (): Promise<RulesetProcessorResult> => ({
            success: true,
            repoName: "test/repo",
            message: "Rulesets synced",
            skipped: false,
            planOutput: emptyRulesetPlanOutput(),
            ...overrides,
          })
        ),
      };
    }

    function createMockLabelsProcessor(
      overrides: Partial<LabelsProcessorResult> = {}
    ): ILabelsProcessor {
      return {
        process: mock.fn(
          async (): Promise<LabelsProcessorResult> => ({
            success: true,
            repoName: "test/repo",
            message: "Labels synced",
            skipped: false,
            planOutput: emptyLabelsPlanOutput(),
            ...overrides,
          })
        ),
      };
    }

    function createMockRepoSettingsProcessor(
      overrides: Partial<RepoSettingsProcessorResult> = {}
    ): IRepoSettingsProcessor {
      return {
        process: mock.fn(
          async (): Promise<RepoSettingsProcessorResult> => ({
            success: true,
            repoName: "test/repo",
            message: "Repo settings synced",
            skipped: false,
            planOutput: emptyRepoSettingsPlanOutput(),
            ...overrides,
          })
        ),
      };
    }

    test("processes rulesets for GitHub repos", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:
${VALID_RULESET}
`
      );

      const mockRulesetProcessor = createMockRulesetProcessor({
        success: true,
        message: "1 created",
        planOutput: {
          lines: ["  + my-ruleset"],
          creates: 1,
          updates: 0,
          deletes: 0,
          unchanged: 0,
          entries: [{ name: "my-ruleset", action: "create" as const }],
        },
      });

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          rulesetProcessorFactory: () => mockRulesetProcessor,
        }
      );

      assert.equal(
        (mockRulesetProcessor.process as MockFn).mock.calls.length,
        1,
        "rulesetProcessor.process should be called once"
      );
    });

    test("processes labels for GitHub repos", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      labels:
${VALID_LABELS}
`
      );

      const mockLabelsProcessor = createMockLabelsProcessor({
        success: true,
        message: "1 created",
      });

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          labelsProcessorFactory: () => mockLabelsProcessor,
        }
      );

      assert.equal(
        (mockLabelsProcessor.process as MockFn).mock.calls.length,
        1,
        "labelsProcessor.process should be called once"
      );
    });

    test("processes repo settings for GitHub repos", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      repo:
        hasWiki: false
`
      );

      const mockRepoSettingsProcessor = createMockRepoSettingsProcessor({
        success: true,
        message: "No changes needed",
      });

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          repoSettingsProcessorFactory: () => mockRepoSettingsProcessor,
        }
      );

      assert.equal(
        (mockRepoSettingsProcessor.process as MockFn).mock.calls.length,
        1,
        "repoSettingsProcessor.process should be called once"
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("No changes needed"),
        "Should log no-changes message for repo settings"
      );
    });

    test("logs no-changes message for rulesets when no changes needed", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:
${VALID_RULESET}
`
      );

      const mockRulesetProcessor = createMockRulesetProcessor({
        success: true,
        message: "No changes needed",
      });

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          rulesetProcessorFactory: () => mockRulesetProcessor,
        }
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("No changes needed"),
        "Should log no-changes message for rulesets"
      );
    });

    test("logs no-changes message for labels when no changes needed", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      labels:
${VALID_LABELS}
`
      );

      const mockLabelsProcessor = createMockLabelsProcessor({
        success: true,
        message: "No changes needed",
      });

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          labelsProcessorFactory: () => mockLabelsProcessor,
        }
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("No changes needed"),
        "Should log no-changes message for labels"
      );
    });

    test("skips settings processing for non-GitHub repos", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://dev.azure.com/org/project/_git/repo
    settings:
      rulesets:
${VALID_RULESET}
`
      );

      const mockRulesetProcessor = createMockRulesetProcessor();

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          rulesetProcessorFactory: () => mockRulesetProcessor,
        }
      );

      assert.equal(
        (mockRulesetProcessor.process as MockFn).mock.calls.length,
        0,
        "rulesetProcessor.process should not be called for non-GitHub repos"
      );
    });

    test("catches settings processor error and sets exit code 1", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:
${VALID_RULESET}
`
      );

      const mockRulesetProcessor: IRulesetProcessor = {
        process: mock.fn(async () => {
          throw new Error("API rate limit exceeded");
        }),
      };

      await assert.rejects(
        async () =>
          runSync(
            { config: testConfigPath, dryRun: true, workDir: testDir },
            {
              processorFactory: () => createMockProcessor(),
              lifecycleManager: noopLifecycleManager,
              rulesetProcessorFactory: () => mockRulesetProcessor,
            }
          ),
        /process\.exit\(1\)/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("API rate limit exceeded"));
      assert.equal(exitCode, 1);
    });

    test("exits with code 1 when settings errors even if file sync succeeds", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      labels:
${VALID_LABELS}
`
      );

      const mockLabelsProcessor: ILabelsProcessor = {
        process: mock.fn(async () => {
          throw new Error("Labels API failure");
        }),
      };

      await assert.rejects(
        async () =>
          runSync(
            { config: testConfigPath, dryRun: true, workDir: testDir },
            {
              processorFactory: () =>
                createMockProcessor({ success: true, message: "Files synced" }),
              lifecycleManager: noopLifecycleManager,
              labelsProcessorFactory: () => mockLabelsProcessor,
            }
          ),
        /process\.exit\(1\)/
      );

      assert.equal(exitCode, 1);
    });

    test("processes all three settings types together", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:
${VALID_RULESET}
      labels:
${VALID_LABELS}
      repo:
        hasWiki: false
`
      );

      const mockRulesetProcessor = createMockRulesetProcessor();
      const mockLabelsProcessor = createMockLabelsProcessor();
      const mockRepoSettingsProcessor = createMockRepoSettingsProcessor();

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          rulesetProcessorFactory: () => mockRulesetProcessor,
          labelsProcessorFactory: () => mockLabelsProcessor,
          repoSettingsProcessorFactory: () => mockRepoSettingsProcessor,
        }
      );

      assert.equal(
        (mockRulesetProcessor.process as MockFn).mock.calls.length,
        1,
        "rulesetProcessor should be called"
      );
      assert.equal(
        (mockLabelsProcessor.process as MockFn).mock.calls.length,
        1,
        "labelsProcessor should be called"
      );
      assert.equal(
        (mockRepoSettingsProcessor.process as MockFn).mock.calls.length,
        1,
        "repoSettingsProcessor should be called"
      );
    });

    test("no error exit when settings succeed", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:
${VALID_RULESET}
`
      );

      const mockRulesetProcessor = createMockRulesetProcessor({
        success: true,
        message: "No changes needed",
      });

      // Should NOT throw (no process.exit(1))
      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          rulesetProcessorFactory: () => mockRulesetProcessor,
        }
      );

      assert.equal(exitCode, undefined, "Should not exit with error code");
    });
  });
});
