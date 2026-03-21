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
import type { ProcessorResult } from "../../src/sync/types.js";
import type { IRepositoryProcessor } from "../../src/sync/types.js";
import type {
  IRepoSettingsProcessor,
  ILabelsProcessor,
} from "../../src/settings/index.js";
import type {
  IRulesetProcessor,
  RulesetProcessorResult,
} from "../../src/settings/rulesets/processor.js";
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
        /One or more repositories had errors during sync/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Lifecycle error"));
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
          { path: "config.json", action: "update" as const },
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
        /One or more repositories had errors during sync/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Clone failed"));
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
        /One or more repositories had errors during sync/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Network error"));
    });
  });

  describe("config file not found", () => {
    test("throws when config file does not exist", async () => {
      const options: SyncOptions = {
        config: "/nonexistent/config.yaml",
        dryRun: true,
      };

      await assert.rejects(
        async () => runSync(options),
        /Config file not found/
      );
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
        /One or more repositories had errors during sync/
      );

      const output = consoleOutput.join("\n");
      // Should log error for invalid URL
      assert.ok(output.includes("invalid-url-format"));
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
        creates: 0,
        updates: 0,
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
        /One or more repositories had errors during sync/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("API rate limit exceeded"));
    });

    test("exits with code 1 when settings processor returns success: false without throwing", async () => {
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
        success: false,
        message: "Failed: insufficient permissions",
      });

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
        /One or more repositories had errors during sync/
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("Failed: insufficient permissions"),
        "Should log error message for failed settings result"
      );
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
        /One or more repositories had errors during sync/
      );
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

    test("logs plan output lines for labels when changes exist", async () => {
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
        planOutput: {
          lines: ["  + bug"],
          creates: 1,
          updates: 0,
          deletes: 0,
          unchanged: 0,
          entries: [{ name: "bug", action: "create" as const }],
        },
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
      assert.ok(output.includes("Labels:"), "Should display labels header");
      assert.ok(
        output.includes("+ bug"),
        "Should display label plan output lines"
      );
    });

    test("logs error and appends error for labels returning success: false", async () => {
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
        success: false,
        message: "Failed: label API error",
      });

      await assert.rejects(
        async () =>
          runSync(
            { config: testConfigPath, dryRun: true, workDir: testDir },
            {
              processorFactory: () => createMockProcessor(),
              lifecycleManager: noopLifecycleManager,
              labelsProcessorFactory: () => mockLabelsProcessor,
            }
          ),
        /One or more repositories had errors during sync/
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("Failed: label API error"),
        "Should log error message for failed labels result"
      );
    });

    test("logs plan output lines for repo settings when changes exist", async () => {
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
        message: "1 changed",
        planOutput: {
          lines: ["  ~ hasWiki: true → false"],
          creates: 0,
          updates: 1,
          warnings: [],
          entries: [
            {
              property: "hasWiki",
              action: "update" as const,
              oldValue: "true",
              newValue: "false",
            },
          ],
        },
      });

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          repoSettingsProcessorFactory: () => mockRepoSettingsProcessor,
        }
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("Repo Settings:"),
        "Should display repo settings header"
      );
      assert.ok(
        output.includes("hasWiki"),
        "Should display repo settings plan output lines"
      );
    });

    test("logs plan output with warnings for repo settings", async () => {
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
        message: "1 changed",
        warnings: ["Some setting requires admin access"],
        planOutput: {
          lines: ["  ~ hasWiki: true → false"],
          creates: 0,
          updates: 1,
          warnings: ["Some setting requires admin access"],
          entries: [
            {
              property: "hasWiki",
              action: "update" as const,
              oldValue: "true",
              newValue: "false",
            },
          ],
        },
      });

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          repoSettingsProcessorFactory: () => mockRepoSettingsProcessor,
        }
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("Some setting requires admin access"),
        "Should display warnings for repo settings"
      );
    });

    test("logs success for repo settings returning no changes needed", async () => {
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
        planOutput: emptyRepoSettingsPlanOutput(),
      });

      await runSync(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        {
          processorFactory: () => createMockProcessor(),
          lifecycleManager: noopLifecycleManager,
          repoSettingsProcessorFactory: () => mockRepoSettingsProcessor,
        }
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("Repo Settings: No changes needed"),
        "Should log success message for repo settings with no changes"
      );
    });

    test("logs error and appends error for repo settings returning success: false", async () => {
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
        success: false,
        message: "Failed: insufficient permissions for repo settings",
      });

      await assert.rejects(
        async () =>
          runSync(
            { config: testConfigPath, dryRun: true, workDir: testDir },
            {
              processorFactory: () => createMockProcessor(),
              lifecycleManager: noopLifecycleManager,
              repoSettingsProcessorFactory: () => mockRepoSettingsProcessor,
            }
          ),
        /One or more repositories had errors during sync/
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("Failed: insufficient permissions for repo settings"),
        "Should log error message for failed repo settings result"
      );
    });

    test("catches repo settings processor error and sets exit code 1", async () => {
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

      const mockRepoSettingsProcessor: IRepoSettingsProcessor = {
        process: mock.fn(async () => {
          throw new Error("Repo settings API failure");
        }),
      };

      await assert.rejects(
        async () =>
          runSync(
            { config: testConfigPath, dryRun: true, workDir: testDir },
            {
              processorFactory: () => createMockProcessor(),
              lifecycleManager: noopLifecycleManager,
              repoSettingsProcessorFactory: () => mockRepoSettingsProcessor,
            }
          ),
        /One or more repositories had errors during sync/
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("Repo settings API failure"),
        "Should log caught error for repo settings"
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

  describe("diffLines propagation", () => {
    test("propagates diffLines from processor result to CLI output", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
`
      );

      const diffLines = ["@@ -1,1 +1,1 @@", "-old", "+new"];
      const mockProcessor = createMockProcessor({
        success: true,
        message: "PR created",
        fileChanges: [
          {
            path: "config.json",
            action: "update" as const,
            diffLines,
          },
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
      assert.ok(
        output.includes("-old"),
        "Should include diff removal line in CLI output"
      );
      assert.ok(
        output.includes("+new"),
        "Should include diff addition line in CLI output"
      );
    });
  });

  describe("merge mode warnings", () => {
    test("warns when mergeStrategy is set with direct merge mode", async () => {
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
        {
          config: testConfigPath,
          dryRun: true,
          workDir: testDir,
          merge: "direct" as const,
          mergeStrategy: "squash" as const,
        },
        {
          processorFactory: () => mockProcessor,
          lifecycleManager: noopLifecycleManager,
        }
      );

      const output = consoleOutput.join("\n");
      assert.ok(
        output.includes("mergeStrategy") && output.includes("ignored"),
        "Should warn that mergeStrategy is ignored in direct mode"
      );
    });
  });
});
