import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import type { RepoConfig } from "../../src/config/index.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../src/shared/repo-detector.js";
import {
  withGitHubGuards,
  type BaseProcessorOptions,
  type BaseProcessorResult,
  formatChangeSummary,
} from "../../src/settings/base-processor.js";

// =============================================================================
// Test fixtures
// =============================================================================

interface TestResult extends BaseProcessorResult {
  data?: string;
}

const mockGitHubRepo: GitHubRepoInfo = {
  type: "github",
  owner: "test-org",
  repo: "test-repo",
  gitUrl: "git@github.com:test-org/test-repo.git",
  host: "github.com",
};

const mockAzureRepo: AzureDevOpsRepoInfo = {
  type: "azure-devops",
  owner: "test-org",
  organization: "test-org",
  project: "test-project",
  repo: "test-repo",
  gitUrl: "https://dev.azure.com/test-org/test-project/_git/test-repo",
};

const baseRepoConfig: RepoConfig = {
  git: "git@github.com:test-org/test-repo.git",
  files: [],
  settings: {},
};

function defaultGuards(overrides?: {
  hasSettings?: boolean;
  result?: TestResult;
  error?: Error;
}) {
  const calls: Array<{
    githubRepo: GitHubRepoInfo;
    effectiveToken: string | undefined;
  }> = [];

  const guards = {
    hasDesiredSettings: () => overrides?.hasSettings ?? true,
    emptySettingsMessage: "No test settings configured",
    processSettings: async (
      githubRepo: GitHubRepoInfo,
      _rc: RepoConfig,
      _opts: BaseProcessorOptions,
      effectiveToken: string | undefined,
      repoName: string
    ): Promise<TestResult> => {
      calls.push({ githubRepo, effectiveToken });
      if (overrides?.error) throw overrides.error;
      return (
        overrides?.result ?? {
          success: true,
          repoName,
          message: "OK",
          data: "processed",
        }
      );
    },
  };

  return { guards, calls };
}

// =============================================================================
// Tests
// =============================================================================

describe("withGitHubGuards", () => {
  describe("GitHub-only gating", () => {
    test("skips non-GitHub repos", async () => {
      const { guards, calls } = defaultGuards();

      const result = await withGitHubGuards(
        baseRepoConfig,
        mockAzureRepo,
        {},
        guards
      );

      assert.equal(result.success, true);
      assert.equal(result.skipped, true);
      assert.ok(result.message.includes("not a GitHub repository"));
      assert.equal(calls.length, 0);
    });

    test("processes GitHub repos", async () => {
      const { guards, calls } = defaultGuards();

      const result = await withGitHubGuards(
        baseRepoConfig,
        mockGitHubRepo,
        {},
        guards
      );

      assert.equal(result.success, true);
      assert.equal(result.skipped, undefined);
      assert.equal(calls.length, 1);
    });
  });

  describe("empty settings check", () => {
    test("skips when hasDesiredSettings returns false", async () => {
      const { guards, calls } = defaultGuards({ hasSettings: false });

      const result = await withGitHubGuards(
        baseRepoConfig,
        mockGitHubRepo,
        {},
        guards
      );

      assert.equal(result.success, true);
      assert.equal(result.skipped, true);
      assert.equal(result.message, "No test settings configured");
      assert.equal(calls.length, 0);
    });
  });

  describe("token resolution", () => {
    test("passes provided token to processSettings", async () => {
      const { guards, calls } = defaultGuards();

      const result = await withGitHubGuards(
        baseRepoConfig,
        mockGitHubRepo,
        { token: "provided-token" },
        guards
      );

      assert.equal(result.success, true);
      assert.equal(calls[0].effectiveToken, "provided-token");
    });

    test("falls back to undefined when no token provided", async () => {
      const { guards, calls } = defaultGuards();

      const result = await withGitHubGuards(
        baseRepoConfig,
        mockGitHubRepo,
        {},
        guards
      );

      assert.equal(result.success, true);
      assert.equal(calls[0].effectiveToken, undefined);
    });
  });

  describe("error wrapping", () => {
    test("catches Error objects and returns failure result", async () => {
      const { guards } = defaultGuards({
        error: new Error("API rate limit exceeded"),
      });

      const result = await withGitHubGuards(
        baseRepoConfig,
        mockGitHubRepo,
        {},
        guards
      );

      assert.equal(result.success, false);
      assert.ok(result.message.includes("API rate limit exceeded"));
    });

    test("catches non-Error thrown values and returns failure result", async () => {
      const { guards } = defaultGuards({
        error: "string error" as unknown as Error,
      });

      const result = await withGitHubGuards(
        baseRepoConfig,
        mockGitHubRepo,
        {},
        guards
      );

      assert.equal(result.success, false);
      assert.ok(result.message.includes("string error"));
    });
  });
});

describe("formatChangeSummary", () => {
  test("formats counts correctly", () => {
    const summary = formatChangeSummary({
      create: 2,
      update: 1,
      delete: 3,
      unchanged: 0,
    });
    assert.equal(summary, "2 created, 1 updated, 3 deleted");
  });

  test("returns 'no changes' when all counts are zero", () => {
    const summary = formatChangeSummary({
      create: 0,
      update: 0,
      delete: 0,
      unchanged: 0,
    });
    assert.equal(summary, "no changes");
  });

  test("includes unchanged count", () => {
    const summary = formatChangeSummary({
      create: 0,
      update: 0,
      delete: 0,
      unchanged: 5,
    });
    assert.equal(summary, "5 unchanged");
  });
});
