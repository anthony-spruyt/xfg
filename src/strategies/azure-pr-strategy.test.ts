import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AzurePRStrategy } from "./azure-pr-strategy.js";
import { AzureDevOpsRepoInfo } from "../repo-detector.js";
import { PRStrategyOptions } from "./pr-strategy.js";
import { CommandExecutor } from "../command-executor.js";

const testDir = join(process.cwd(), "test-azure-strategy-tmp");

// Mock executor factory - creates CommandExecutor for testing
function createMockExecutor(): CommandExecutor & {
  calls: Array<{ command: string; cwd: string }>;
  responses: Map<string, string | Error>;
} {
  const state = {
    calls: [] as Array<{ command: string; cwd: string }>,
    responses: new Map<string, string | Error>(),
  };

  const executor: CommandExecutor = {
    exec: async (command: string, cwd: string): Promise<string> => {
      state.calls.push({ command, cwd });

      for (const [pattern, response] of state.responses) {
        if (command.includes(pattern)) {
          if (response instanceof Error) throw response;
          return response;
        }
      }
      return "";
    },
  };

  return Object.assign(executor, state);
}

describe("AzurePRStrategy with mock executor", () => {
  const azureRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
    owner: "myorg",
    repo: "myrepo",
    organization: "myorg",
    project: "myproject",
  };

  let mockExecutor: ReturnType<typeof createMockExecutor>;

  beforeEach(() => {
    mockExecutor = createMockExecutor();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("checkExistingPR", () => {
    test("returns PR URL when PR exists", async () => {
      mockExecutor.responses.set("az repos pr list", "456");

      const strategy = new AzurePRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.checkExistingPR(options);

      assert.ok(result?.includes("dev.azure.com"));
      assert.ok(result?.includes("pullrequest/456"));
      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("az repos pr list"));
    });

    test("returns null when no PR exists", async () => {
      mockExecutor.responses.set("az repos pr list", "");

      const strategy = new AzurePRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.checkExistingPR(options);

      assert.equal(result, null);
    });

    test("throws on permanent error (auth failure)", async () => {
      const authError = new Error("401 Unauthorized");
      mockExecutor.responses.set("az repos pr list", authError);

      const strategy = new AzurePRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await assert.rejects(() => strategy.checkExistingPR(options), /401/);
    });

    test("returns null on transient error", async () => {
      const networkError = new Error("Connection timed out");
      mockExecutor.responses.set("az repos pr list", networkError);

      const strategy = new AzurePRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.checkExistingPR(options);
      assert.equal(result, null);
    });
  });

  describe("create", () => {
    test("creates PR and returns URL", async () => {
      mockExecutor.responses.set("az repos pr create", "789");

      const strategy = new AzurePRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.create(options);

      assert.equal(result.success, true);
      assert.ok(result.url?.includes("dev.azure.com"));
      assert.ok(result.url?.includes("pullrequest/789"));
      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("az repos pr create"));
    });

    test("cleans up description file after success", async () => {
      mockExecutor.responses.set("az repos pr create", "123");

      const strategy = new AzurePRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await strategy.create(options);

      const descFile = join(testDir, ".pr-description.md");
      assert.equal(existsSync(descFile), false);
    });

    test("cleans up description file after error", async () => {
      mockExecutor.responses.set("az repos pr create", new Error("Failed"));

      const strategy = new AzurePRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await assert.rejects(() => strategy.create(options));

      const descFile = join(testDir, ".pr-description.md");
      assert.equal(existsSync(descFile), false);
    });
  });

  describe("execute (full workflow)", () => {
    test("returns existing PR if found", async () => {
      mockExecutor.responses.set("az repos pr list", "existing-pr-id");

      const strategy = new AzurePRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.execute(options);

      assert.equal(result.success, true);
      assert.ok(result.message.includes("already exists"));
      assert.equal(mockExecutor.calls.length, 1);
    });

    test("creates new PR if none exists", async () => {
      mockExecutor.responses.set("az repos pr list", "");
      mockExecutor.responses.set("az repos pr create", "new-pr-id");

      const strategy = new AzurePRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.execute(options);

      assert.equal(result.success, true);
      assert.equal(mockExecutor.calls.length, 2);
    });

    test("returns failure on error", async () => {
      mockExecutor.responses.set("az repos pr list", "");
      mockExecutor.responses.set("az repos pr create", new Error("Failed"));

      const strategy = new AzurePRStrategy(mockExecutor);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.execute(options);

      assert.equal(result.success, false);
      assert.ok(result.message.includes("Failed to create PR"));
    });
  });
});

