import { describe, test } from "node:test";
import assert from "node:assert";
import { getPRStrategy } from "./index.js";
import { GitHubPRStrategy } from "./github-pr-strategy.js";
import { AzurePRStrategy } from "./azure-pr-strategy.js";
import { GitHubRepoInfo, AzureDevOpsRepoInfo } from "../repo-detector.js";
import { PRStrategyOptions } from "./pr-strategy.js";

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
