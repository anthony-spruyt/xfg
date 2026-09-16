import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  isGitHubRepo,
  isAzureDevOpsRepo,
  isGitLabRepo,
  assertGitHubRepo,
  assertAzureDevOpsRepo,
  assertGitLabRepo,
  getRepoDisplayName,
} from "../../../src/repo/utils.js";
import { ValidationError } from "../../../src/shared/errors.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  GitLabRepoInfo,
} from "../../../src/repo/types.js";

const github: GitHubRepoInfo = {
  type: "github",
  gitUrl: "git@github.com:owner/repo.git",
  owner: "owner",
  repo: "repo",
  host: "github.com",
};

const azure: AzureDevOpsRepoInfo = {
  type: "azure-devops",
  gitUrl: "git@ssh.dev.azure.com:v3/org/proj/repo",
  owner: "org",
  repo: "repo",
  organization: "org",
  project: "proj",
};

const gitlab: GitLabRepoInfo = {
  type: "gitlab",
  gitUrl: "git@gitlab.com:ns/repo.git",
  owner: "ns",
  namespace: "ns",
  repo: "repo",
  host: "gitlab.com",
};

describe("type guards", () => {
  test("isGitHubRepo", () => {
    assert.ok(isGitHubRepo(github));
    assert.ok(!isGitHubRepo(azure));
    assert.ok(!isGitHubRepo(gitlab));
  });

  test("isAzureDevOpsRepo", () => {
    assert.ok(isAzureDevOpsRepo(azure));
    assert.ok(!isAzureDevOpsRepo(github));
  });

  test("isGitLabRepo", () => {
    assert.ok(isGitLabRepo(gitlab));
    assert.ok(!isGitLabRepo(github));
  });
});

describe("assert functions", () => {
  test("assertGitHubRepo passes for GitHub", () => {
    assert.doesNotThrow(() => assertGitHubRepo(github, "test"));
  });

  test("assertGitHubRepo throws for non-GitHub", () => {
    assert.throws(
      () => assertGitHubRepo(azure, "test"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("assertAzureDevOpsRepo passes for Azure", () => {
    assert.doesNotThrow(() => assertAzureDevOpsRepo(azure, "test"));
  });

  test("assertAzureDevOpsRepo throws for non-Azure", () => {
    assert.throws(
      () => assertAzureDevOpsRepo(github, "test"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("assertGitLabRepo passes for GitLab", () => {
    assert.doesNotThrow(() => assertGitLabRepo(gitlab, "test"));
  });

  test("assertGitLabRepo throws for non-GitLab", () => {
    assert.throws(
      () => assertGitLabRepo(github, "test"),
      (err: unknown) => err instanceof ValidationError
    );
  });
});

describe("getRepoDisplayName", () => {
  test("GitHub: owner/repo", () => {
    assert.equal(getRepoDisplayName(github), "owner/repo");
  });

  test("Azure: org/project/repo", () => {
    assert.equal(getRepoDisplayName(azure), "org/proj/repo");
  });

  test("GitLab: namespace/repo", () => {
    assert.equal(getRepoDisplayName(gitlab), "ns/repo");
  });
});
