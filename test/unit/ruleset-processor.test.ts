import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { RulesetProcessor } from "../../src/settings/rulesets/processor.js";
import type { RepoConfig, Ruleset } from "../../src/config/index.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../src/shared/repo-detector.js";
import type {
  GitHubRuleset,
  GitHubRulesetStrategy,
} from "../../src/settings/rulesets/github-ruleset-strategy.js";

// Mock strategy that tracks calls and returns configured responses
class MockRulesetStrategy {
  calls: { method: string; args: unknown[]; options?: unknown }[] = [];
  listResponse: GitHubRuleset[] = [];
  getResponseMap: Map<number, GitHubRuleset> = new Map();
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

  async list(
    _repo: GitHubRepoInfo,
    options?: unknown
  ): Promise<GitHubRuleset[]> {
    this.calls.push({ method: "list", args: [], options });
    return this.listResponse;
  }

  async get(
    _repo: GitHubRepoInfo,
    id: number,
    options?: unknown
  ): Promise<GitHubRuleset> {
    this.calls.push({ method: "get", args: [id], options });
    return (
      this.getResponseMap.get(id) ??
      this.listResponse.find((r) => r.id === id) ??
      this.createResponse
    );
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
    this.getResponseMap = new Map();
  }

  setListResponse(rulesets: GitHubRuleset[]): void {
    this.listResponse = rulesets;
  }

