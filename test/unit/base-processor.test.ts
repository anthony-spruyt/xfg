import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import type { RepoConfig } from "../../src/config/index.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../src/shared/repo-detector.js";
import {
  BaseSettingsProcessor,
  type BaseProcessorOptions,
  type BaseProcessorResult,
  formatChangeSummary,
} from "../../src/settings/base-processor.js";

// =============================================================================
// Concrete test implementation
// =============================================================================

interface TestProcessorResult extends BaseProcessorResult {
  data?: string;
}

class TestProcessor extends BaseSettingsProcessor<
  BaseProcessorOptions,
  TestProcessorResult
> {
  hasSettingsReturn = true;
  processSettingsResult: TestProcessorResult = {
    success: true,
    repoName: "test",
    message: "OK",
    data: "processed",
  };
  processSettingsError: Error | null = null;
  processSettingsCalls: Array<{
    githubRepo: GitHubRepoInfo;
    effectiveToken: string | undefined;
  }> = [];

  protected hasDesiredSettings(_repoConfig: RepoConfig): boolean {
    return this.hasSettingsReturn;
  }

  protected getEmptySettingsMessage(): string {
    return "No test settings configured";
  }

  protected createSkipResult(
    repoName: string,
    message: string
  ): TestProcessorResult {
    return { success: true, repoName, message, skipped: true };
  }

  protected createErrorResult(
    repoName: string,
    message: string
  ): TestProcessorResult {
    return { success: false, repoName, message };
  }

  protected async processSettings(
    githubRepo: GitHubRepoInfo,
    _repoConfig: RepoConfig,
    _options: BaseProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<TestProcessorResult> {
    this.processSettingsCalls.push({ githubRepo, effectiveToken });
    if (this.processSettingsError) {
      throw this.processSettingsError;
    }
    return { ...this.processSettingsResult, repoName };
  }
}

// =============================================================================
// Test fixtures
// =============================================================================

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

// =============================================================================
// Tests
// =============================================================================

describe("BaseSettingsProcessor", () => {
  let processor: TestProcessor;

  beforeEach(() => {
    processor = new TestProcessor();
  });

  describe("GitHub-only gating", () => {
    test("skips non-GitHub repos", async () => {
      const result = await processor.process(baseRepoConfig, mockAzureRepo, {});

      assert.equal(result.success, true);
      assert.equal(result.skipped, true);
      assert.ok(result.message.includes("not a GitHub repository"));
      assert.equal(processor.processSettingsCalls.length, 0);
    });

    test("processes GitHub repos", async () => {
      const result = await processor.process(
        baseRepoConfig,
        mockGitHubRepo,
        {}
      );

      assert.equal(result.success, true);
      assert.equal(result.skipped, undefined);
      assert.equal(processor.processSettingsCalls.length, 1);
    });
  });

  describe("empty settings check", () => {
    test("skips when hasDesiredSettings returns false", async () => {
      processor.hasSettingsReturn = false;

      const result = await processor.process(
        baseRepoConfig,
        mockGitHubRepo,
        {}
      );

      assert.equal(result.success, true);
      assert.equal(result.skipped, true);
      assert.equal(result.message, "No test settings configured");
      assert.equal(processor.processSettingsCalls.length, 0);
    });
  });

  describe("token resolution", () => {
    test("passes provided token to processSettings", async () => {
      const result = await processor.process(baseRepoConfig, mockGitHubRepo, {
        token: "provided-token",
      });

      assert.equal(result.success, true);
      assert.equal(
        processor.processSettingsCalls[0].effectiveToken,
        "provided-token"
      );
    });

    test("falls back to undefined when no token provided and no token manager", async () => {
      const result = await processor.process(
        baseRepoConfig,
        mockGitHubRepo,
        {}
      );

      assert.equal(result.success, true);
      assert.equal(processor.processSettingsCalls[0].effectiveToken, undefined);
    });

    test("passes token through directly from options", async () => {
      const result = await processor.process(baseRepoConfig, mockGitHubRepo, {
        token: "app-resolved-token",
      });

      assert.equal(result.success, true);
      assert.equal(
        processor.processSettingsCalls[0].effectiveToken,
        "app-resolved-token"
      );
    });
  });

  describe("error wrapping", () => {
    test("catches Error objects and returns failure result", async () => {
      processor.processSettingsError = new Error("API rate limit exceeded");

      const result = await processor.process(
        baseRepoConfig,
        mockGitHubRepo,
        {}
      );

      assert.equal(result.success, false);
      assert.ok(result.message.includes("API rate limit exceeded"));
    });

    test("catches non-Error thrown values and returns failure result", async () => {
      processor.processSettingsError = "string error" as unknown as Error;

      const result = await processor.process(
        baseRepoConfig,
        mockGitHubRepo,
        {}
      );

      assert.equal(result.success, false);
      assert.ok(result.message.includes("string error"));
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
});
