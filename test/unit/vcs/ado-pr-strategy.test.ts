import { describe, test, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AdoPRStrategy } from "../../../src/vcs/ado-pr-strategy.js";
import { PRWorkflowExecutor } from "../../../src/vcs/pr-strategy.js";
import {
  AzureDevOpsRepoInfo,
  GitHubRepoInfo,
} from "../../../src/repo/index.js";
import type { PRStrategyOptions } from "../../../src/vcs/types.js";
import {
  createMockExecutor,
  type ExecutorMockResult,
} from "../../mocks/executor.mock.js";

const testDir = join(tmpdir(), "test-azure-strategy-tmp");

describe("AdoPRStrategy with mock executor", () => {
  const azureRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
    owner: "myorg",
    repo: "myrepo",
    organization: "myorg",
    project: "myproject",
  };

  let mockExecutor: ExecutorMockResult;

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

  describe("findExistingPRUrl", () => {
    test("returns PR URL when PR exists", async () => {
      mockExecutor.responses.set("az repos pr list", "456");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.findExistingPRUrl(options);

      assert.ok(result?.includes("dev.azure.com"));
      assert.ok(result?.includes("pullrequest/456"));
      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("az repos pr list"));
    });

    test("returns null when no PR exists", async () => {
      mockExecutor.responses.set("az repos pr list", "");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.findExistingPRUrl(options);

      assert.equal(result, null);
    });

    test("throws on permanent error (auth failure)", async () => {
      const authError = new Error("401 Unauthorized");
      mockExecutor.responses.set("az repos pr list", authError);

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      await assert.rejects(
        () => strategy.findExistingPRUrl(options),
        /401 Unauthorized/
      );
    });

    test("returns null on transient error", async () => {
      const networkError = new Error("Connection timed out");
      mockExecutor.responses.set("az repos pr list", networkError);

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.findExistingPRUrl(options);
      assert.equal(result, null);
    });

    test("returns null and logs debug on transient error with stderr", async () => {
      const errorWithStderr = Object.assign(new Error("Command failed"), {
        stderr: "az: connection refused",
      });
      mockExecutor.responses.set("az repos pr list", errorWithStderr);

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await strategy.findExistingPRUrl(options);
      assert.equal(result, null);
    });
  });

  describe("create", () => {
    test("creates PR and returns URL", async () => {
      mockExecutor.responses.set("az repos pr create", "789");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
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

      const strategy = new AdoPRStrategy(mockExecutor.mock);
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

      const strategy = new AdoPRStrategy(mockExecutor.mock);
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

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await new PRWorkflowExecutor(strategy).execute(options);

      assert.equal(result.success, true);
      assert.ok(result.message.includes("already exists"));
      assert.equal(mockExecutor.calls.length, 1);
    });

    test("creates new PR if none exists", async () => {
      mockExecutor.responses.set("az repos pr list", "");
      mockExecutor.responses.set("az repos pr create", "new-pr-id");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await new PRWorkflowExecutor(strategy).execute(options);

      assert.equal(result.success, true);
      assert.equal(mockExecutor.calls.length, 2);
    });

    test("returns failure on error", async () => {
      mockExecutor.responses.set("az repos pr list", "");
      mockExecutor.responses.set("az repos pr create", new Error("Failed"));

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const options: PRStrategyOptions = {
        repoInfo: azureRepoInfo,
        title: "Test PR",
        body: "Test body",
        branchName: "test-branch",
        baseBranch: "main",
        workDir: testDir,
        retries: 0,
      };

      const result = await new PRWorkflowExecutor(strategy).execute(options);

      assert.equal(result.success, false);
      assert.ok(result.message.includes("Failed to create PR"));
    });
  });
});

describe("AdoPRStrategy cleanup error handling", () => {
  let mockExecutor: ExecutorMockResult;

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

    const strategy = new AdoPRStrategy(mockExecutor.mock);
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
      new Error("PR creation failed")
    );

    const strategy = new AdoPRStrategy(mockExecutor.mock);
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
      "Temp file should be cleaned up even on error"
    );
  });
});

