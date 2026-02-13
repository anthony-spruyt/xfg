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
import type { IRepositoryProcessor } from "../../src/cli/types.js";
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
    updateManifestOnly: mock.fn(async (): Promise<ProcessorResult> => result),
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
            () => mockProcessor,
            failingLifecycleManager
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
        () => mockProcessor,
        noopLifecycleManager
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
        () => mockProcessor,
        noopLifecycleManager
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
            () => mockProcessor,
            noopLifecycleManager
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
        () => mockProcessor,
        creatingLifecycleManager
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
        updateManifestOnly: mock.fn(async () => ({
          success: true,
          skipped: false,
          message: "ok",
          repoName: "test/repo",
        })),
      };

      await assert.rejects(
        async () =>
          runSync(
            { config: testConfigPath, dryRun: true, workDir: testDir },
            () => mockProcessor,
            noopLifecycleManager
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
            () => mockProcessor,
            noopLifecycleManager
          ),
        /process\.exit\(1\)/
      );

      const output = consoleOutput.join("\n");
      // Should log error for invalid URL
      assert.ok(output.includes("invalid-url-format"));
      assert.equal(exitCode, 1);
    });
  });
});
