import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  writeFileSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runSecretsSync,
  type ISecretsProcessorAdapter,
} from "../../../src/cli/secrets-command.js";
import type { RepoConfig } from "../../../src/config/index.js";
import type { RepoInfo } from "../../../src/repo/index.js";
import {
  SecretsProcessor,
  type SecretsProcessorResult,
  type ISecretsStrategy,
  type ISecretEncryptor,
  type GitHubSecret,
} from "../../../src/settings/secrets/index.js";
import { EnvResolver } from "../../../src/shared/env-resolver.js";

const SECRET_VALUE = "plaintext-must-never-leak";

class FakeSecretsStrategy implements ISecretsStrategy {
  constructor(private readonly existing: GitHubSecret[]) {}
  async list(): Promise<GitHubSecret[]> {
    return this.existing;
  }
  async getPublicKey() {
    return { key_id: "kid", key: "pk" };
  }
  async upsert(_repo: RepoInfo, _name: string): Promise<void> {}
  async delete(): Promise<void> {}
}

const passthroughEncryptor: ISecretEncryptor = {
  encrypt: async (value: string) => value,
};

function createRealProcessor(): ISecretsProcessorAdapter {
  return new SecretsProcessor(
    new FakeSecretsStrategy([
      { name: "DEPLOY_TOKEN", created_at: "", updated_at: "" },
      { name: "OLD_TOKEN", created_at: "", updated_at: "" },
    ]),
    passthroughEncryptor,
    new EnvResolver({ TOKEN_SOURCE: SECRET_VALUE, KEY_SOURCE: SECRET_VALUE })
  );
}

