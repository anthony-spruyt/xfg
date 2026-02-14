import {
  test,
  describe,
  beforeEach,
  afterEach,
  mock,
  type Mock,
} from "node:test";

// Helper type for mock function - avoids verbose casting
type MockFn = Mock<(...args: unknown[]) => unknown>;
import { strict as assert } from "node:assert";
import { writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  runSettings,
  type SettingsOptions,
} from "../../src/cli/settings-command.js";
import type { IRepositoryProcessor } from "../../src/cli/types.js";
import type { IRulesetProcessor } from "../../src/settings/rulesets/processor.js";
import type { IRepoSettingsProcessor } from "../../src/settings/repo-settings/processor.js";
import type { RepoSettingsProcessorResult } from "../../src/settings/repo-settings/processor.js";
import type { RulesetProcessorResult } from "../../src/settings/rulesets/processor.js";
import type { ProcessorResult } from "../../src/sync/repository-processor.js";
import type { RulesetPlanResult } from "../../src/settings/rulesets/formatter.js";
import {
  noopLifecycleManager,
  failingLifecycleManager,
  creatingLifecycleManager,
} from "../mocks/index.js";
import type { RepoSettingsPlanResult } from "../../src/settings/repo-settings/formatter.js";

const testDir = join(process.cwd(), "test-settings-cmd-tmp");
const testConfigPath = join(testDir, "test-config.yaml");

// Minimal files section to satisfy validation
const MINIMAL_FILES = `files:
  .placeholder:
    content: "placeholder"
`;

// Valid ruleset config - rules must be an array
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

// Default empty plan outputs with correct types
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

function emptyRepoSettingsPlanOutput(): RepoSettingsPlanResult {
  return {
    lines: [],
    adds: 0,
    changes: 0,
    warnings: [],
    entries: [],
  };
}

// Helper to create mock processors with correct types
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

