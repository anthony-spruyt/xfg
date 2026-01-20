import { describe, test } from "node:test";
import assert from "node:assert";
import { getPRStrategy } from "./index.js";
import { GitHubPRStrategy } from "./github-pr-strategy.js";
import { AzurePRStrategy } from "./azure-pr-strategy.js";
import { GitLabPRStrategy } from "./gitlab-pr-strategy.js";
import {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  GitLabRepoInfo,
} from "../repo-detector.js";
import {
  PRStrategyOptions,
  PRStrategy,
  PRWorkflowExecutor,
} from "./pr-strategy.js";
import { PRResult } from "../pr-creator.js";

describe("getPRStrategy", () => {
  test("returns GitHubPRStrategy for GitHub repos", () => {
    const repoInfo: GitHubRepoInfo = {
      type: "github",
      gitUrl: "git@github.com:owner/repo.git",
      owner: "owner",
      repo: "repo",
    };

    const strategy = getPRStrategy(repoInfo);
    assert.ok(strategy instanceof GitHubPRStrategy);
  });

  test("returns AzurePRStrategy for Azure DevOps repos", () => {
    const repoInfo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      gitUrl: "git@ssh.dev.azure.com:v3/org/project/repo",
      owner: "org",
      repo: "repo",
      organization: "org",
      project: "project",
    };

    const strategy = getPRStrategy(repoInfo);
    assert.ok(strategy instanceof AzurePRStrategy);
  });

  test("returns GitLabPRStrategy for GitLab repos", () => {
    const repoInfo: GitLabRepoInfo = {
      type: "gitlab",
      gitUrl: "git@gitlab.com:owner/repo.git",
      owner: "owner",
      namespace: "owner",
      repo: "repo",
      host: "gitlab.com",
    };

    const strategy = getPRStrategy(repoInfo);
    assert.ok(strategy instanceof GitLabPRStrategy);
  });

  test("returns GitLabPRStrategy for GitLab nested group repos", () => {
    const repoInfo: GitLabRepoInfo = {
      type: "gitlab",
      gitUrl: "git@gitlab.com:org/group/subgroup/repo.git",
      owner: "org",
      namespace: "org/group/subgroup",
      repo: "repo",
      host: "gitlab.com",
    };

    const strategy = getPRStrategy(repoInfo);
    assert.ok(strategy instanceof GitLabPRStrategy);
  });
});

describe("GitHubPRStrategy type guards", () => {
  test("checkExistingPR throws for non-GitHub repo", async () => {
    const strategy = new GitHubPRStrategy();
    const azureRepoInfo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      gitUrl: "git@ssh.dev.azure.com:v3/org/project/repo",
      owner: "org",
      repo: "repo",
      organization: "org",
      project: "project",
    };

    const options: PRStrategyOptions = {
      repoInfo: azureRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: "/tmp/test",
    };

    await assert.rejects(
      () => strategy.checkExistingPR(options),
      /Expected GitHub repository/,
    );
  });

  test("create throws for non-GitHub repo", async () => {
    const strategy = new GitHubPRStrategy();
    const azureRepoInfo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      gitUrl: "git@ssh.dev.azure.com:v3/org/project/repo",
      owner: "org",
      repo: "repo",
      organization: "org",
      project: "project",
    };

    const options: PRStrategyOptions = {
      repoInfo: azureRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: "/tmp/test",
    };

    await assert.rejects(
      () => strategy.create(options),
      /Expected GitHub repository/,
    );
  });
});

describe("AzurePRStrategy type guards", () => {
  test("checkExistingPR throws for non-Azure repo", async () => {
    const strategy = new AzurePRStrategy();
    const githubRepoInfo: GitHubRepoInfo = {
      type: "github",
      gitUrl: "git@github.com:owner/repo.git",
      owner: "owner",
      repo: "repo",
    };

    const options: PRStrategyOptions = {
      repoInfo: githubRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: "/tmp/test",
    };

    await assert.rejects(
      () => strategy.checkExistingPR(options),
      /Expected Azure DevOps repository/,
    );
  });

  test("create throws for non-Azure repo", async () => {
    const strategy = new AzurePRStrategy();
    const githubRepoInfo: GitHubRepoInfo = {
      type: "github",
      gitUrl: "git@github.com:owner/repo.git",
      owner: "owner",
      repo: "repo",
    };

    const options: PRStrategyOptions = {
      repoInfo: githubRepoInfo,
      title: "Test PR",
      body: "Test body",
      branchName: "test-branch",
      baseBranch: "main",
      workDir: "/tmp/test",
    };

    await assert.rejects(
      () => strategy.create(options),
      /Expected Azure DevOps repository/,
    );
  });
});

