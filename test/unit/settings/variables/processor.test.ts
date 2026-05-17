import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { VariablesProcessor } from "../../../../src/settings/variables/processor.js";
import type {
  IVariablesStrategy,
  GitHubVariable,
} from "../../../../src/settings/variables/types.js";
import type { RepoConfig } from "../../../../src/config/index.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
  RepoInfo,
} from "../../../../src/repo/index.js";
import type { GhApiOptions } from "../../../../src/shared/gh-api-utils.js";

class MockVariablesStrategy implements IVariablesStrategy {
  calls: { method: string; args: unknown[] }[] = [];
  listResponse: GitHubVariable[] = [];

  async list(
    _repoInfo: RepoInfo,
    _options?: GhApiOptions
  ): Promise<GitHubVariable[]> {
    this.calls.push({ method: "list", args: [] });
    return this.listResponse;
  }
  async create(
    _repoInfo: RepoInfo,
    name: string,
    value: string
  ): Promise<void> {
    this.calls.push({ method: "create", args: [name, value] });
  }
  async update(
    _repoInfo: RepoInfo,
    name: string,
    value: string
  ): Promise<void> {
    this.calls.push({ method: "update", args: [name, value] });
  }
  async delete(_repoInfo: RepoInfo, name: string): Promise<void> {
    this.calls.push({ method: "delete", args: [name] });
  }
}

const mockGitHubRepo: GitHubRepoInfo = {
  type: "github",
  owner: "test-org",
  repo: "test-repo",
  host: "github.com",
  gitUrl: "https://github.com/test-org/test-repo.git",
};

function makeRepoConfig(
  variables: Record<string, string>,
  deleteOrphaned = false
): RepoConfig {
  return {
    git: "https://github.com/test-org/test-repo.git",
    files: [],
    settings: {
      variables: Object.assign({ ...variables }, { deleteOrphaned }) as Record<
        string,
        string
      > & { deleteOrphaned?: boolean },
    },
  };
}

