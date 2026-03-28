import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { RepoSettingsProcessor } from "../../src/settings/repo-settings/processor.js";
import type { GitHubRepoInfo } from "../../src/shared/repo-detector.js";
import type { RepoConfig } from "../../src/config/index.js";
import type {
  IRepoSettingsStrategy,
  CurrentRepoSettings,
} from "../../src/settings/repo-settings/types.js";
import type { GhApiOptions } from "../../src/shared/gh-api-utils.js";
import type { GitHubRepoSettings } from "../../src/config/index.js";
import type { RepoInfo } from "../../src/shared/repo-detector.js";
import type {
  IRepoMetadataProvider,
  RepoMetadata,
} from "../../src/shared/repo-metadata-provider.js";

class MockMetadataProvider implements IRepoMetadataProvider {
  result: RepoMetadata = {
    visibility: "public",
    ownerType: "Organization",
    hasGHAS: true,
  };

  async getMetadata(): Promise<RepoMetadata> {
    return this.result;
  }
}

const mockMetadataProvider = new MockMetadataProvider();

// Mock strategy for testing
class MockStrategy implements IRepoSettingsStrategy {
  getSettingsResult: CurrentRepoSettings = {};
  getSettingsCalls: Array<{
    repoInfo: RepoInfo;
    options?: GhApiOptions;
  }> = [];
  updateSettingsCalls: Array<{
    repoInfo: RepoInfo;
    settings: GitHubRepoSettings;
    options?: GhApiOptions;
  }> = [];
  vulnerabilityAlertsCalls: Array<{
    repoInfo: RepoInfo;
    enable: boolean;
    options?: GhApiOptions;
  }> = [];
  automatedSecurityFixesCalls: Array<{
    repoInfo: RepoInfo;
    enable: boolean;
    options?: GhApiOptions;
  }> = [];
  privateVulnerabilityReportingCalls: Array<{
    repoInfo: RepoInfo;
    enable: boolean;
    options?: GhApiOptions;
  }> = [];

  async getSettings(
    repoInfo: RepoInfo,
    options?: GhApiOptions
  ): Promise<CurrentRepoSettings> {
    this.getSettingsCalls.push({ repoInfo, options });
    return this.getSettingsResult;
  }

  async updateSettings(
    repoInfo: RepoInfo,
    settings: GitHubRepoSettings,
    options?: GhApiOptions
  ): Promise<void> {
    this.updateSettingsCalls.push({ repoInfo, settings, options });
  }

  async setVulnerabilityAlerts(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: GhApiOptions
  ): Promise<void> {
    this.vulnerabilityAlertsCalls.push({ repoInfo, enable, options });
  }

  async setAutomatedSecurityFixes(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: GhApiOptions
  ): Promise<void> {
    this.automatedSecurityFixesCalls.push({ repoInfo, enable, options });
  }

  async setPrivateVulnerabilityReporting(
    repoInfo: RepoInfo,
    enable: boolean,
    options?: GhApiOptions
  ): Promise<void> {
    this.privateVulnerabilityReportingCalls.push({ repoInfo, enable, options });
  }

