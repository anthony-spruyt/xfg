import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  createCommitStrategy,
  createTokenManager,
} from "../../../src/vcs/commit-strategy-selector.js";
import { GitCommitStrategy } from "../../../src/vcs/git-commit-strategy.js";
import { FileModeFixupCommitStrategy } from "../../../src/vcs/file-mode-fixup-commit-strategy.js";
import {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  GitLabRepoInfo,
} from "../../../src/repo/detector.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";

const mockExecutor: ICommandExecutor = { exec: async () => "" };

describe("createTokenManager", () => {
  test("returns null when no credentials provided", () => {
    assert.equal(createTokenManager(), null);
    assert.equal(createTokenManager(undefined), null);
  });

  test("returns token manager when credentials provided", () => {
    const manager = createTokenManager({
      clientId: "12345",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----",
    });

    assert.ok(manager !== null, "Should return a token manager");
  });
});

describe("createCommitStrategy", () => {
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

  test("returns GitCommitStrategy for GitHub without app credentials", () => {
    const strategy = createCommitStrategy(githubRepoInfo, mockExecutor);

    assert.ok(
      strategy instanceof GitCommitStrategy,
      "Should return GitCommitStrategy when no app credentials"
    );
  });

  test("returns FileModeFixupCommitStrategy for GitHub with app credentials", () => {
    const strategy = createCommitStrategy(githubRepoInfo, mockExecutor, true);

    assert.ok(
      strategy instanceof FileModeFixupCommitStrategy,
      "Should return FileModeFixupCommitStrategy when hasAppCredentials is true"
    );
  });

  test("returns GitCommitStrategy for Azure DevOps (ignores app credentials)", () => {
    const strategy = createCommitStrategy(azureRepoInfo, mockExecutor, true);

    assert.ok(
      strategy instanceof GitCommitStrategy,
      "Should return GitCommitStrategy for Azure DevOps regardless of app credentials"
    );
  });

  test("returns GitCommitStrategy for GitLab (ignores app credentials)", () => {
    const strategy = createCommitStrategy(gitlabRepoInfo, mockExecutor, true);

    assert.ok(
      strategy instanceof GitCommitStrategy,
      "Should return GitCommitStrategy for GitLab regardless of app credentials"
    );
  });

  test("accepts optional executor parameter", () => {
    const mockExecutor = {
      exec: async () => "",
    };

    const strategy = createCommitStrategy(githubRepoInfo, mockExecutor);

    assert.ok(
      strategy instanceof GitCommitStrategy,
      "Should create strategy with custom executor"
    );
  });
});