describe("VariablesProcessor", () => {
  test("creates new variables", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [];
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      makeRepoConfig({ NEW_VAR: "value" }),
      mockGitHubRepo,
      {}
    );
    assert.equal(result.success, true);
    assert.equal(result.changes?.create, 1);
    assert.equal(result.changes?.update, 0);
    assert.equal(result.changes?.delete, 0);
    const createCalls = strategy.calls.filter((c) => c.method === "create");
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].args[0], "NEW_VAR");
    assert.equal(createCalls[0].args[1], "value");
  });

  test("updates changed variables", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [
      { name: "MY_VAR", value: "old", created_at: "", updated_at: "" },
    ];
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      makeRepoConfig({ MY_VAR: "new" }),
      mockGitHubRepo,
      {}
    );
    assert.equal(result.success, true);
    assert.equal(result.changes?.update, 1);
    assert.equal(result.changes?.create, 0);
    assert.equal(result.changes?.delete, 0);
    const updateCalls = strategy.calls.filter((c) => c.method === "update");
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].args[0], "MY_VAR");
    assert.equal(updateCalls[0].args[1], "new");
  });

  test("skips unchanged variables", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [
      { name: "MY_VAR", value: "same", created_at: "", updated_at: "" },
    ];
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      makeRepoConfig({ MY_VAR: "same" }),
      mockGitHubRepo,
      {}
    );
    assert.equal(result.success, true);
    assert.equal(result.changes?.unchanged, 1);
    assert.equal(strategy.calls.filter((c) => c.method !== "list").length, 0);
  });

  test("deletes orphaned variables when deleteOrphaned is true", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [
      { name: "ORPHAN", value: "val", created_at: "", updated_at: "" },
    ];
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      makeRepoConfig({}, true),
      mockGitHubRepo,
      {}
    );
    assert.equal(result.success, true);
    assert.equal(result.changes?.delete, 1);
    const deleteCalls = strategy.calls.filter((c) => c.method === "delete");
    assert.equal(deleteCalls.length, 1);
    assert.equal(deleteCalls[0].args[0], "ORPHAN");
  });

  test("noDelete suppresses orphan deletion even with deleteOrphaned true", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [
      { name: "ORPHAN", value: "val", created_at: "", updated_at: "" },
    ];
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      makeRepoConfig({}, true),
      mockGitHubRepo,
      { noDelete: true }
    );
    assert.equal(result.success, true);
    assert.equal(result.changes?.delete, 0);
    const deleteCalls = strategy.calls.filter((c) => c.method === "delete");
    assert.equal(deleteCalls.length, 0);
  });

  test("dry run lists current state but does not mutate", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [];
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      makeRepoConfig({ NEW_VAR: "value" }),
      mockGitHubRepo,
      { dryRun: true }
    );
    assert.equal(result.dryRun, true);
    assert.equal(strategy.calls.filter((c) => c.method === "list").length, 1);
    assert.equal(strategy.calls.filter((c) => c.method !== "list").length, 0);
  });

  test("skips non-GitHub repos", async () => {
    const strategy = new MockVariablesStrategy();
    const processor = new VariablesProcessor(strategy);
    const adoRepo: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      owner: "org",
      repo: "repo",
      organization: "org",
      project: "proj",
      gitUrl: "https://dev.azure.com/org/proj/_git/repo",
    };
    const result = await processor.process(
      makeRepoConfig({ VAR: "val" }),
      adoRepo,
      {}
    );
    assert.equal(result.skipped, true);
  });

  test("skips when no variables configured", async () => {
    const strategy = new MockVariablesStrategy();
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      { git: "https://github.com/o/r.git", files: [], settings: {} },
      mockGitHubRepo,
      {}
    );
    assert.equal(result.skipped, true);
  });

  test("handles mixed create, update, and delete in one call", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [
      { name: "EXISTING", value: "old", created_at: "", updated_at: "" },
      { name: "ORPHAN", value: "val", created_at: "", updated_at: "" },
    ];
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      makeRepoConfig({ EXISTING: "new", BRAND_NEW: "fresh" }, true),
      mockGitHubRepo,
      {}
    );
    assert.equal(result.success, true);
    assert.equal(result.changes?.create, 1);
    assert.equal(result.changes?.update, 1);
    assert.equal(result.changes?.delete, 1);
    const createCalls = strategy.calls.filter((c) => c.method === "create");
    const updateCalls = strategy.calls.filter((c) => c.method === "update");
    const deleteCalls = strategy.calls.filter((c) => c.method === "delete");
    assert.equal(createCalls[0].args[0], "BRAND_NEW");
    assert.equal(updateCalls[0].args[0], "EXISTING");
    assert.equal(updateCalls[0].args[1], "new");
    assert.equal(deleteCalls[0].args[0], "ORPHAN");
  });

  test("returns failure when strategy throws", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [];
    strategy.create = async () => {
      throw new Error("API failure");
    };
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      makeRepoConfig({ NEW_VAR: "value" }),
      mockGitHubRepo,
      {}
    );
    assert.equal(result.success, false);
    assert.match(result.message, /API failure/);
  });

  test("handles empty string as valid variable value", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [];
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      makeRepoConfig({ EMPTY_VAR: "" }),
      mockGitHubRepo,
      {}
    );
    assert.equal(result.success, true);
    assert.equal(result.changes?.create, 1);
    const createCalls = strategy.calls.filter((c) => c.method === "create");
    assert.equal(createCalls[0].args[1], "");
  });

  test("deleteOrphaned only (no variable entries) still runs processor", async () => {
    const strategy = new MockVariablesStrategy();
    strategy.listResponse = [
      { name: "ORPHAN", value: "val", created_at: "", updated_at: "" },
    ];
    const processor = new VariablesProcessor(strategy);
    const result = await processor.process(
      {
        git: "https://github.com/o/r.git",
        files: [],
        settings: {
          variables: Object.assign({}, { deleteOrphaned: true }) as Record<
            string,
            string
          > & { deleteOrphaned?: boolean },
        },
      },
      mockGitHubRepo,
      {}
    );
    assert.equal(result.success, true);
    assert.equal(result.skipped, undefined);
    assert.equal(result.changes?.delete, 1);
  });
});
