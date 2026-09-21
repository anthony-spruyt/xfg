import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runSecretsSync,
  type ISecretsProcessorAdapter,
} from "../../../src/cli/secrets-command.js";
import type { RepoConfig } from "../../../src/config/index.js";
import type { SecretsProcessorResult } from "../../../src/settings/secrets/index.js";

let testDir: string;
let testConfigPath: string;

function createMockProcessor(
  overrides: Partial<SecretsProcessorResult> = {}
): ISecretsProcessorAdapter {
  const result: SecretsProcessorResult = {
    success: true,
    repoName: "test-org/test-repo",
    message: "Applied: 1 created",
    changes: { create: 1, update: 0, delete: 0, unchanged: 0 },
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
    testDir = mkdtempSync(join(tmpdir(), "test-secrets-cmd-"));
    testConfigPath = join(testDir, "test-config.yaml");

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
settings:
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

    const repoConfig = callArgs[0] as RepoConfig;
    const secrets = repoConfig.settings?.secrets as Record<string, unknown>;
    assert.ok(
      "DEPLOY_TOKEN" in secrets,
      "repo settings should carry DEPLOY_TOKEN"
    );
    assert.deepEqual(
      (secrets.DEPLOY_TOKEN as { env: string }).env,
      "TOKEN_SOURCE",
      "DEPLOY_TOKEN should have env: TOKEN_SOURCE"
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
      output.includes("Applied: 1 created"),
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

    const mockProcessor = createMockProcessor({
      skipped: true,
      noSecretsConfigured: true,
      message: "No secrets configured",
    });

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir },
      { processorFactory: () => mockProcessor }
    );

    const output = consoleOutput.join("\n");
    assert.ok(
      output.includes("Nothing to do"),
      "Should log nothing-to-do message"
    );
    assert.ok(
      !output.includes("Skipped -"),
      `Empty-secrets skips must not print a skip line, got: ${output}`
    );
  });

  test("error handling: processor throws, function throws aggregated error", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
settings:
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
settings:
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
settings:
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

  test("secrets with only deleteOrphaned: false and no entries is nothing to do", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
settings:
  secrets:
    deleteOrphaned: false
repos:
  - git: https://github.com/test-org/test-repo
`
    );

    const mockProcessor = createMockProcessor({
      skipped: true,
      noSecretsConfigured: true,
      message: "No secrets configured",
    });

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir },
      { processorFactory: () => mockProcessor }
    );

    const processMock = mockProcessor.process as unknown as ReturnType<
      typeof mock.fn
    >;
    const repoConfig = processMock.mock.calls[0].arguments[0] as RepoConfig;
    assert.equal(
      repoConfig.settings?.secrets,
      undefined,
      "deleteOrphaned: false alone is not actionable, so secrets collapse away"
    );

    const output = consoleOutput.join("\n");
    assert.ok(
      output.includes("Nothing to do"),
      "Should log nothing-to-do message"
    );
  });

  test("only repos with merged secrets are reported; empty ones stay silent", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
groups:
  frontend:
    settings:
      secrets:
        NPM_TOKEN:
          env: NPM_TOKEN_VALUE
repos:
  - git: https://github.com/test-org/web
    groups: [frontend]
  - git: https://github.com/test-org/api
`
    );

    const seen: { git: string; hasSecrets: boolean }[] = [];
    const mockProcessor: ISecretsProcessorAdapter = {
      process: mock.fn(
        async (repoConfig: RepoConfig): Promise<SecretsProcessorResult> => {
          const hasSecrets = repoConfig.settings?.secrets !== undefined;
          seen.push({ git: repoConfig.git, hasSecrets });
          if (!hasSecrets) {
            return {
              success: true,
              repoName: repoConfig.git,
              message: "No secrets configured",
              skipped: true,
              noSecretsConfigured: true,
            };
          }
          return {
            success: true,
            repoName: repoConfig.git,
            message: "Applied: 1 created",
            changes: { create: 1, update: 0, delete: 0, unchanged: 0 },
          };
        }
      ),
    };

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir },
      { processorFactory: () => mockProcessor }
    );

    assert.deepEqual(seen, [
      { git: "https://github.com/test-org/web", hasSecrets: true },
      { git: "https://github.com/test-org/api", hasSecrets: false },
    ]);

    const output = consoleOutput.join("\n");
    assert.ok(
      output.includes("Applied: 1 created"),
      `Expected the scoped repo to be reported, got: ${output}`
    );
    assert.ok(
      !output.includes("api"),
      `The repo with no secrets must not be logged, got: ${output}`
    );
  });

  test("processes multiple repos and aggregates errors", async () => {
    writeFileSync(
      testConfigPath,
      `id: test-config
settings:
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
          message: "Applied: 1 created",
          changes: { create: 1, update: 0, delete: 0, unchanged: 0 },
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
settings:
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