// Mock strategy for testing PRWorkflowExecutor
class MockPRStrategy implements PRStrategy {
  checkExistingPRResult: string | null = null;
  createResult: PRResult = {
    success: true,
    url: "https://example.com/pr/1",
    message: "PR created",
  };
  checkExistingPRCalled = false;
  createCalled = false;
  shouldThrowOnCheck = false;
  shouldThrowOnCreate = false;
  throwMessage = "Mock error";

  async checkExistingPR(_options: PRStrategyOptions): Promise<string | null> {
    this.checkExistingPRCalled = true;
    if (this.shouldThrowOnCheck) {
      throw new Error(this.throwMessage);
    }
    return this.checkExistingPRResult;
  }

  async create(_options: PRStrategyOptions): Promise<PRResult> {
    this.createCalled = true;
    if (this.shouldThrowOnCreate) {
      throw new Error(this.throwMessage);
    }
    return this.createResult;
  }

  async execute(options: PRStrategyOptions): Promise<PRResult> {
    const executor = new PRWorkflowExecutor(this);
    return executor.execute(options);
  }
}

describe("PRWorkflowExecutor", () => {
  const githubRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
  };

  const defaultOptions: PRStrategyOptions = {
    repoInfo: githubRepoInfo,
    title: "Test PR",
    body: "Test body",
    branchName: "test-branch",
    baseBranch: "main",
    workDir: "/tmp/test",
  };

  test("delegates to strategy.checkExistingPR", async () => {
    const mockStrategy = new MockPRStrategy();
    const executor = new PRWorkflowExecutor(mockStrategy);

    await executor.execute(defaultOptions);

    assert.equal(mockStrategy.checkExistingPRCalled, true);
  });

  test("returns existing PR if found without calling create", async () => {
    const mockStrategy = new MockPRStrategy();
    mockStrategy.checkExistingPRResult = "https://example.com/pr/existing";
    const executor = new PRWorkflowExecutor(mockStrategy);

    const result = await executor.execute(defaultOptions);

    assert.equal(result.success, true);
    assert.equal(result.url, "https://example.com/pr/existing");
    assert.ok(result.message.includes("already exists"));
    assert.equal(mockStrategy.checkExistingPRCalled, true);
    assert.equal(mockStrategy.createCalled, false);
  });

  test("delegates to strategy.create when no existing PR", async () => {
    const mockStrategy = new MockPRStrategy();
    mockStrategy.checkExistingPRResult = null;
    mockStrategy.createResult = {
      success: true,
      url: "https://example.com/pr/new",
      message: "PR created",
    };
    const executor = new PRWorkflowExecutor(mockStrategy);

    const result = await executor.execute(defaultOptions);

    assert.equal(result.success, true);
    assert.equal(result.url, "https://example.com/pr/new");
    assert.equal(mockStrategy.checkExistingPRCalled, true);
    assert.equal(mockStrategy.createCalled, true);
  });

  test("handles errors from checkExistingPR and returns failure", async () => {
    const mockStrategy = new MockPRStrategy();
    mockStrategy.shouldThrowOnCheck = true;
    mockStrategy.throwMessage = "Network timeout";
    const executor = new PRWorkflowExecutor(mockStrategy);

    const result = await executor.execute(defaultOptions);

    assert.equal(result.success, false);
    assert.ok(result.message.includes("Failed to create PR"));
    assert.ok(result.message.includes("Network timeout"));
  });

  test("handles errors from create and returns failure", async () => {
    const mockStrategy = new MockPRStrategy();
    mockStrategy.checkExistingPRResult = null;
    mockStrategy.shouldThrowOnCreate = true;
    mockStrategy.throwMessage = "API rate limit exceeded";
    const executor = new PRWorkflowExecutor(mockStrategy);

    const result = await executor.execute(defaultOptions);

    assert.equal(result.success, false);
    assert.ok(result.message.includes("Failed to create PR"));
    assert.ok(result.message.includes("API rate limit exceeded"));
  });

  test("handles non-Error throws", async () => {
    const mockStrategy = new MockPRStrategy();
    // Override checkExistingPR to throw a string
    mockStrategy.checkExistingPR = async () => {
      throw "string error";
    };
    const executor = new PRWorkflowExecutor(mockStrategy);

    const result = await executor.execute(defaultOptions);

    assert.equal(result.success, false);
    assert.ok(result.message.includes("string error"));
  });
});
