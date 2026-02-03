import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  getCommitStrategy,
  hasGitHubAppCredentials,
} from "../../../src/strategies/commit-strategy-selector.js";
import { GitCommitStrategy } from "../../../src/strategies/git-commit-strategy.js";
import { GraphQLCommitStrategy } from "../../../src/strategies/graphql-commit-strategy.js";
import {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  GitLabRepoInfo,
} from "../../../src/repo-detector.js";

describe("hasGitHubAppCredentials", () => {
  let originalAppId: string | undefined;
  let originalPrivateKey: string | undefined;

  beforeEach(() => {
    originalAppId = process.env.XFG_GITHUB_APP_ID;
    originalPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;
    delete process.env.XFG_GITHUB_APP_ID;
    delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
  });

  afterEach(() => {
    if (originalAppId !== undefined) {
      process.env.XFG_GITHUB_APP_ID = originalAppId;
    } else {
      delete process.env.XFG_GITHUB_APP_ID;
    }
    if (originalPrivateKey !== undefined) {
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
    } else {
      delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
    }
  });

  test("returns true when both XFG_GITHUB_APP_ID and XFG_GITHUB_APP_PRIVATE_KEY are set", () => {
    process.env.XFG_GITHUB_APP_ID = "12345";
    process.env.XFG_GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----";

    assert.equal(hasGitHubAppCredentials(), true);
  });

  test("returns false when only XFG_GITHUB_APP_ID is set", () => {
    process.env.XFG_GITHUB_APP_ID = "12345";

    assert.equal(hasGitHubAppCredentials(), false);
  });

  test("returns false when only XFG_GITHUB_APP_PRIVATE_KEY is set", () => {
    process.env.XFG_GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----";

    assert.equal(hasGitHubAppCredentials(), false);
  });

  test("returns false when neither env var is set", () => {
    assert.equal(hasGitHubAppCredentials(), false);
  });
});

describe("getCommitStrategy", () => {
  // Save original env vars
  let originalGhToken: string | undefined;
  let originalAppId: string | undefined;
  let originalPrivateKey: string | undefined;

  beforeEach(() => {
    // Save original values
    originalGhToken = process.env.GH_TOKEN;
    originalAppId = process.env.XFG_GITHUB_APP_ID;
    originalPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;

    // Clear environment variables
    delete process.env.GH_TOKEN;
    delete process.env.XFG_GITHUB_APP_ID;
    delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
  });

  afterEach(() => {
    // Restore original values
    if (originalGhToken !== undefined) {
      process.env.GH_TOKEN = originalGhToken;
    } else {
      delete process.env.GH_TOKEN;
    }

    if (originalAppId !== undefined) {
      process.env.XFG_GITHUB_APP_ID = originalAppId;
    } else {
      delete process.env.XFG_GITHUB_APP_ID;
    }

    if (originalPrivateKey !== undefined) {
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
    } else {
      delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
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

  test("returns GraphQLCommitStrategy for GitHub with GitHub App credentials", () => {
    process.env.XFG_GITHUB_APP_ID = "12345";
    process.env.XFG_GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----";

    const strategy = getCommitStrategy(githubRepoInfo);

    assert.ok(
      strategy instanceof GraphQLCommitStrategy,
      "Should return GraphQLCommitStrategy when GitHub App credentials are set"
    );
  });

  test("GitHub App credentials take precedence over GH_TOKEN", () => {
    process.env.GH_TOKEN = "ghp_test_token";
    process.env.XFG_GITHUB_APP_ID = "12345";
    process.env.XFG_GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----";

    const strategy = getCommitStrategy(githubRepoInfo);

    assert.ok(
      strategy instanceof GraphQLCommitStrategy,
      "Should return GraphQLCommitStrategy when both GitHub App and GH_TOKEN are set"
    );
  });

  test("returns GitCommitStrategy for Azure DevOps (ignores GitHub App credentials)", () => {
    process.env.XFG_GITHUB_APP_ID = "12345";
    process.env.XFG_GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----";

    const strategy = getCommitStrategy(azureRepoInfo);

    assert.ok(
      strategy instanceof GitCommitStrategy,
      "Should return GitCommitStrategy for Azure DevOps regardless of GitHub App credentials"
    );
  });

  test("returns GitCommitStrategy for GitLab (ignores GitHub App credentials)", () => {
    process.env.XFG_GITHUB_APP_ID = "12345";
    process.env.XFG_GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----";

    const strategy = getCommitStrategy(gitlabRepoInfo);

    assert.ok(
      strategy instanceof GitCommitStrategy,
      "Should return GitCommitStrategy for GitLab regardless of GitHub App credentials"
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