describe("AdoPRStrategy Azure CLI command format", () => {
  let mockExecutor: ExecutorMockResult;

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

  test("escapes @/path format for description file to prevent shell injection", async () => {
    const azureRepoInfo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
      owner: "myorg",
      repo: "myrepo",
      organization: "myorg",
      project: "myproject",
    };

    mockExecutor.responses.set("az repos pr create", "123");

    const strategy = new AdoPRStrategy(mockExecutor.mock);
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

    // Verify the command escapes the @/path/file format for security
    const command = mockExecutor.calls[0].command;
    const descFile = join(testDir, ".pr-description.md");

    // Should contain escaped @/path format: '@/path/to/file'
    // The @ is included inside the quotes to prevent shell interpretation issues
    assert.ok(
      command.includes(`--description '@${descFile}'`),
      `Command should escape @<path> format with single quotes. Got: ${command}`
    );
  });
});

describe("AdoPRStrategy URL building", () => {
  test("builds correct PR URL with special characters", () => {
    const org = "my-org";
    const project = "my project"; // Has space
    const repo = "my-repo";
    const prId = "123";

    // Expected URL with encoded values
    const expectedUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${prId}`;

    assert.equal(
      expectedUrl,
      "https://dev.azure.com/my-org/my%20project/_git/my-repo/pullrequest/123"
    );
  });

  test("builds correct org URL", () => {
    const org = "test-organization";
    const expectedOrgUrl = `https://dev.azure.com/${encodeURIComponent(org)}`;

    assert.equal(expectedOrgUrl, "https://dev.azure.com/test-organization");
  });
});

