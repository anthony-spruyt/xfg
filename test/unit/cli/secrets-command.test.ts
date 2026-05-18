import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runSecretsSync,
  type ISecretsProcessorAdapter,
} from "../../../src/cli/secrets-command.js";
import type { SecretsProcessorResult } from "../../../src/settings/secrets/processor.js";

const testDir = join(tmpdir(), "test-secrets-cmd-tmp");
const testConfigPath = join(testDir, "test-config.yaml");

function createMockProcessor(
  overrides: Partial<SecretsProcessorResult> = {}
): ISecretsProcessorAdapter {
  const result: SecretsProcessorResult = {
    success: true,
    repoName: "test-org/test-repo",
    message: "1 created, 0 updated, 0 deleted",
    ...overrides,
  };
  return {
    process: mock.fn(async (): Promise<SecretsProcessorResult> => result),
  };
}

function createThrowingProcessor(error: Error): ISecretsProcessorAdapter {
  return {
    process: mock.fn(async (): Promise<SecretsProcessorResult> => {
      throw error;
    }),
  };
}

describe("secrets-command", () => {
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let consoleOutput: string[];

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

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
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("happy path: valid config with one repo, processor returns success", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
secrets:
  DEPLOY_TOKEN:
    env: TOKEN_SOURCE
repos:
  - git: https://github.com/test-org/test-repo
`
    );

    const mockProcessor = createMockProcessor();

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir },
      { processorFactory: () => mockProcessor }
    );

    const processMock = mockProcessor.process as unknown as ReturnType<
      typeof mock.fn
    >;
    assert.equal(
      processMock.mock.calls.length,
      1,
      "processor.process should be called once"
    );

    const callArgs = processMock.mock.calls[0].arguments;

    const repoConfig = callArgs[0] as { git: string };
    assert.equal(
      repoConfig.git,
      "https://github.com/test-org/test-repo",
      "repoConfig.git should match the repo URL"
    );

    const repoInfo = callArgs[1] as { owner: string; repo: string };
    assert.equal(
      repoInfo.owner,
      "test-org",
      "repoInfo.owner should be test-org"
    );
    assert.equal(
      repoInfo.repo,
      "test-repo",
      "repoInfo.repo should be test-repo"
    );

    const options = callArgs[2] as { dryRun?: boolean; noDelete?: boolean };
    assert.equal(options.dryRun, undefined, "dryRun should be undefined");
    assert.equal(options.noDelete, undefined, "noDelete should be undefined");

    const output = consoleOutput.join("\n");
    assert.ok(
      output.includes("1 created, 0 updated, 0 deleted"),
      "Should log success message from processor"
    );
  });

  test("no secrets configured: early return with nothing to do", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
files:
  .placeholder:
    content: "placeholder"
repos:
  - git: https://github.com/test-org/test-repo
`
    );

    const mockProcessor = createMockProcessor();

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir },
      { processorFactory: () => mockProcessor }
    );

    const processMock = mockProcessor.process as unknown as ReturnType<
      typeof mock.fn
    >;
    assert.equal(
      processMock.mock.calls.length,
      0,
      "processor.process should not be called when no secrets configured"
    );

    const output = consoleOutput.join("\n");
    assert.ok(
      output.includes("Nothing to do"),
      "Should log nothing-to-do message"
    );
  });

  test("error handling: processor throws, function throws aggregated error", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
secrets:
  MY_SECRET:
    env: SECRET_VAR
repos:
  - git: https://github.com/test-org/test-repo
`
    );

    const mockProcessor = createThrowingProcessor(
      new Error("API rate limit exceeded")
    );

    await assert.rejects(
      async () =>
        runSecretsSync(
          { config: testConfigPath, workDir: testDir },
          { processorFactory: () => mockProcessor }
        ),
      /One or more repositories failed secrets sync/
    );

    const processMock = mockProcessor.process as unknown as ReturnType<
      typeof mock.fn
    >;
    assert.equal(
      processMock.mock.calls.length,
      1,
      "processor.process should be called once for the single repo"
    );

    const output = consoleOutput.join("\n");
    assert.ok(
      output.includes("API rate limit exceeded"),
      "Should log the thrown error message"
    );
  });

  test("noDelete option passed through correctly", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
secrets:
  DEPLOY_TOKEN:
    env: TOKEN_SOURCE
repos:
  - git: https://github.com/test-org/test-repo
`
    );

    const mockProcessor = createMockProcessor();

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir, noDelete: true },
      { processorFactory: () => mockProcessor }
    );

    const processMock = mockProcessor.process as unknown as ReturnType<
      typeof mock.fn
    >;
    assert.equal(processMock.mock.calls.length, 1);
    const callArgs = processMock.mock.calls[0].arguments;
    assert.equal(
      (callArgs[2] as { noDelete?: boolean }).noDelete,
      true,
      "noDelete option should be passed to processor"
    );
  });

  test("dryRun option passed through correctly", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
secrets:
  DEPLOY_TOKEN:
    env: TOKEN_SOURCE
repos:
  - git: https://github.com/test-org/test-repo
`
    );

    const mockProcessor = createMockProcessor({ dryRun: true });

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir, dryRun: true },
      { processorFactory: () => mockProcessor }
    );

    const processMock = mockProcessor.process as unknown as ReturnType<
      typeof mock.fn
    >;
    assert.equal(processMock.mock.calls.length, 1);
    const callArgs = processMock.mock.calls[0].arguments;
    assert.equal(
      (callArgs[2] as { dryRun?: boolean }).dryRun,
      true,
      "dryRun option should be passed to processor"
    );
  });

  test("secrets with only deleteOrphaned: false and no entries returns early", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
secrets:
  deleteOrphaned: false
repos:
  - git: https://github.com/test-org/test-repo
`
    );

    const mockProcessor = createMockProcessor();

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir },
      { processorFactory: () => mockProcessor }
    );

    const processMock = mockProcessor.process as unknown as ReturnType<
      typeof mock.fn
    >;
    assert.equal(
      processMock.mock.calls.length,
      0,
      "processor.process should not be called when no secret entries and deleteOrphaned is false"
    );

    const output = consoleOutput.join("\n");
    assert.ok(
      output.includes("Nothing to do"),
      "Should log nothing-to-do message"
    );
  });

  test("processes multiple repos and aggregates errors", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
secrets:
  MY_SECRET:
    env: SECRET_VAR
repos:
  - git: https://github.com/test-org/repo1
  - git: https://github.com/test-org/repo2
`
    );

    let callCount = 0;
    const mockProcessor: ISecretsProcessorAdapter = {
      process: mock.fn(async (): Promise<SecretsProcessorResult> => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Failed for repo1");
        }
        return {
          success: true,
          repoName: "test-org/repo2",
          message: "1 created, 0 updated, 0 deleted",
        };
      }),
    };

    await assert.rejects(
      async () =>
        runSecretsSync(
          { config: testConfigPath, workDir: testDir },
          { processorFactory: () => mockProcessor }
        ),
      /One or more repositories failed secrets sync/
    );

    const processMock = mockProcessor.process as unknown as ReturnType<
      typeof mock.fn
    >;
    assert.equal(
      processMock.mock.calls.length,
      2,
      "processor.process should be called for both repos"
    );
  });

  test("skipped result logs skip message", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
secrets:
  MY_SECRET:
    env: SECRET_VAR
repos:
  - git: https://github.com/test-org/test-repo
`
    );

    const mockProcessor = createMockProcessor({
      skipped: true,
      message: "Skipped: not a GitHub repository",
    });

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir },
      { processorFactory: () => mockProcessor }
    );

    const output = consoleOutput.join("\n");
    assert.ok(
      output.includes("Skipped: not a GitHub repository"),
      "Should log the skip message"
    );
  });
});
