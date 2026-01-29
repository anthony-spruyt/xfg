import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { getCommitStrategy } from "./commit-strategy-selector.js";
import { GitCommitStrategy } from "./git-commit-strategy.js";
import { GraphQLCommitStrategy } from "./graphql-commit-strategy.js";
import {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  GitLabRepoInfo,
} from "../repo-detector.js";

describe("getCommitStrategy", () => {
  // Save original env vars
  let originalGhToken: string | undefined;
  let originalGhInstallationToken: string | undefined;

  beforeEach(() => {
    // Save original values
    originalGhToken = process.env.GH_TOKEN;
    originalGhInstallationToken = process.env.GH_INSTALLATION_TOKEN;

    // Clear environment variables
    delete process.env.GH_TOKEN;
    delete process.env.GH_INSTALLATION_TOKEN;
  });

  afterEach(() => {
    // Restore original values
    if (originalGhToken !== undefined) {
      process.env.GH_TOKEN = originalGhToken;
    } else {
      delete process.env.GH_TOKEN;
    }

    if (originalGhInstallationToken !== undefined) {
      process.env.GH_INSTALLATION_TOKEN = originalGhInstallationToken;
    } else {
      delete process.env.GH_INSTALLATION_TOKEN;
    }
  });

  const githubRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
    host: "github.com",
  };

  const azureRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "git@ssh.dev.azure.com:v3/org/project/repo",
    owner: "org",
    repo: "repo",
    organization: "org",
    project: "project",
  };

  const gitlabRepoInfo: GitLabRepoInfo = {
    type: "gitlab",
    gitUrl: "git@gitlab.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
    namespace: "owner",
    host: "gitlab.com",
  };

  test("returns GitCommitStrategy for GitHub with GH_TOKEN", () => {
    process.env.GH_TOKEN = "ghp_test_token";

    const strategy = getCommitStrategy(githubRepoInfo);

    assert.ok(
      strategy instanceof GitCommitStrategy,
      "Should return GitCommitStrategy when only GH_TOKEN is set"
    );
  });

  test("returns GraphQLCommitStrategy for GitHub with GH_INSTALLATION_TOKEN", () => {
    process.env.GH_INSTALLATION_TOKEN = "ghs_installation_token";

    const strategy = getCommitStrategy(githubRepoInfo);

    assert.ok(
      strategy instanceof GraphQLCommitStrategy,
      "Should return GraphQLCommitStrategy when GH_INSTALLATION_TOKEN is set"
    );
  });

  test("GH_INSTALLATION_TOKEN takes precedence over GH_TOKEN", () => {
    process.env.GH_TOKEN = "ghp_test_token";
    process.env.GH_INSTALLATION_TOKEN = "ghs_installation_token";

    const strategy = getCommitStrategy(githubRepoInfo);

    assert.ok(
      strategy instanceof GraphQLCommitStrategy,
      "Should return GraphQLCommitStrategy when both tokens are set"
    );
  });

  test("returns GitCommitStrategy for Azure DevOps (ignores GH_INSTALLATION_TOKEN)", () => {
    process.env.GH_INSTALLATION_TOKEN = "ghs_installation_token";

    const strategy = getCommitStrategy(azureRepoInfo);

    assert.ok(
      strategy instanceof GitCommitStrategy,
      "Should return GitCommitStrategy for Azure DevOps regardless of GH_INSTALLATION_TOKEN"
    );
  });

  test("returns GitCommitStrategy for GitLab (ignores GH_INSTALLATION_TOKEN)", () => {
    process.env.GH_INSTALLATION_TOKEN = "ghs_installation_token";

    const strategy = getCommitStrategy(gitlabRepoInfo);

    assert.ok(
      strategy instanceof GitCommitStrategy,
      "Should return GitCommitStrategy for GitLab regardless of GH_INSTALLATION_TOKEN"
    );
  });

  test("accepts optional executor parameter", () => {
    const mockExecutor = {
      exec: async () => "",
    };

    const strategy = getCommitStrategy(githubRepoInfo, mockExecutor);

    assert.ok(
      strategy instanceof GitCommitStrategy,
      "Should create strategy with custom executor"
    );
  });
});