function createMockRepoProcessor(
  overrides: Partial<ProcessorResult> = {}
): IRepositoryProcessor {
  const result: ProcessorResult = {
    success: true,
    skipped: false,
    message: "Processed",
    repoName: "test/repo",
    ...overrides,
  };
  return {
    process: mock.fn(async (): Promise<ProcessorResult> => result),
    updateManifestOnly: mock.fn(async (): Promise<ProcessorResult> => result),
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

describe("settings-command", () => {
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

  describe("config file not found", () => {
    test("exits with code 1 when config file does not exist", async () => {
      const options: SettingsOptions = {
        config: "/nonexistent/config.yaml",
        dryRun: true,
      };

      await assert.rejects(
        async () => runSettings(options),
        /process\.exit\(1\)/
      );
      assert.equal(exitCode, 1);
    });
  });

  describe("repo settings processing", () => {
    test("processes repo settings for GitHub repos", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      repo:
        has_issues: true
`
      );

      const planOutput: RepoSettingsPlanResult = {
        lines: ["  ~ has_issues: false → true"],
        adds: 0,
        changes: 1,
        warnings: [],
        entries: [{ property: "has_issues", action: "change" }],
      };

      const mockRepoSettingsProcessor = createMockRepoSettingsProcessor({
        success: true,
        message: "Settings applied",
        planOutput,
      });

      await runSettings(
        { config: testConfigPath, dryRun: true },
        () => createMockRulesetProcessor(),
        () => createMockRepoProcessor(),
        () => mockRepoSettingsProcessor,
        noopLifecycleManager
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Settings applied"));
    });

    test("handles repo settings with warnings", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      repo:
        has_issues: true
`
      );

      const planOutput: RepoSettingsPlanResult = {
        lines: ["  ~ has_issues"],
        adds: 0,
        changes: 1,
        warnings: ["Some feature is deprecated"],
        entries: [{ property: "has_issues", action: "change" }],
      };

      const mockRepoSettingsProcessor = createMockRepoSettingsProcessor({
        success: true,
        message: "Settings applied with warnings",
        warnings: ["Some feature is deprecated"],
        planOutput,
      });

      await runSettings(
        { config: testConfigPath, dryRun: true },
        () => createMockRulesetProcessor(),
        () => createMockRepoProcessor(),
        () => mockRepoSettingsProcessor,
        noopLifecycleManager
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Warning"));
    });

    test("handles failed repo settings processing", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      repo:
        has_issues: true
`
      );

      const mockRepoSettingsProcessor = createMockRepoSettingsProcessor({
        success: false,
        message: "Failed to apply settings",
      });

      await runSettings(
        { config: testConfigPath, dryRun: true },
        () => createMockRulesetProcessor(),
        () => createMockRepoProcessor(),
        () => mockRepoSettingsProcessor,
        noopLifecycleManager
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Failed to apply settings"));
    });

    test("handles exception in repo settings processing", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      repo:
        has_issues: true
`
      );

      const mockRepoSettingsProcessor: IRepoSettingsProcessor = {
        process: mock.fn(async () => {
          throw new Error("Network error");
        }),
      };

      await assert.rejects(
        async () =>
          runSettings(
            { config: testConfigPath, dryRun: true },
            () => createMockRulesetProcessor(),
            () => createMockRepoProcessor(),
            () => mockRepoSettingsProcessor,
            noopLifecycleManager
          ),
        /process\.exit\(1\)/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Network error"));
      assert.equal(exitCode, 1);
    });

    test("handles invalid git URL in repo settings", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: invalid-url
    settings:
      repo:
        has_issues: true
`
      );

      await assert.rejects(
        async () =>
          runSettings(
            { config: testConfigPath, dryRun: true },
            () => createMockRulesetProcessor(),
            () => createMockRepoProcessor(),
            () => createMockRepoSettingsProcessor(),
            noopLifecycleManager
          ),
        /process\.exit\(1\)/
      );
      assert.equal(exitCode, 1);
    });
  });

  describe("lifecycle error handling", () => {
    test("handles lifecycle error in rulesets processing", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    upstream: https://github.com/other/upstream
    settings:
      rulesets:${VALID_RULESET}
`
      );

      await assert.rejects(
        async () =>
          runSettings(
            { config: testConfigPath, dryRun: true },
            () => createMockRulesetProcessor(),
            () => createMockRepoProcessor(),
            () => createMockRepoSettingsProcessor(),
            failingLifecycleManager
          ),
        /process\.exit\(1\)/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Lifecycle error"));
      assert.equal(exitCode, 1);
    });

    test("skips rulesets and repo settings in dry-run when lifecycle would create repo", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:${VALID_RULESET}
      repo:
        has_issues: true
`
      );

      const mockRulesetProcessor = createMockRulesetProcessor();
      const mockRepoSettingsProcessor = createMockRepoSettingsProcessor();

      await runSettings(
        { config: testConfigPath, dryRun: true },
        () => mockRulesetProcessor,
        () => createMockRepoProcessor(),
        () => mockRepoSettingsProcessor,
        creatingLifecycleManager
      );

      // Neither processor should be called — repo doesn't exist in dry-run
      assert.equal(
        (mockRulesetProcessor.process as MockFn).mock.calls.length,
        0,
        "rulesets processor should not be called for non-existent repo in dry-run"
      );
      assert.equal(
        (mockRepoSettingsProcessor.process as MockFn).mock.calls.length,
        0,
        "repo settings processor should not be called for non-existent repo in dry-run"
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("CREATE"));
    });

    test("handles lifecycle error in repo settings processing", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    upstream: https://github.com/other/upstream
    settings:
      repo:
        has_issues: true
`
      );

      await assert.rejects(
        async () =>
          runSettings(
            { config: testConfigPath, dryRun: true },
            () => createMockRulesetProcessor(),
            () => createMockRepoProcessor(),
            () => createMockRepoSettingsProcessor(),
            failingLifecycleManager
          ),
        /process\.exit\(1\)/
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Lifecycle error"));
      assert.equal(exitCode, 1);
    });
  });

  describe("rulesets processing", () => {
    test("skips non-GitHub repos for rulesets", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://dev.azure.com/org/project/_git/repo
    settings:
      rulesets:${VALID_RULESET}
`
      );

      await runSettings(
        { config: testConfigPath, dryRun: true },
        () => createMockRulesetProcessor(),
        () => createMockRepoProcessor(),
        () => createMockRepoSettingsProcessor(),
        noopLifecycleManager
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("GitHub Rulesets only supported"));
    });

    test("handles exception in ruleset processing", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:${VALID_RULESET}
`
      );

      const mockRulesetProcessor: IRulesetProcessor = {
        process: mock.fn(async () => {
          throw new Error("API error");
        }),
      };

      await assert.rejects(
        async () =>
          runSettings(
            { config: testConfigPath, dryRun: true },
            () => mockRulesetProcessor,
            () => createMockRepoProcessor(),
            () => createMockRepoSettingsProcessor(),
            noopLifecycleManager
          ),
        /process\.exit\(1\)/
      );
      assert.equal(exitCode, 1);
    });

    test("handles failed ruleset processing", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:${VALID_RULESET}
`
      );

      const mockRulesetProcessor = createMockRulesetProcessor({
        success: false,
        message: "Failed to sync rulesets",
      });

      await runSettings(
        { config: testConfigPath, dryRun: true },
        () => mockRulesetProcessor,
        () => createMockRepoProcessor(),
        () => createMockRepoSettingsProcessor(),
        noopLifecycleManager
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Failed to sync rulesets"));
    });

    test("updates manifest when ruleset processing has manifest updates", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:${VALID_RULESET}
`
      );

      const mockRulesetProcessor = createMockRulesetProcessor({
        success: true,
        message: "Rulesets synced",
        manifestUpdate: { rulesets: ["my-ruleset"] },
      });

      const mockRepoProcessor = createMockRepoProcessor();

      await runSettings(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        () => mockRulesetProcessor,
        () => mockRepoProcessor,
        () => createMockRepoSettingsProcessor(),
        noopLifecycleManager
      );

      const updateManifestCalls = (
        mockRepoProcessor.updateManifestOnly as unknown as MockFn
      ).mock.calls;
      assert.equal(updateManifestCalls.length, 1);
    });

    test("handles failed manifest update gracefully", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:${VALID_RULESET}
`
      );

      const mockRulesetProcessor = createMockRulesetProcessor({
        success: true,
        message: "Rulesets synced",
        manifestUpdate: { rulesets: ["my-ruleset"] },
      });

      const mockRepoProcessor = createMockRepoProcessor({
        success: false,
        message: "Failed to update manifest",
      });

      await runSettings(
        { config: testConfigPath, dryRun: true, workDir: testDir },
        () => mockRulesetProcessor,
        () => mockRepoProcessor,
        () => createMockRepoSettingsProcessor(),
        noopLifecycleManager
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("Warning: Failed to update manifest"));
    });

    test("displays plan output when available", async () => {
      writeFileSync(
        testConfigPath,
        `id: test-config
${MINIMAL_FILES}
repos:
  - git: https://github.com/test/repo
    settings:
      rulesets:${VALID_RULESET}
`
      );

      const planOutput: RulesetPlanResult = {
        lines: ["  + my-ruleset (create)", "    enforcement: active"],
        creates: 1,
        updates: 0,
        deletes: 0,
        unchanged: 0,
        entries: [{ name: "my-ruleset", action: "create" }],
      };

      const mockRulesetProcessor = createMockRulesetProcessor({
        success: true,
        message: "Rulesets synced",
        planOutput,
      });

      await runSettings(
        { config: testConfigPath, dryRun: true },
        () => mockRulesetProcessor,
        () => createMockRepoProcessor(),
        () => createMockRepoSettingsProcessor(),
        noopLifecycleManager
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes("my-ruleset"));
    });
  });
});