  setGetResponse(id: number, ruleset: GitHubRuleset): void {
    this.getResponseMap.set(id, ruleset);
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

    test("fetches full details for rulesets matching desired config", async () => {
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
      // List returns partial data (no rules/conditions)
      mockStrategy.setListResponse([
        {
          id: 100,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
        },
      ]);
      // Get returns full data with rules
      mockStrategy.setGetResponse(100, {
        id: 100,
        name: "main-protection",
        target: "branch",
        enforcement: "active",
        rules: [
          {
            type: "pull_request",
            parameters: {
              required_approving_review_count: 0,
              dismiss_stale_reviews_on_push: false,
              require_code_owner_review: false,
              require_last_push_approval: false,
              required_review_thread_resolution: false,
              allowed_merge_methods: ["merge", "squash", "rebase"],
            },
          },
        ],
      });

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: ["main-protection"],
      });

      assert.equal(result.success, true);
      // Should have called get() for the matching ruleset
      const getCalls = mockStrategy.calls.filter((c) => c.method === "get");
      assert.equal(getCalls.length, 1);
      assert.equal(getCalls[0].args[0], 100);
      // With full data from get(), this should be unchanged (not update)
      assert.equal(result.changes?.unchanged, 1);
      assert.equal(result.changes?.update, 0);
    });

    test("does not fetch full details for rulesets not in desired config", async () => {
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
      // List returns two rulesets, only one matches desired config
      mockStrategy.setListResponse([
        {
          id: 100,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
        },
        {
          id: 200,
          name: "unrelated-ruleset",
          target: "branch",
          enforcement: "active",
        },
      ]);
      mockStrategy.setGetResponse(100, {
        id: 100,
        name: "main-protection",
        target: "branch",
        enforcement: "active",
      });

      await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: ["main-protection"],
      });

      // Should only call get() for "main-protection", not "unrelated-ruleset"
      const getCalls = mockStrategy.calls.filter((c) => c.method === "get");
      assert.equal(getCalls.length, 1);
      assert.equal(getCalls[0].args[0], 100);
    });

    test("list returns partial data and get returns full data - round trip unchanged", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "branch-rules": {
              target: "branch",
              enforcement: "active",
              conditions: {
                refName: {
                  include: ["refs/heads/main"],
                  exclude: [],
                },
              },
              rules: [{ type: "pull_request" }],
              bypassActors: [
                { actorId: 1, actorType: "Team", bypassMode: "always" },
              ],
            },
          },
        },
      };
      // List returns summary only (no rules, conditions, or bypass_actors)
      mockStrategy.setListResponse([
        {
          id: 42,
          name: "branch-rules",
          target: "branch",
          enforcement: "active",
        },
      ]);
      // Get returns full details
      mockStrategy.setGetResponse(42, {
        id: 42,
        name: "branch-rules",
        target: "branch",
        enforcement: "active",
        conditions: {
          ref_name: {
            include: ["refs/heads/main"],
            exclude: [],
          },
        },
        rules: [
          {
            type: "pull_request",
            parameters: {
              required_approving_review_count: 0,
              dismiss_stale_reviews_on_push: false,
              require_code_owner_review: false,
              require_last_push_approval: false,
              required_review_thread_resolution: false,
              allowed_merge_methods: ["merge", "squash", "rebase"],
            },
          },
        ],
        bypass_actors: [
          { actor_id: 1, actor_type: "Team", bypass_mode: "always" },
        ],
      });

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: true,
        managedRulesets: ["branch-rules"],
      });

      assert.equal(result.success, true);
      // Should be unchanged since full data from get() matches config
      assert.equal(result.changes?.unchanged, 1);
      assert.equal(result.changes?.create, 0);
      assert.equal(result.changes?.update, 0);
      assert.equal(result.changes?.delete, 0);
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

    test("returns formatted plan in dry-run mode", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            existing: { target: "branch", enforcement: "active" },
            newone: { target: "branch", enforcement: "active" },
          },
        },
      };
      mockStrategy.setListResponse([
        { id: 1, name: "existing", target: "branch", enforcement: "disabled" },
      ]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: true,
        managedRulesets: ["existing"],
      });

      assert.equal(result.dryRun, true);
      assert.ok(result.planOutput); // Should have plan output
      assert.ok(result.planOutput!.lines.length > 0);
      assert.equal(result.planOutput!.creates, 1);
      assert.equal(result.planOutput!.updates, 1);
    });
  });

  describe("plan output in non-dry-run", () => {
    test("includes planOutput with entries in non-dry-run results", async () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "new-ruleset": { target: "branch", enforcement: "active" },
          },
        },
      };
      mockStrategy.setListResponse([
        { id: 1, name: "existing", target: "branch", enforcement: "disabled" },
      ]);

      const result = await processor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: false,
        managedRulesets: ["existing"],
      });

      assert.equal(result.success, true);
      assert.equal(result.dryRun, undefined);
      assert.ok(result.planOutput);
      assert.ok(Array.isArray(result.planOutput!.entries));
      assert.equal(result.planOutput!.creates, 1);
      assert.ok(
        result.planOutput!.entries.some(
          (e) => e.name === "new-ruleset" && e.action === "create"
        )
      );
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

  describe("GitHub App token resolution", () => {
    test("passes resolved App token to strategy when App credentials are set", async () => {
      const origAppId = process.env.XFG_GITHUB_APP_ID;
      const origPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;
      process.env.XFG_GITHUB_APP_ID = "12345";
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = "fake-key";

      const freshStrategy = new MockRulesetStrategy();
      const freshProcessor = new RulesetProcessor(
        freshStrategy as unknown as GitHubRulesetStrategy
      );

      // Replace tokenManager with mock (same pattern as repository-processor tests)
      const mockTokenManager = {
        async getTokenForRepo() {
          return "ghs_mock_installation_token";
        },
      };
      (
        freshProcessor as unknown as { tokenManager: typeof mockTokenManager }
      ).tokenManager = mockTokenManager;

      freshStrategy.setListResponse([
        {
          id: 1,
          name: "test-ruleset",
          target: "branch",
          enforcement: "active",
        },
      ]);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "test-ruleset": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      };

      const result = await freshProcessor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: true,
        managedRulesets: [],
      });

      const listCalls = freshStrategy.calls.filter((c) => c.method === "list");
      assert.equal(listCalls.length, 1);

      const listOptions = listCalls[0].options as
        | { token?: string; host?: string }
        | undefined;
      assert.equal(
        listOptions?.token,
        "ghs_mock_installation_token",
        "list() should receive the resolved App installation token"
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

      const freshStrategy = new MockRulesetStrategy();
      const freshProcessor = new RulesetProcessor(
        freshStrategy as unknown as GitHubRulesetStrategy
      );

      const mockTokenManager = {
        async getTokenForRepo() {
          return null;
        },
      };
      (
        freshProcessor as unknown as { tokenManager: typeof mockTokenManager }
      ).tokenManager = mockTokenManager;

      freshStrategy.setListResponse([]);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test-org/test-repo.git",
        files: [],
        settings: {
          rulesets: {
            "test-ruleset": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      };

      const result = await freshProcessor.process(repoConfig, mockGitHubRepo, {
        configId: "test-config",
        dryRun: true,
        managedRulesets: [],
      });

      const listCalls = freshStrategy.calls.filter((c) => c.method === "list");
      const listOptions = listCalls[0].options as
        | { token?: string; host?: string }
        | undefined;
      assert.equal(
        listOptions?.token,
        undefined,
        "list() should receive undefined token when manager returns null"
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