  reset(): void {
    this.getSettingsResult = {};
    this.getSettingsCalls = [];
    this.updateSettingsCalls = [];
    this.vulnerabilityAlertsCalls = [];
    this.automatedSecurityFixesCalls = [];
    this.privateVulnerabilityReportingCalls = [];
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
    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
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
    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
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
    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
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

    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
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
    assert.equal(result.changes?.update, 1);
    assert.equal(mockStrategy.updateSettingsCalls.length, 0);
  });

  test("should apply changes when not in dry-run mode", async () => {
    mockStrategy.getSettingsResult = { has_wiki: true };

    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
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

    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
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
        (e) => e.property === "hasWiki" && e.action === "update"
      )
    );
  });

  test("should report no changes when settings match", async () => {
    mockStrategy.getSettingsResult = { has_wiki: true };

    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
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
    assert.equal(result.changes?.create, 0);
    assert.equal(result.changes?.update, 0);
    assert.equal(mockStrategy.updateSettingsCalls.length, 0);
  });

  test("should call setVulnerabilityAlerts for vulnerabilityAlerts setting", async () => {
    mockStrategy.getSettingsResult = {};

    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
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

    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
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

  test("should call setPrivateVulnerabilityReporting for privateVulnerabilityReporting setting", async () => {
    mockStrategy.getSettingsResult = {
      visibility: "public",
      owner_type: "User",
    };

    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: { repo: { privateVulnerabilityReporting: true } },
    };

    await processor.process(repoConfig, githubRepo, {
      dryRun: false,
    });

    assert.equal(mockStrategy.privateVulnerabilityReportingCalls.length, 1);
    assert.equal(
      mockStrategy.privateVulnerabilityReportingCalls[0].enable,
      true
    );
  });

  test("should only send changed settings to updateSettings, not the entire config", async () => {
    // Regression test: when some settings match and others differ,
    // only the differing settings should be sent to the API.
    // This prevents errors like "allow_forking can only be changed on org-owned repos"
    // when allowForking is in the config but unchanged.
    mockStrategy.getSettingsResult = {
      has_wiki: true,
      allow_forking: true, // Already matches desired value
      delete_branch_on_merge: false, // Different from desired
    };

    const processor = new RepoSettingsProcessor(
      mockStrategy,
      mockMetadataProvider
    );
    const repoConfig: RepoConfig = {
      git: githubRepo.gitUrl,
      files: [],
      settings: {
        repo: {
          hasWiki: true, // Matches - should NOT be sent
          allowForking: true, // Matches - should NOT be sent
          deleteBranchOnMerge: true, // Changed - should be sent
        },
      },
    };

    await processor.process(repoConfig, githubRepo, { dryRun: false });

    assert.equal(mockStrategy.updateSettingsCalls.length, 1);
    const sentSettings = mockStrategy.updateSettingsCalls[0].settings;

    // Only deleteBranchOnMerge should be sent (the only changed setting)
    assert.equal(sentSettings.deleteBranchOnMerge, true);
    assert.equal(
      sentSettings.hasWiki,
      undefined,
      "hasWiki matches current - should not be sent"
    );
    assert.equal(
      sentSettings.allowForking,
      undefined,
      "allowForking matches current - should not be sent"
    );
  });

  test("should handle errors gracefully", async () => {
    const errorStrategy: IRepoSettingsStrategy = {
      getSettings: async () => {
        throw new Error("API Error");
      },
      updateSettings: async () => {},
      setVulnerabilityAlerts: async () => {},
      setAutomatedSecurityFixes: async () => {},
      setPrivateVulnerabilityReporting: async () => {},
    };

    const processor = new RepoSettingsProcessor(
      errorStrategy,
      mockMetadataProvider
    );
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

  describe("token passthrough", () => {
    test("passes caller-provided token directly to strategy", async () => {
      const freshStrategy = new MockStrategy();
      const freshProcessor = new RepoSettingsProcessor(
        freshStrategy,
        mockMetadataProvider
      );
      freshStrategy.getSettingsResult = { has_wiki: true };

      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { hasWiki: true } },
      };

      const result = await freshProcessor.process(repoConfig, githubRepo, {
        dryRun: true,
        token: "pre-resolved-token",
      });

      assert.equal(freshStrategy.getSettingsCalls.length, 1);
      assert.equal(
        freshStrategy.getSettingsCalls[0].options?.token,
        "pre-resolved-token",
        "getSettings() should receive the caller-provided token"
      );
      assert.equal(result.success, true);
    });

    test("passes undefined token when caller provides none", async () => {
      const freshStrategy = new MockStrategy();
      const freshProcessor = new RepoSettingsProcessor(
        freshStrategy,
        mockMetadataProvider
      );
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
        "getSettings() should receive undefined token when none provided"
      );
      assert.equal(result.success, true);
    });
  });

  describe("security settings validation", () => {
    test("should fail when privateVulnerabilityReporting is true on a private repo", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "User",
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "User",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { privateVulnerabilityReporting: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(
        result.message.includes("privateVulnerabilityReporting"),
        `Expected message to mention privateVulnerabilityReporting, got: ${result.message}`
      );
      assert.ok(
        result.message.includes("public"),
        `Expected message to mention public repos, got: ${result.message}`
      );
    });

    test("should fail when privateVulnerabilityReporting is true on a private repo in dry-run mode", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "Organization",
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "Organization",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { privateVulnerabilityReporting: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("privateVulnerabilityReporting"));
    });

    test("should fail when privateVulnerabilityReporting is true on an internal repo", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "internal",
        owner_type: "Organization",
      };

      mockMetadataProvider.result = {
        visibility: "internal",
        ownerType: "Organization",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { privateVulnerabilityReporting: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("privateVulnerabilityReporting"));
    });

    test("should allow privateVulnerabilityReporting on public repos", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "public",
        owner_type: "User",
        private_vulnerability_reporting: false,
      };

      mockMetadataProvider.result = {
        visibility: "public",
        ownerType: "User",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { privateVulnerabilityReporting: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      assert.equal(result.success, true);
    });

    test("should fail when secretScanning is true on a user-owned private repo", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "User",
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "User",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { secretScanning: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("secretScanning"));
    });

    test("should fail when secretScanningPushProtection is true on a user-owned private repo", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "User",
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "User",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { secretScanningPushProtection: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("secretScanningPushProtection"));
    });

    test("should fail when secretScanning is true on org-owned private repo without GHAS (security_and_analysis undefined)", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "Organization",
        security_and_analysis: undefined,
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "Organization",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { secretScanning: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("secretScanning"));
    });

    test("should fail when secretScanning is true on org-owned private repo without GHAS (security_and_analysis null)", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "Organization",
        security_and_analysis: null as unknown as undefined,
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "Organization",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { secretScanning: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("secretScanning"));
    });

    test("should fail when secretScanningPushProtection is true on org-owned private repo without GHAS", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "Organization",
        security_and_analysis: undefined,
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "Organization",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { secretScanningPushProtection: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("secretScanningPushProtection"));
    });

    test("should fail when secretScanning is true on internal repo without GHAS", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "internal",
        owner_type: "Organization",
        security_and_analysis: undefined,
      };

      mockMetadataProvider.result = {
        visibility: "internal",
        ownerType: "Organization",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { secretScanning: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("secretScanning"));
    });

    test("should allow secretScanning on internal org-owned repo with GHAS enabled", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "internal",
        owner_type: "Organization",
        security_and_analysis: {
          secret_scanning: { status: "disabled" },
        },
      };

      mockMetadataProvider.result = {
        visibility: "internal",
        ownerType: "Organization",
        hasGHAS: true,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { secretScanning: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      assert.equal(result.success, true);
    });

    test("should allow secretScanning on org-owned private repo with GHAS enabled", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "Organization",
        security_and_analysis: {
          secret_scanning: { status: "disabled" },
        },
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "Organization",
        hasGHAS: true,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { secretScanning: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      assert.equal(result.success, true);
    });

    test("should allow secretScanning on public repos", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "public",
        owner_type: "User",
      };

      mockMetadataProvider.result = {
        visibility: "public",
        ownerType: "User",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: { repo: { secretScanning: true } },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      assert.equal(result.success, true);
    });

    test("should not fail when setting these to false on private repos", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "User",
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "User",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: {
          repo: {
            secretScanning: false,
            secretScanningPushProtection: false,
            privateVulnerabilityReporting: false,
          },
        },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      assert.equal(result.success, true);
    });

    test("should only error on true settings when mixed with false settings on private repo", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "User",
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "User",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: {
          repo: {
            secretScanning: true,
            secretScanningPushProtection: false,
            privateVulnerabilityReporting: false,
          },
        },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("secretScanning"));
      assert.ok(
        !result.message.includes("privateVulnerabilityReporting"),
        "Should not mention privateVulnerabilityReporting since it is false"
      );
    });

    test("should collect all incompatible settings into one error message", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "User",
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "User",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: {
          repo: {
            secretScanning: true,
            secretScanningPushProtection: true,
            privateVulnerabilityReporting: true,
          },
        },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("secretScanning"));
      assert.ok(result.message.includes("secretScanningPushProtection"));
      assert.ok(result.message.includes("privateVulnerabilityReporting"));
    });

    test("should allow security settings when visibility is transitioning from private to public", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "User",
        private_vulnerability_reporting: false,
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "User",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: {
          repo: {
            visibility: "public",
            secretScanning: true,
            secretScanningPushProtection: true,
            privateVulnerabilityReporting: true,
          },
        },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      assert.equal(result.success, true);
    });

    test("should allow security settings when visibility is transitioning from internal to public", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "internal",
        owner_type: "Organization",
      };

      mockMetadataProvider.result = {
        visibility: "internal",
        ownerType: "Organization",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: {
          repo: {
            visibility: "public",
            secretScanning: true,
            privateVulnerabilityReporting: true,
          },
        },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: true,
      });

      assert.equal(result.success, true);
    });

    test("should still fail when desired visibility is also private", async () => {
      mockStrategy.getSettingsResult = {
        visibility: "private",
        owner_type: "User",
      };

      mockMetadataProvider.result = {
        visibility: "private",
        ownerType: "User",
        hasGHAS: false,
      };
      const processor = new RepoSettingsProcessor(
        mockStrategy,
        mockMetadataProvider
      );
      const repoConfig: RepoConfig = {
        git: githubRepo.gitUrl,
        files: [],
        settings: {
          repo: {
            visibility: "private",
            secretScanning: true,
            privateVulnerabilityReporting: true,
          },
        },
      };

      const result = await processor.process(repoConfig, githubRepo, {
        dryRun: false,
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("secretScanning"));
      assert.ok(result.message.includes("privateVulnerabilityReporting"));
    });
  });
});
