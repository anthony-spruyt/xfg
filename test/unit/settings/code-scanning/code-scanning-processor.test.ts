import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { CodeScanningProcessor } from "../../../../src/settings/code-scanning/processor.js";
import type {
  ICodeScanningStrategy,
  CurrentCodeScanningSettings,
} from "../../../../src/settings/code-scanning/types.js";
import type {
  IRepoMetadataProvider,
  RepoMetadata,
} from "../../../../src/shared/repo-metadata-provider.js";
import type { GitHubRepoInfo } from "../../../../src/shared/repo-detector.js";
import type { RepoConfig } from "../../../../src/config/index.js";
import type { RepoInfo } from "../../../../src/shared/repo-detector.js";
import type { GhApiOptions } from "../../../../src/shared/gh-api-utils.js";

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "https://github.com/test-org/test-repo.git",
  host: "github.com",
  owner: "test-org",
  repo: "test-repo",
};

const adoRepo: RepoInfo = {
  type: "azure-devops",
  gitUrl: "https://dev.azure.com/org/project/_git/repo",
  owner: "org",
  organization: "org",
  project: "project",
  repo: "repo",
};

class MockStrategy implements ICodeScanningStrategy {
  getResult: CurrentCodeScanningSettings = { state: "not-configured" };
  updateCalls: Array<{
    settings: { state: string; query_suite?: string; languages?: string[] };
  }> = [];

  async getDefaultSetup(
    _repoInfo: RepoInfo,
    _options?: GhApiOptions
  ): Promise<CurrentCodeScanningSettings> {
    return this.getResult;
  }

  async updateDefaultSetup(
    _repoInfo: RepoInfo,
    settings: { state: string; query_suite?: string; languages?: string[] },
    _options?: GhApiOptions
  ): Promise<void> {
    this.updateCalls.push({ settings });
  }
}

class MockMetadataProvider implements IRepoMetadataProvider {
  result: RepoMetadata = {
    visibility: "public",
    ownerType: "Organization",
    hasGHAS: false,
  };

  async getMetadata(
    _repoInfo: RepoInfo,
    _options?: GhApiOptions
  ): Promise<RepoMetadata> {
    return this.result;
  }
}

function makeRepoConfig(
  codeScanning?: RepoConfig["settings"] extends { codeScanning?: infer T }
    ? T
    : never
): RepoConfig {
  return {
    git: "https://github.com/test-org/test-repo.git",
    files: [],
    settings: codeScanning ? { codeScanning } : undefined,
  } as RepoConfig;
}

describe("CodeScanningProcessor", () => {
  let strategy: MockStrategy;
  let metadataProvider: MockMetadataProvider;
  let processor: CodeScanningProcessor;

  beforeEach(() => {
    strategy = new MockStrategy();
    metadataProvider = new MockMetadataProvider();
    processor = new CodeScanningProcessor(strategy, metadataProvider);
  });

  test("skips non-GitHub repos", async () => {
    const config = makeRepoConfig({ state: "configured" });
    const result = await processor.process(config, adoRepo, {});

    assert.ok(result.skipped);
    assert.ok(result.message.includes("not a GitHub repository"));
  });

  test("skips when no codeScanning settings", async () => {
    const config = makeRepoConfig();
    const result = await processor.process(config, githubRepo, {});

    assert.ok(result.skipped);
  });

  test("applies changes when state differs", async () => {
    strategy.getResult = { state: "not-configured" };
    const config = makeRepoConfig({ state: "configured" });

    const result = await processor.process(config, githubRepo, {});

    assert.ok(result.success);
    assert.equal(strategy.updateCalls.length, 1);
    assert.equal(strategy.updateCalls[0].settings.state, "configured");
  });

  test("dry run does not apply changes", async () => {
    strategy.getResult = { state: "not-configured" };
    const config = makeRepoConfig({ state: "configured" });

    const result = await processor.process(config, githubRepo, {
      dryRun: true,
    });

    assert.ok(result.success);
    assert.ok(result.dryRun);
    assert.equal(strategy.updateCalls.length, 0);
  });

  test("no changes when settings match", async () => {
    strategy.getResult = {
      state: "configured",
      query_suite: "default",
    };
    const config = makeRepoConfig({
      state: "configured",
      querySuite: "default",
    });

    const result = await processor.process(config, githubRepo, {});

    assert.ok(result.success);
    assert.ok(result.message.includes("No changes needed"));
    assert.equal(strategy.updateCalls.length, 0);
  });

  test("rejects when GHAS not available for private repo", async () => {
    metadataProvider.result = {
      visibility: "private",
      ownerType: "User",
      hasGHAS: false,
    };
    strategy.getResult = { state: "not-configured" };
    const config = makeRepoConfig({ state: "configured" });

    const result = await processor.process(config, githubRepo, {});

    assert.ok(!result.success);
    assert.ok(
      result.message.includes("Advanced Security"),
      `Expected GHAS error, got: ${result.message}`
    );
  });

  test("allows code scanning on public repo without GHAS", async () => {
    metadataProvider.result = {
      visibility: "public",
      ownerType: "User",
      hasGHAS: false,
    };
    strategy.getResult = { state: "not-configured" };
    const config = makeRepoConfig({ state: "configured" });

    const result = await processor.process(config, githubRepo, {});

    assert.ok(result.success);
  });
});
