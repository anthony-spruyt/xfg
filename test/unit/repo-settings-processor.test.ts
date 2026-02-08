import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { RepoSettingsProcessor } from "../../src/repo-settings-processor.js";
import type { GitHubRepoInfo } from "../../src/repo-detector.js";
import type { RepoConfig } from "../../src/config.js";
import type {
  IRepoSettingsStrategy,
  CurrentRepoSettings,
  RepoSettingsStrategyOptions,
} from "../../src/strategies/repo-settings-strategy.js";
import type { GitHubRepoSettings, RepoInfo } from "../../src/config.js";

// Mock strategy for testing
class MockStrategy implements IRepoSettingsStrategy {
  getSettingsResult: CurrentRepoSettings = {};
  getSettingsCalls: Array<{
    repoInfo: RepoInfo;
    options?: RepoSettingsStrategyOptions;
  }> = [];
  updateSettingsCalls: Array<{
    repoInfo: RepoInfo;
    settings: GitHubRepoSettings;
    options?: RepoSettingsStrategyOptions;
  }> = [];
  vulnerabilityAlertsCalls: Array<{
    repoInfo: RepoInfo;
    enable: boolean;
    options?: RepoSettingsStrategyOptions;
  }> = [];
  automatedSecurityFixesCalls: Array<{
    repoInfo: RepoInfo;
    enable: boolean;
    options?: RepoSettingsStrategyOptions;
  }> = [];

  async getSettings(
    repoInfo: RepoInfo,
    options?: RepoSettingsStrategyOptions
  ): Promise<CurrentRepoSettings> {
    this.getSettingsCalls.push({ repoInfo, options });
    return this.getSettingsResult;
  }

  async updateSettings(
    repoInfo: RepoInfo,
    settings: GitHubRepoSettings,
    options?: RepoSettingsStrategyOptions
  ): Promise<void> {
    this.updateSettingsCalls.push({ repoInfo, settings, options });
  }

  async setVulnerabilityAlerts(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void> {
    this.vulnerabilityAlertsCalls.push({ repoInfo, enable, options });
  }

  async setAutomatedSecurityFixes(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: RepoSettingsStrategyOptions
  ): Promise<void> {
    this.automatedSecurityFixesCalls.push({ repoInfo, enable, options });
  }

  reset(): void {
    this.getSettingsResult = {};
    this.getSettingsCalls = [];
    this.updateSettingsCalls = [];
    this.vulnerabilityAlertsCalls = [];
    this.automatedSecurityFixesCalls = [];
  }
}

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "https://github.com/test-org/test-repo.git",
  host: "github.com",
  owner: "test-org",
  repo: "test-repo",
};