const PLAN_CONFIG = `id: test-config
settings:
  secrets:
    deleteOrphaned: true
    DEPLOY_TOKEN:
      env: TOKEN_SOURCE
    NEW_KEY:
      env: KEY_SOURCE
repos:
  - git: https://github.com/test-org/test-repo
`;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

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
  let originalSummary: string | undefined;
  let originalDebug: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "test-secrets-cmd-"));
    testConfigPath = join(testDir, "test-config.yaml");

    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    consoleOutput = [];
    originalSummary = process.env.GITHUB_STEP_SUMMARY;
    originalDebug = process.env.XFG_DEBUG;
    delete process.env.GITHUB_STEP_SUMMARY;
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
    restoreEnv("GITHUB_STEP_SUMMARY", originalSummary);
    restoreEnv("XFG_DEBUG", originalDebug);

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

  test("creates the work dir so gh can be spawned with it as cwd", async () => {
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

    const missingWorkDir = join(testDir, "does", "not", "exist");
    assert.equal(existsSync(missingWorkDir), false);

    await runSecretsSync(
      { config: testConfigPath, workDir: missingWorkDir },
      { processorFactory: () => createMockProcessor() }
    );

    assert.ok(
      existsSync(missingWorkDir),
      "Work dir must exist before gh is spawned with it as cwd"
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

  for (const dryRun of [true, false]) {
    test(`names every secret per repo in console and step summary (dryRun=${dryRun})`, async () => {
      writeFileSync(testConfigPath, PLAN_CONFIG);
      const summaryPath = join(testDir, "summary.md");
      process.env.GITHUB_STEP_SUMMARY = summaryPath;
      process.env.XFG_DEBUG = "1";

      await runSecretsSync(
        { config: testConfigPath, workDir: testDir, dryRun },
        { processorFactory: () => createRealProcessor() }
      );

      const output = consoleOutput.join("\n");
      assert.ok(output.includes('+ secret "NEW_KEY"'), output);
      assert.ok(
        output.includes('~ secret "DEPLOY_TOKEN" (update, value write-only)'),
        output
      );
      assert.ok(output.includes('- secret "OLD_TOKEN"'), output);
      assert.ok(
        output.includes(
          dryRun
            ? "Plan: 3 secrets (1 to create, 1 to update, 1 to delete)"
            : "Applied: 3 secrets (1 created, 1 updated, 1 deleted)"
        ),
        output
      );

      const summary = readFileSync(summaryPath, "utf-8");
      assert.ok(
        summary.includes(dryRun ? "## xfg Plan" : "## xfg Apply"),
        summary
      );
      assert.ok(summary.includes("### test-org/test-repo"), summary);
      assert.ok(summary.includes('+ secret "NEW_KEY"'), summary);
      assert.ok(
        summary.includes('! secret "DEPLOY_TOKEN" (update, value write-only)'),
        summary
      );
      assert.ok(summary.includes('- secret "OLD_TOKEN"'), summary);
      assert.ok(summary.includes("3 secrets"), summary);

      assert.ok(!output.includes(SECRET_VALUE), output);
      assert.ok(!summary.includes(SECRET_VALUE), summary);
    });
  }

  test("reports secrets written before a mid-apply failure", async () => {
    writeFileSync(testConfigPath, PLAN_CONFIG);
    const summaryPath = join(testDir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    const strategy = new FakeSecretsStrategy([
      { name: "DEPLOY_TOKEN", created_at: "", updated_at: "" },
      { name: "OLD_TOKEN", created_at: "", updated_at: "" },
    ]);
    strategy.upsert = async (_repo: RepoInfo, name: string) => {
      if (name === "NEW_KEY") throw new Error("HTTP 502");
    };
    const processor = new SecretsProcessor(
      strategy,
      passthroughEncryptor,
      new EnvResolver({ TOKEN_SOURCE: SECRET_VALUE, KEY_SOURCE: SECRET_VALUE })
    );

    await assert.rejects(
      runSecretsSync(
        { config: testConfigPath, workDir: testDir },
        { processorFactory: () => processor }
      )
    );

    const output = consoleOutput.join("\n");
    assert.ok(output.includes("HTTP 502"), output);
    assert.ok(output.includes('~ secret "DEPLOY_TOKEN"'), output);
    assert.ok(output.includes('- secret "OLD_TOKEN"'), output);
    assert.ok(!output.includes('secret "NEW_KEY"'), output);
    assert.ok(output.includes("Applied: 2 secrets"), output);

    const summary = readFileSync(summaryPath, "utf-8");
    assert.ok(summary.includes('! secret "DEPLOY_TOKEN"'), summary);
    assert.ok(summary.includes('- secret "OLD_TOKEN"'), summary);
    assert.ok(!summary.includes('secret "NEW_KEY"'), summary);
    assert.ok(summary.includes("HTTP 502"), summary);
  });

  test("labels console lines with the same repo name as the step summary", async () => {
    writeFileSync(
      testConfigPath,
      PLAN_CONFIG.replace(
        "https://github.com/test-org/test-repo",
        "https://github.com/test-org/test-repo.git"
      )
    );

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir, dryRun: true },
      { processorFactory: () => createRealProcessor() }
    );

    const output = consoleOutput.join("\n");
    assert.match(output, /^\[1\/1\] ✓ test-org\/test-repo: Secrets:/m);
    assert.doesNotMatch(output, /:\/\//);
  });

  test("qualifies repos that share owner/repo across hosts with the host", async () => {
    writeFileSync(
      testConfigPath,
      PLAN_CONFIG.replace(
        "repos:\n  - git: https://github.com/test-org/test-repo\n",
        `githubHosts:
  - ghe.corp
repos:
  - git: https://github.com/test-org/test-repo
  - git: https://ghe.corp/test-org/test-repo
  - git: https://github.com/test-org/other-repo
`
      )
    );
    const summaryPath = join(testDir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir, dryRun: true },
      { processorFactory: () => createRealProcessor() }
    );

    const output = consoleOutput.join("\n");
    assert.match(output, /^\[1\/3\] ✓ github\.com\/test-org\/test-repo: /m);
    assert.match(output, /^\[2\/3\] ✓ ghe\.corp\/test-org\/test-repo: /m);
    assert.match(output, /^\[3\/3\] ✓ test-org\/other-repo: /m);

    const headings = readFileSync(summaryPath, "utf-8")
      .split("\n")
      .filter((line) => line.startsWith("### "));
    assert.deepEqual(headings, [
      "### github.com/test-org/test-repo",
      "### ghe.corp/test-org/test-repo",
      "### test-org/other-repo",
    ]);
  });

  test("qualifies repos whose owner/repo differs only in case across hosts", async () => {
    writeFileSync(
      testConfigPath,
      PLAN_CONFIG.replace(
        "repos:\n  - git: https://github.com/test-org/test-repo\n",
        `githubHosts:
  - ghe.corp
repos:
  - git: https://github.com/Test-Org/test-repo
  - git: https://ghe.corp/test-org/test-repo
`
      )
    );
    const summaryPath = join(testDir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir, dryRun: true },
      { processorFactory: () => createRealProcessor() }
    );

    const output = consoleOutput.join("\n");
    assert.match(output, /^\[1\/2\] ✓ github\.com\/Test-Org\/test-repo: /m);
    assert.match(output, /^\[2\/2\] ✓ ghe\.corp\/test-org\/test-repo: /m);

    const headings = readFileSync(summaryPath, "utf-8")
      .split("\n")
      .filter((line) => line.startsWith("### "));
    assert.deepEqual(headings, [
      "### github.com/Test-Org/test-repo",
      "### ghe.corp/test-org/test-repo",
    ]);
  });

  test("labels an unparseable git URL with the raw value and keeps going", async () => {
    writeFileSync(
      testConfigPath,
      PLAN_CONFIG.replace(
        "repos:\n  - git: https://github.com/test-org/test-repo\n",
        `repos:
  - git: not-a-url
  - git: https://github.com/test-org/test-repo
`
      )
    );
    const summaryPath = join(testDir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    await assert.rejects(
      runSecretsSync(
        { config: testConfigPath, workDir: testDir, dryRun: true },
        { processorFactory: () => createRealProcessor() }
      ),
      /One or more repositories failed secrets sync/
    );

    const output = consoleOutput.join("\n");
    assert.match(
      output,
      /^\[1\/2\] ✗ not-a-url: Secrets: Unrecognized git URL format/m
    );
    assert.match(output, /^\[2\/2\] ✓ test-org\/test-repo: /m);

    const headings = readFileSync(summaryPath, "utf-8")
      .split("\n")
      .filter((line) => line.startsWith("### "));
    assert.deepEqual(headings, ["### not-a-url", "### test-org/test-repo"]);
  });

  test("does not host-qualify repos without a host that share a name", async () => {
    writeFileSync(
      testConfigPath,
      PLAN_CONFIG.replace(
        "repos:\n  - git: https://github.com/test-org/test-repo\n",
        `repos:
  - git: https://dev.azure.com/org/proj/_git/app
  - git: https://dev.azure.com/org/proj/_git/app
`
      )
    );

    await runSecretsSync(
      { config: testConfigPath, workDir: testDir, dryRun: true },
      { processorFactory: () => createRealProcessor() }
    );

    const output = consoleOutput.join("\n");
    assert.match(output, /^\[1\/2\] ⊘ org\/proj\/app: Skipped - /m);
    assert.match(output, /^\[2\/2\] ⊘ org\/proj\/app: Skipped - /m);
  });

  test("records a failed repo in the step summary", async () => {
    writeFileSync(testConfigPath, PLAN_CONFIG);
    const summaryPath = join(testDir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    await assert.rejects(
      runSecretsSync(
        { config: testConfigPath, workDir: testDir },
        {
          processorFactory: () =>
            createThrowingProcessor(new Error("API rate limit exceeded")),
        }
      )
    );

    const summary = readFileSync(summaryPath, "utf-8");
    assert.ok(summary.includes("### test-org/test-repo"), summary);
    assert.ok(summary.includes("API rate limit exceeded"), summary);
  });
});
