import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { RulesetProcessor } from "./ruleset-processor.js";
import type { RepoConfig, Ruleset } from "./config.js";
import type { GitHubRepoInfo, AzureDevOpsRepoInfo } from "./repo-detector.js";
import type {
  GitHubRuleset,
  GitHubRulesetStrategy,
} from "./strategies/github-ruleset-strategy.js";

// Mock strategy that tracks calls and returns configured responses
class MockRulesetStrategy {
  calls: { method: string; args: unknown[] }[] = [];
  listResponse: GitHubRuleset[] = [];
  createResponse: GitHubRuleset = {
    id: 1,
    name: "test",
    target: "branch",
    enforcement: "active",
  };
  updateResponse: GitHubRuleset = {
    id: 1,
    name: "test",
    target: "branch",
    enforcement: "active",
  };

  async list(): Promise<GitHubRuleset[]> {
    this.calls.push({ method: "list", args: [] });
    return this.listResponse;
  }

  async get(_repo: GitHubRepoInfo, id: number): Promise<GitHubRuleset> {
    this.calls.push({ method: "get", args: [id] });
    return this.listResponse.find((r) => r.id === id) ?? this.createResponse;
  }

  async create(
    _repo: GitHubRepoInfo,
    name: string,
    ruleset: Ruleset
  ): Promise<GitHubRuleset> {
    this.calls.push({ method: "create", args: [name, ruleset] });
    return { ...this.createResponse, name };
  }

  async update(
    _repo: GitHubRepoInfo,
    id: number,
    name: string,
    ruleset: Ruleset
  ): Promise<GitHubRuleset> {
    this.calls.push({ method: "update", args: [id, name, ruleset] });
    return { ...this.updateResponse, id, name };
  }

  async delete(_repo: GitHubRepoInfo, id: number): Promise<void> {
    this.calls.push({ method: "delete", args: [id] });
  }

  reset(): void {
    this.calls = [];
    this.listResponse = [];
  }

  setListResponse(rulesets: GitHubRuleset[]): void {
    this.listResponse = rulesets;
  }
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
  gitUrl: "git@ssh.dev.azure.com:v3/test-org/test-project/test-repo",
};