describe("RepoSettingsProcessor", () => {
  let mockStrategy: MockStrategy;

  beforeEach(() => {
    mockStrategy = new MockStrategy();
  });

  test("should skip non-GitHub repos", async () => {
    const processor = new RepoSettingsProcessor(mockStrategy);
    const adoRepo = {
      type: "azure-devops" as const,
      gitUrl: "https://dev.azure.com/org/project/_git/repo",
      host: "dev.azure.com",
      owner: "org",
      organization: "org",
      project: "project",
      repo: "repo",
    };

    const result = await processor.process(
      { git: adoRepo.gitUrl, files: [], settings: { repo: { hasWiki: true } } },
      adoRepo,
      { dryRun: false }
    );

    assert.equal(result.skipped, true);
    assert.ok(result.message.includes("not a GitHub repository"));
  });

  test("should skip repos with no repo settings", async () => {
    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: {},
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    assert.equal(result.skipped, true);
    assert.ok(result.message.includes("No repo settings configured"));
  });

  test("should skip repos where repo settings were opted out (undefined after normalization)", async () => {
    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: {
        rulesets: {
          "main-protection": { target: "branch", enforcement: "active" },
        },
        // repo is undefined (opted out via repo: false, stripped by normalizer)
      },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    assert.equal(result.skipped, true);
    assert.ok(result.message.includes("No repo settings configured"));
    assert.equal(mockStrategy.getSettingsCalls.length, 0);
  });

  test("should detect and report changes in dry-run mode", async () => {
    mockStrategy.getSettingsResult = { has_wiki: true };

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { hasWiki: false } },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.changes?.changes, 1);
    assert.equal(mockStrategy.updateSettingsCalls.length, 0);
  });

  test("should apply changes when not in dry-run mode", async () => {
    mockStrategy.getSettingsResult = { has_wiki: true };

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { hasWiki: false } },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    assert.equal(result.success, true);
    assert.equal(mockStrategy.updateSettingsCalls.length, 1);
  });

  test("should include planOutput with entries in non-dry-run results", async () => {
    mockStrategy.getSettingsResult = { has_wiki: true };

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { hasWiki: false } },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    assert.equal(result.success, true);
    assert.equal(result.dryRun, undefined);
    assert.ok(result.planOutput);
    assert.ok(Array.isArray(result.planOutput!.entries));
    assert.ok(result.planOutput!.entries.length > 0);
    assert.ok(
      result.planOutput!.entries.some(
        (e) => e.property === "hasWiki" && e.action === "change"
      )
    );
  });

  test("should report no changes when settings match", async () => {
    mockStrategy.getSettingsResult = { has_wiki: true };

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { hasWiki: true } },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    assert.equal(result.success, true);
    assert.ok(result.message.includes("No changes needed"));
    assert.equal(result.changes?.adds, 0);
    assert.equal(result.changes?.changes, 0);
    assert.equal(mockStrategy.updateSettingsCalls.length, 0);
  });

  test("should call setVulnerabilityAlerts for vulnerabilityAlerts setting", async () => {
    mockStrategy.getSettingsResult = {};

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { vulnerabilityAlerts: true } },
    };

    await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    assert.equal(mockStrategy.vulnerabilityAlertsCalls.length, 1);
    assert.equal(mockStrategy.vulnerabilityAlertsCalls[0].enable, true);
  });

  test("should call setAutomatedSecurityFixes for automatedSecurityFixes setting", async () => {
    mockStrategy.getSettingsResult = {};

    const processor = new RepoSettingsProcessor(mockStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { automatedSecurityFixes: false } },
    };

    await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    assert.equal(mockStrategy.automatedSecurityFixesCalls.length, 1);
    assert.equal(mockStrategy.automatedSecurityFixesCalls[0].enable, false);
  });

  test("should handle errors gracefully", async () => {
    const errorStrategy: IRepoSettingsStrategy = {
      getSettings: async () => {
        throw new Error("API Error");
      },
      updateSettings: async () => {},
      setVulnerabilityAlerts: async () => {},
      setAutomatedSecurityFixes: async () => {},
    };

    const processor = new RepoSettingsProcessor(errorStrategy);
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { hasWiki: false } },
    };

    const result = await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    assert.equal(result.success, false);
    assert.ok(result.message.includes("API Error"));
  });

  describe("GitHub App token resolution", () => {
    test("passes resolved App token to strategy when App credentials are set", async () => {
      const origAppId = process.env.XFG_GITHUB_APP_ID;
      const origPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;
      process.env.XFG_GITHUB_APP_ID = "12345";
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = "fake-key";

      const freshStrategy = new MockStrategy();
      const freshProcessor = new RepoSettingsProcessor(freshStrategy);

      // Replace tokenManager with mock (same pattern as ruleset-processor tests)
      const mockTokenManager = {
        async getTokenForRepo() {
          return "ghs_mock_installation_token";
        },
      };
      (
        freshProcessor as unknown as { tokenManager: typeof mockTokenManager }
      ).tokenManager = mockTokenManager;

      freshStrategy.getSettingsResult = { has_wiki: true };

      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { hasWiki: true } },
      };

      const result = await freshProcessor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      assert.equal(freshStrategy.getSettingsCalls.length, 1);
      assert.equal(
        freshStrategy.getSettingsCalls[0].options?.token,
        "ghs_mock_installation_token",
        "getSettings() should receive the resolved App installation token"
      );
      assert.equal(result.success, true);

      // Restore env
      if (origAppId !== undefined) {
        process.env.XFG_GITHUB_APP_ID = origAppId;
      } else {
        delete process.env.XFG_GITHUB_APP_ID;
      }
      if (origPrivateKey !== undefined) {
        process.env.XFG_GITHUB_APP_PRIVATE_KEY = origPrivateKey;
      } else {
        delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
      }
    });

    test("falls back gracefully when token manager returns null", async () => {
      const origAppId = process.env.XFG_GITHUB_APP_ID;
      const origPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;
      process.env.XFG_GITHUB_APP_ID = "12345";
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = "fake-key";

      const freshStrategy = new MockStrategy();
      const freshProcessor = new RepoSettingsProcessor(freshStrategy);

      const mockTokenManager = {
        async getTokenForRepo() {
          return null;
        },
      };
      (
        freshProcessor as unknown as { tokenManager: typeof mockTokenManager }
      ).tokenManager = mockTokenManager;

      freshStrategy.getSettingsResult = { has_wiki: true };

      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { hasWiki: true } },
      };

      const result = await freshProcessor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      assert.equal(
        freshStrategy.getSettingsCalls[0].options?.token,
        undefined,
        "getSettings() should receive undefined token when manager returns null"
      );
      assert.equal(result.success, true);

      // Restore env
      if (origAppId !== undefined) {
        process.env.XFG_GITHUB_APP_ID = origAppId;
      } else {
        delete process.env.XFG_GITHUB_APP_ID;
      }
      if (origPrivateKey !== undefined) {
        process.env.XFG_GITHUB_APP_PRIVATE_KEY = origPrivateKey;
      } else {
        delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
      }
    });

    test("falls back gracefully when token manager throws error", async () => {
      const origAppId = process.env.XFG_GITHUB_APP_ID;
      const origPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;
      process.env.XFG_GITHUB_APP_ID = "12345";
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = "fake-key";

      const freshStrategy = new MockStrategy();
      const freshProcessor = new RepoSettingsProcessor(freshStrategy);

      const mockTokenManager = {
        async getTokenForRepo() {
          throw new Error("Token generation failed");
        },
      };
      (
        freshProcessor as unknown as { tokenManager: typeof mockTokenManager }
      ).tokenManager = mockTokenManager;

      freshStrategy.getSettingsResult = { has_wiki: true };

      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { hasWiki: true } },
      };

      const result = await freshProcessor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      // Should fall back to undefined token (no crash)
      assert.equal(
        freshStrategy.getSettingsCalls[0].options?.token,
        undefined,
        "getSettings() should receive undefined token when manager throws"
      );
      assert.equal(result.success, true);

      // Restore env
      if (origAppId !== undefined) {
        process.env.XFG_GITHUB_APP_ID = origAppId;
      } else {
        delete process.env.XFG_GITHUB_APP_ID;
      }
      if (origPrivateKey !== undefined) {
        process.env.XFG_GITHUB_APP_PRIVATE_KEY = origPrivateKey;
      } else {
        delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
      }
    });
  });
});