describe("AzurePRStrategy cleanup error handling", () => {
  let mockExecutor: ReturnType<typeof createMockExecutor>;

  beforeEach(() => {
    mockExecutor = createMockExecutor();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("succeeds and cleans up temp file on success", async () => {
    const azureRepoInfo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
      owner: "myorg",
      repo: "myrepo",
      organization: "myorg",
      project: "myproject",
    };

    mockExecutor.responses.set("az repos pr create", "123");

    const strategy = new AzurePRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: azureRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    const result = await strategy.create(options);

    assert.equal(result.success, true);
    const descFile = join(testDir, ".pr-description.md");
    assert.equal(existsSync(descFile), false, "Temp file should be cleaned up");
  });

  test("cleans up temp file even when PR creation fails", async () => {
    const azureRepoInfo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
      owner: "myorg",
      repo: "myrepo",
      organization: "myorg",
      project: "myproject",
    };

    mockExecutor.responses.set(
      "az repos pr create",
      new Error("PR creation failed"),
    );

    const strategy = new AzurePRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: azureRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    await assert.rejects(() => strategy.create(options));

    const descFile = join(testDir, ".pr-description.md");
    assert.equal(
      existsSync(descFile),
      false,
      "Temp file should be cleaned up even on error",
    );
  });
});

describe("AzurePRStrategy Azure CLI command format", () => {
  let mockExecutor: ReturnType<typeof createMockExecutor>;

  beforeEach(() => {
    mockExecutor = createMockExecutor();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("uses @/path format for description file, not @'/path'", async () => {
    const azureRepoInfo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
      owner: "myorg",
      repo: "myrepo",
      organization: "myorg",
      project: "myproject",
    };

    mockExecutor.responses.set("az repos pr create", "123");

    const strategy = new AzurePRStrategy(mockExecutor);
    const options: PRStrategyOptions = {
      repoInfo: azureRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    };

    await strategy.create(options);

    // Verify the command uses @/path/file format, not @'/path/file'
    const command = mockExecutor.calls[0].command;
    const descFile = join(testDir, ".pr-description.md");

    // Should contain @/path directly without quotes around the path
    assert.ok(
      command.includes(`--description @${descFile}`),
      `Command should use @<path> format without escaping. Got: ${command}`,
    );

    // Should NOT contain @'/path' (escaped format)
    assert.ok(
      !command.includes(`@'${descFile}'`),
      `Command should NOT use @'<path>' format. Got: ${command}`,
    );
  });
});

describe("AzurePRStrategy URL building", () => {
  test("builds correct PR URL with special characters", () => {
    const org = "my-org";
    const project = "my project"; // Has space
    const repo = "my-repo";
    const prId = "123";

    // Expected URL with encoded values
    const expectedUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${prId}`;

    assert.equal(
      expectedUrl,
      "https://dev.azure.com/my-org/my%20project/_git/my-repo/pullrequest/123",
    );
  });

  test("builds correct org URL", () => {
    const org = "test-organization";
    const expectedOrgUrl = `https://dev.azure.com/${encodeURIComponent(org)}`;

    assert.equal(expectedOrgUrl, "https://dev.azure.com/test-organization");
  });
});