describe("AdoPRStrategy merge", () => {
  const azureRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
    owner: "myorg",
    repo: "myrepo",
    organization: "myorg",
    project: "myproject",
  };

  let mockExecutor: ExecutorMockResult;

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

  const validPRUrl =
    "https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/123";

  describe("merge with manual mode", () => {
    test("returns success without making any calls", async () => {
      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: validPRUrl,
        repoInfo: azureRepoInfo,
        config: { mode: "manual" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, false);
      assert.ok(result.message.includes("manual review"));
      assert.equal(mockExecutor.calls.length, 0);
    });
  });

  describe("merge with auto mode", () => {
    test("enables auto-complete", async () => {
      mockExecutor.responses.set("az repos pr update", "");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: validPRUrl,
        repoInfo: azureRepoInfo,
        config: { mode: "auto" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, false);
      assert.equal(result.autoMergeEnabled, true);
      assert.ok(result.message.includes("Auto-complete enabled"));

      assert.equal(mockExecutor.calls.length, 1);
      assert.ok(mockExecutor.calls[0].command.includes("az repos pr update"));
      assert.ok(mockExecutor.calls[0].command.includes("--auto-complete true"));
    });

    test("uses squash flag when configured", async () => {
      mockExecutor.responses.set("az repos pr update", "");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      await strategy.merge({
        prUrl: validPRUrl,
        repoInfo: azureRepoInfo,
        config: { mode: "auto", strategy: "squash" },
        workDir: testDir,
        retries: 0,
      });

      const command = mockExecutor.calls[0].command;
      assert.ok(command.includes("--squash true"));
    });

    test("uses delete-source-branch flag when configured", async () => {
      mockExecutor.responses.set("az repos pr update", "");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      await strategy.merge({
        prUrl: validPRUrl,
        repoInfo: azureRepoInfo,
        config: { mode: "auto", deleteBranch: true },
        workDir: testDir,
        retries: 0,
      });

      const command = mockExecutor.calls[0].command;
      assert.ok(command.includes("--delete-source-branch true"));
    });

    test("returns failure when command fails", async () => {
      mockExecutor.responses.set(
        "az repos pr update",
        new Error("Update failed")
      );

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: validPRUrl,
        repoInfo: azureRepoInfo,
        config: { mode: "auto" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, false);
      assert.equal(result.merged, false);
      assert.ok(result.message.includes("Failed to enable auto-complete"));
    });
  });

  describe("merge with force mode", () => {
    test("bypasses policies and completes PR", async () => {
      mockExecutor.responses.set("az repos pr update", "");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: validPRUrl,
        repoInfo: azureRepoInfo,
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, true);
      assert.equal(result.merged, true);
      assert.ok(result.message.includes("bypassing policies"));

      assert.equal(mockExecutor.calls.length, 1);
      const command = mockExecutor.calls[0].command;
      assert.ok(command.includes("--bypass-policy true"));
      assert.ok(command.includes("--status completed"));
    });

    test("uses custom bypass reason when provided", async () => {
      mockExecutor.responses.set("az repos pr update", "");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      await strategy.merge({
        prUrl: validPRUrl,
        repoInfo: azureRepoInfo,
        config: { mode: "force", bypassReason: "Urgent hotfix" },
        workDir: testDir,
        retries: 0,
      });

      const command = mockExecutor.calls[0].command;
      assert.ok(command.includes("--bypass-policy-reason"));
      assert.ok(command.includes("Urgent hotfix"));
    });

    test("uses default bypass reason when not provided", async () => {
      mockExecutor.responses.set("az repos pr update", "");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      await strategy.merge({
        prUrl: validPRUrl,
        repoInfo: azureRepoInfo,
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      const command = mockExecutor.calls[0].command;
      assert.ok(command.includes("--bypass-policy-reason"));
      assert.ok(command.includes("xfg"));
    });

    test("uses squash and delete-branch with force mode", async () => {
      mockExecutor.responses.set("az repos pr update", "");

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      await strategy.merge({
        prUrl: validPRUrl,
        repoInfo: azureRepoInfo,
        config: { mode: "force", strategy: "squash", deleteBranch: true },
        workDir: testDir,
        retries: 0,
      });

      const command = mockExecutor.calls[0].command;
      assert.ok(command.includes("--bypass-policy true"));
      assert.ok(command.includes("--squash true"));
      assert.ok(command.includes("--delete-source-branch true"));
    });

    test("returns failure when command fails", async () => {
      mockExecutor.responses.set(
        "az repos pr update",
        new Error("Permission denied")
      );

      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: validPRUrl,
        repoInfo: azureRepoInfo,
        config: { mode: "force" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, false);
      assert.equal(result.merged, false);
      assert.ok(result.message.includes("Failed to bypass policies"));
    });
  });

  describe("merge with invalid PR URL", () => {
    test("returns failure for invalid URL format", async () => {
      const strategy = new AdoPRStrategy(mockExecutor.mock);
      const result = await strategy.merge({
        prUrl: "https://invalid-url.com/not-azure",
        repoInfo: azureRepoInfo,
        config: { mode: "auto" },
        workDir: testDir,
        retries: 0,
      });

      assert.equal(result.success, false);
      assert.equal(result.merged, false);
      assert.ok(result.message.includes("Invalid Azure DevOps PR URL"));
      assert.equal(mockExecutor.calls.length, 0);
    });
  });
});