describe("RulesetProcessor", () => {
  let mockStrategy: MockRulesetStrategy;
  let processor: RulesetProcessor;

  beforeEach(() => {
    mockStrategy = new MockRulesetStrategy();
    processor = new RulesetProcessor(
      mockStrategy as unknown as GitHubRulesetStrategy
    );
  });

  describe("process", () => {
    test("creates new rulesets that don't exist", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              enforcement: "active",
              rules: [{ type: "pull_request" }],
            },
          },
        },
      };
      mockStrategy.setListResponse([]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: [],
      });

      assert.equal(result.success, true);
      const createCalls = mockStrategy.calls.filter(
        (c) => c.method === "create"
      );
      assert.equal(createCalls.length, 1);
      assert.equal(createCalls[0].args[0], "main-protection");
    });

    test("updates existing rulesets that have changed", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              enforcement: "active", // Changed from disabled
            },
          },
        },
      };
      mockStrategy.setListResponse([
        {
          id: 123,
          name: "main-protection",
          target: "branch",
          enforcement: "disabled",
        },
      ]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: ["main-protection"],
      });

      assert.equal(result.success, true);
      const updateCalls = mockStrategy.calls.filter(
        (c) => c.method === "update"
      );
      assert.equal(updateCalls.length, 1);
      assert.equal(updateCalls[0].args[0], 123); // ID
      assert.equal(updateCalls[0].args[1], "main-protection"); // name
    });

    test("deletes orphaned rulesets when deleteOrphaned is true", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {},
          deleteOrphaned: true,
        },
      };
      mockStrategy.setListResponse([
        {
          id: 456,
          name: "old-ruleset",
          target: "branch",
          enforcement: "active",
        },
      ]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: ["old-ruleset"], // Previously managed
      });

      assert.equal(result.success, true);
      const deleteCalls = mockStrategy.calls.filter(
        (c) => c.method === "delete"
      );
      assert.equal(deleteCalls.length, 1);
      assert.equal(deleteCalls[0].args[0], 456);
    });

    test("does not delete unmanaged rulesets", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {},
          deleteOrphaned: true,
        },
      };
      mockStrategy.setListResponse([
        {
          id: 789,
          name: "external-ruleset",
          target: "branch",
          enforcement: "active",
        },
      ]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: [], // Not managed by xfg
      });

      assert.equal(result.success, true);
      const deleteCalls = mockStrategy.calls.filter(
        (c) => c.method === "delete"
      );
      assert.equal(deleteCalls.length, 0);
    });

    test("skips unchanged rulesets", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      };
      mockStrategy.setListResponse([
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
        },
      ]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: ["main-protection"],
      });

      assert.equal(result.success, true);
      const createCalls = mockStrategy.calls.filter(
        (c) => c.method === "create"
      );
      const updateCalls = mockStrategy.calls.filter(
        (c) => c.method === "update"
      );
      assert.equal(createCalls.length, 0);
      assert.equal(updateCalls.length, 0);
    });

    test("respects noDelete option", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {},
          deleteOrphaned: true,
        },
      };
      mockStrategy.setListResponse([
        {
          id: 456,
          name: "old-ruleset",
          target: "branch",
          enforcement: "active",
        },
      ]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: ["old-ruleset"],
        noDelete: true, // Override deleteOrphaned
      });

      assert.equal(result.success, true);
      const deleteCalls = mockStrategy.calls.filter(
        (c) => c.method === "delete"
      );
      assert.equal(deleteCalls.length, 0);
    });
  });

  describe("dry run mode", () => {
    test("does not make API calls in dry run", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      };
      mockStrategy.setListResponse([]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: true,
        managedRulesets: [],
      });

      assert.equal(result.success, true);
      assert.equal(result.dryRun, true);
      // Only list call should be made (to detect changes)
      const modifyCalls = mockStrategy.calls.filter(
        (c) =>
          c.method === "create" ||
          c.method === "update" ||
          c.method === "delete"
      );
      assert.equal(modifyCalls.length, 0);
    });

    test("reports planned changes in dry run", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "new-ruleset": { target: "branch", enforcement: "active" },
          },
        },
      };
      mockStrategy.setListResponse([]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: true,
        managedRulesets: [],
      });

      assert.ok(result.changes);
      assert.equal(result.changes.create, 1);
    });
  });

  describe("non-GitHub repos", () => {
    test("skips non-GitHub repos with appropriate message", async () => {
      const repoConfig: RepoConfig = {
        git: "git@ssh.dev.azure.com:v3/test-org/test-project/test-repo",
        files: [],
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      };

      const result = await processor.process(repoConfig, mockAzureRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: [],
      });

      assert.equal(result.success, true);
      assert.equal(result.skipped, true);
      assert.ok(result.message.includes("not a GitHub repository"));
    });
  });

  describe("error handling", () => {
    test("returns failure on API error", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      };

      // Override list to throw
      mockStrategy.list = async () => {
        throw new Error("API rate limit exceeded");
      };

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: [],
      });

      assert.equal(result.success, false);
      assert.ok(result.message.includes("API rate limit exceeded"));
    });
  });

  describe("manifest updates", () => {
    test("returns updated manifest with managed rulesets", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              enforcement: "active",
            },
          },
          deleteOrphaned: true,
        },
      };
      mockStrategy.setListResponse([]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: [],
      });

      assert.ok(result.manifestUpdate);
      assert.deepEqual(result.manifestUpdate.rulesets, ["main-protection"]);
    });

    test("includes all rulesets with deleteOrphaned in manifest", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "ruleset-a": { target: "branch", enforcement: "active" },
            "ruleset-b": { target: "tag", enforcement: "evaluate" },
          },
          deleteOrphaned: true,
        },
      };
      mockStrategy.setListResponse([]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: [],
      });

      assert.ok(result.manifestUpdate);
      assert.deepEqual(result.manifestUpdate.rulesets.sort(), [
        "ruleset-a",
        "ruleset-b",
      ]);
    });
  });
});
