import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { getPRStrategy } from "../../../src/vcs/pr-strategy-factory.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import type { AzureDevOpsRepoInfo } from "../../../src/shared/repo-detector.js";
import type { GitLabRepoInfo } from "../../../src/shared/repo-detector.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";

const mockExecutor: ICommandExecutor = { exec: async () => "" };

describe("getPRStrategy", () => {
  test("returns GitHubPRStrategy for GitHub repos", () => {
    const repoInfo: GitHubRepoInfo = {
      type: "github",
      gitUrl: "git@github.com:test/repo.git",
      owner: "test",
      repo: "repo",
      host: "github.com",
    };
    const strategy = getPRStrategy(repoInfo, mockExecutor);
    assert.ok(strategy);
  });

  test("returns AzurePRStrategy for Azure DevOps repos", () => {
    const repoInfo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      gitUrl: "git@ssh.dev.azure.com:test/repo.git",
      owner: "org",
      organization: "org",
      project: "proj",
      repo: "repo",
    };
    const strategy = getPRStrategy(repoInfo, mockExecutor);
    assert.ok(strategy);
  });

  test("returns GitLabPRStrategy for GitLab repos", () => {
    const repoInfo: GitLabRepoInfo = {
      type: "gitlab",
      gitUrl: "git@gitlab.com:test/repo.git",
      owner: "test",
      namespace: "test",
      repo: "repo",
      host: "gitlab.com",
    };
    const strategy = getPRStrategy(repoInfo, mockExecutor);
    assert.ok(strategy);
  });

  test("throws for unknown repository type", () => {
    const unknownRepo = {
      type: "bitbucket",
      gitUrl: "git@bitbucket.org:test/repo.git",
    } as never;

    assert.throws(
      () => getPRStrategy(unknownRepo, mockExecutor),
      /Unknown repository type/
    );
  });
});