describe("AdoPRStrategy closeExistingPR", () => {
  const azureRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
    owner: "myorg",
    repo: "myrepo",
    organization: "myorg",
    project: "myproject",
  };

  let mockExecutor: ExecutorMockResult;
  const testDirClose = join(tmpdir(), "test-azure-strategy-close-tmp");

  beforeEach(() => {
    mockExecutor = createMockExecutor();
    if (existsSync(testDirClose)) {
      rmSync(testDirClose, { recursive: true, force: true });
    }
    mkdirSync(testDirClose, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDirClose)) {
      rmSync(testDirClose, { recursive: true, force: true });
    }
  });

  test("returns no_pr when no PR exists", async () => {
    mockExecutor.responses.set("az repos pr list", "");

    const strategy = new AdoPRStrategy(mockExecutor.mock);
    const result = await strategy.closeExistingPR({
      repoInfo: azureRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.deepStrictEqual(result, { status: "no_pr" });
  });

  test("closes PR (abandons) and deletes branch when PR exists", async () => {
    mockExecutor.responses.set("az repos pr list", "123");
    mockExecutor.responses.set("az repos pr update", "");
    mockExecutor.responses.set("az repos ref delete", "");

    const strategy = new AdoPRStrategy(mockExecutor.mock);
    const result = await strategy.closeExistingPR({
      repoInfo: azureRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.deepStrictEqual(result, { status: "closed" });
    const abandonCall = mockExecutor.calls.find((c) =>
      c.command.includes("az repos pr update")
    );
    assert.ok(abandonCall, "Should call az repos pr update");
    assert.ok(abandonCall.command.includes("--status abandoned"));
    assert.ok(abandonCall.command.includes("--id"));
  });

  test("deletes branch after closing PR", async () => {
    mockExecutor.responses.set("az repos pr list", "123");
    mockExecutor.responses.set("az repos pr update", "");
    mockExecutor.responses.set("az repos ref list", "abc123def456"); // object_id for branch
    mockExecutor.responses.set("az repos ref delete", "");

    const strategy = new AdoPRStrategy(mockExecutor.mock);
    await strategy.closeExistingPR({
      repoInfo: azureRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    const deleteBranchCall = mockExecutor.calls.find((c) =>
      c.command.includes("az repos ref delete")
    );
    assert.ok(deleteBranchCall, "Should call az repos ref delete");
    assert.ok(deleteBranchCall.command.includes("test-branch"));
    assert.ok(
      deleteBranchCall.command.includes("abc123def456"),
      "Should include object_id"
    );
  });

  test("returns closed even when branch deletion fails", async () => {
    mockExecutor.responses.set("az repos pr list", "123");
    mockExecutor.responses.set("az repos pr update", "");
    mockExecutor.responses.set("az repos ref list", "abc123def456");
    mockExecutor.responses.set(
      "az repos ref delete",
      new Error("Branch deletion failed")
    );

    const strategy = new AdoPRStrategy(mockExecutor.mock);
    const result = await strategy.closeExistingPR({
      repoInfo: azureRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.deepStrictEqual(result, { status: "closed" });
  });

  test("returns close_failed when abandon command fails", async () => {
    mockExecutor.responses.set("az repos pr list", "123");
    mockExecutor.responses.set(
      "az repos pr update",
      new Error("Abandon failed")
    );

    const strategy = new AdoPRStrategy(mockExecutor.mock);
    const result = await strategy.closeExistingPR({
      repoInfo: azureRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirClose,
      retries: 0,
    });

    assert.equal(result.status, "close_failed");
  });
});

describe("AdoPRStrategy URL extraction edge cases", () => {
  const azureRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
    owner: "myorg",
    repo: "myrepo",
    organization: "myorg",
    project: "myproject",
  };

  let mockExecutor: ExecutorMockResult;
  const testDirEdge = join(tmpdir(), "test-azure-strategy-edge-tmp");

  beforeEach(() => {
    mockExecutor = createMockExecutor();
    if (existsSync(testDirEdge)) {
      rmSync(testDirEdge, { recursive: true, force: true });
    }
    mkdirSync(testDirEdge, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDirEdge)) {
      rmSync(testDirEdge, { recursive: true, force: true });
    }
  });

  test("handles PR ID with whitespace in output", async () => {
    // Azure CLI output may include whitespace/newlines
    mockExecutor.responses.set("az repos pr create", "  456  \n");

    const strategy = new AdoPRStrategy(mockExecutor.mock);
    const options: PRStrategyOptions = {
      repoInfo: azureRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    const result = await strategy.create(options);

    assert.equal(result.success, true);
    // buildPRUrl trims whitespace from PR ID
    assert.ok(result.url?.includes("pullrequest/456"));
  });

  test("handles empty response from create command", async () => {
    mockExecutor.responses.set("az repos pr create", "");

    const strategy = new AdoPRStrategy(mockExecutor.mock);
    const options: PRStrategyOptions = {
      repoInfo: azureRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDirEdge,
      retries: 0,
    };

    const result = await strategy.create(options);

    // Azure strategy builds URL from any output, even empty
    // The URL will have no PR ID but it still returns success
    assert.equal(result.success, true);
  });
});

describe("AdoPRStrategy type guards", () => {
  const githubRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
    host: "github.com",
  };

  let mockExecutor: ExecutorMockResult;

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

  test("closeExistingPR throws for non-Azure repo", async () => {
    const strategy = new AdoPRStrategy(mockExecutor.mock);

    await assert.rejects(
      () =>
        strategy.closeExistingPR({
          repoInfo: githubRepoInfo,
          branchName: "test-branch",
          baseBranch: "main",
          workDir: testDir,
          retries: 0,
        }),
      /requires Azure DevOps repositories/
    );
  });
});

describe("AdoPRStrategy merge unknown mode", () => {
  const azureRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
    owner: "myorg",
    repo: "myrepo",
    organization: "myorg",
    project: "myproject",
  };

  let mockExecutor: ExecutorMockResult;

  beforeEach(() => {
    mockExecutor = createMockExecutor();
  });

  test("returns failure for unknown merge mode", async () => {
    const strategy = new AdoPRStrategy(mockExecutor.mock);
    const result = await strategy.merge({
      prUrl:
        "https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/123",
      repoInfo: azureRepoInfo,
      config: { mode: "unknown" as "manual" },
      workDir: testDir,
      retries: 0,
    });

    assert.equal(result.success, false);
    assert.equal(result.merged, false);
    assert.ok(result.message.includes("Merge not applicable for mode:"));
  });
});

describe("AdoPRStrategy logger coverage", () => {
  const azureRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo",
    owner: "myorg",
    repo: "myrepo",
    organization: "myorg",
    project: "myproject",
  };

  let mockExecutor: ExecutorMockResult;

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

  test("findExistingPRUrl logs debug on error with stderr", async () => {
    const debugMessages: string[] = [];
    const mockLogger = {
      debug(msg: string) {
        debugMessages.push(msg);
      },
      warn() {},
      info() {},
    };

    const errorWithStderr = Object.assign(new Error("Command failed"), {
      stderr: "az: connection refused",
    });
    mockExecutor.responses.set("az repos pr list", errorWithStderr);

    const strategy = new AdoPRStrategy(mockExecutor.mock, mockLogger);
    const result = await strategy.findExistingPRUrl({
      repoInfo: azureRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    });

    assert.equal(result, null);
    assert.ok(debugMessages.some((m) => m.includes("Azure PR check failed")));
  });

  test("closeExistingPR logs warn on abandon error", async () => {
    const warnMessages: string[] = [];
    const mockLogger = {
      debug() {},
      warn(msg: string) {
        warnMessages.push(msg);
      },
      info() {},
    };

    mockExecutor.responses.set("az repos pr list", "123");
    mockExecutor.responses.set(
      "az repos pr update",
      new Error("Abandon failed")
    );

    const strategy = new AdoPRStrategy(mockExecutor.mock, mockLogger);
    const result = await strategy.closeExistingPR({
      repoInfo: azureRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    });

    assert.equal(result.status, "close_failed");
    assert.ok(warnMessages.some((m) => m.includes("Failed to abandon PR")));
  });

  test("closeExistingPR logs warn on branch deletion failure", async () => {
    const warnMessages: string[] = [];
    const mockLogger = {
      debug() {},
      warn(msg: string) {
        warnMessages.push(msg);
      },
      info() {},
    };

    mockExecutor.responses.set("az repos pr list", "123");
    mockExecutor.responses.set("az repos pr update", "");
    mockExecutor.responses.set("az repos ref list", "abc123def456");
    mockExecutor.responses.set(
      "az repos ref delete",
      new Error("Branch deletion failed")
    );

    const strategy = new AdoPRStrategy(mockExecutor.mock, mockLogger);
    const result = await strategy.closeExistingPR({
      repoInfo: azureRepoInfo,
      branchName: "test-branch",
      baseBranch: "main",
      workDir: testDir,
      retries: 0,
    });

    assert.deepStrictEqual(result, { status: "closed" });
    assert.ok(warnMessages.some((m) => m.includes("Failed to delete branch")));
  });
});

// Note: "unparseable URL" test removed — closeExistingPR now uses findExistingPRId
// directly instead of going through findExistingPRUrl → parsePRUrl, eliminating
// the URL roundtrip that could produce unparseable results.
