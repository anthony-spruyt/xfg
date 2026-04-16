import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { LabelsProcessor } from "../../../../src/settings/labels/processor.js";
import type { RepoConfig } from "../../../../src/config/index.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../../../src/repo/index.js";
import type {
  GitHubLabel,
  ILabelsStrategy,
} from "../../../../src/settings/labels/types.js";

// Mock strategy that tracks calls and returns configured responses
class MockLabelsStrategy implements ILabelsStrategy {
  calls: { method: string; args: unknown[] }[] = [];
  listResponse: GitHubLabel[] = [];
  shouldThrow: Error | null = null;

  async list(): Promise<GitHubLabel[]> {
    this.calls.push({ method: "list", args: [] });
    if (this.shouldThrow) throw this.shouldThrow;
    return this.listResponse;
  }

  async create(
    _repo: GitHubRepoInfo,
    label: { name: string; color: string; description?: string }
  ): Promise<void> {
    this.calls.push({ method: "create", args: [label] });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async update(
    _repo: GitHubRepoInfo,
    currentName: string,
    label: { new_name?: string; color?: string; description?: string }
  ): Promise<void> {
    this.calls.push({ method: "update", args: [currentName, label] });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  async delete(_repo: GitHubRepoInfo, name: string): Promise<void> {
    this.calls.push({ method: "delete", args: [name] });
    if (this.shouldThrow) throw this.shouldThrow;
  }

  reset(): void {
    this.calls = [];
    this.listResponse = [];
    this.shouldThrow = null;
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
  gitUrl: "https://dev.azure.com/test-org/test-project/_git/test-repo",
};

function makeRepoConfig(
  labels: Record<
    string,
    { color: string; description?: string; new_name?: string }
  >,
  deleteOrphaned = false
): RepoConfig {
  return {
    git: "git@github.com:test-org/test-repo.git",
    files: [],
    settings: {
      labels,
      deleteOrphaned,
    },
  };
}

describe("LabelsProcessor", () => {
  let mockStrategy: MockLabelsStrategy;
  let processor: LabelsProcessor;

  beforeEach(() => {
    mockStrategy = new MockLabelsStrategy();
    processor = new LabelsProcessor(mockStrategy as unknown as ILabelsStrategy);
  });

  test("skips non-GitHub repos", async () => {
    const config = makeRepoConfig({ bug: { color: "d73a4a" } });

    const result = await processor.process(config, mockAzureRepo, {});

    assert.equal(result.skipped, true);
    assert.equal(mockStrategy.calls.length, 0);
  });

  test("creates new labels", async () => {
    mockStrategy.listResponse = [];
    const config = makeRepoConfig({
      bug: { color: "d73a4a", description: "Something isn't working" },
    });

    const result = await processor.process(config, mockGitHubRepo, {});

    assert.equal(result.success, true);
    assert.equal(result.changes?.create, 1);
    const createCalls = mockStrategy.calls.filter((c) => c.method === "create");
    assert.equal(createCalls.length, 1);
  });

  test("dry run does not call strategy mutations", async () => {
    mockStrategy.listResponse = [];
    const config = makeRepoConfig({
      bug: { color: "d73a4a" },
    });

    const result = await processor.process(config, mockGitHubRepo, {
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.changes?.create, 1);
    // Only list call, no create/update/delete
    const mutationCalls = mockStrategy.calls.filter((c) => c.method !== "list");
    assert.equal(mutationCalls.length, 0);
  });

  test("applies changes in correct order: deletes, updates, creates", async () => {
    mockStrategy.listResponse = [
      {
        id: 1,
        name: "delete-me",
        color: "cccccc",
        description: null,
        default: false,
      },
      {
        id: 2,
        name: "update-me",
        color: "aaaaaa",
        description: null,
        default: false,
      },
    ];
    const config = makeRepoConfig(
      {
        "update-me": { color: "ffffff" },
        "create-me": { color: "000000" },
      },
      true
    );

    const result = await processor.process(config, mockGitHubRepo, {});

    assert.equal(result.success, true);

    // Check ordering: delete first, then update, then create
    const mutationCalls = mockStrategy.calls.filter((c) => c.method !== "list");
    assert.equal(mutationCalls.length, 3);
    assert.equal(mutationCalls[0].method, "delete");
    assert.equal(mutationCalls[1].method, "update");
    assert.equal(mutationCalls[2].method, "create");
  });

  test("handles API errors gracefully", async () => {
    mockStrategy.shouldThrow = new Error("API rate limit exceeded");
    const config = makeRepoConfig({ bug: { color: "d73a4a" } });

    const result = await processor.process(config, mockGitHubRepo, {});

    assert.equal(result.success, false);
    assert.ok(result.message.includes("API rate limit exceeded"));
  });

  test("handles non-Error thrown objects gracefully", async () => {
    mockStrategy.shouldThrow = "string error" as unknown as Error;
    const config = makeRepoConfig({ bug: { color: "d73a4a" } });

    const result = await processor.process(config, mockGitHubRepo, {});

    assert.equal(result.success, false);
    assert.ok(result.message.includes("string error"));
  });

  test("skips when no labels configured", async () => {
    const config: RepoConfig = {
      git: "git@github.com:test-org/test-repo.git",
      files: [],
      settings: {
        labels: {},
      },
    };

    const result = await processor.process(config, mockGitHubRepo, {});

    assert.equal(result.skipped, true);
    assert.equal(result.message, "No labels configured");
  });

  test("noDelete prevents delete calls during apply", async () => {
    mockStrategy.listResponse = [
      {
        id: 1,
        name: "orphaned",
        color: "cccccc",
        description: null,
        default: false,
      },
    ];
    const config = makeRepoConfig(
      { bug: { color: "d73a4a" } },
      true // deleteOrphaned
    );

    const result = await processor.process(config, mockGitHubRepo, {
      noDelete: true,
    });

    assert.equal(result.success, true);
    const deleteCalls = mockStrategy.calls.filter((c) => c.method === "delete");
    assert.equal(
      deleteCalls.length,
      0,
      "should not call delete when noDelete is true"
    );
  });

  test("applies update with new_name property change", async () => {
    mockStrategy.listResponse = [
      {
        id: 1,
        name: "bug",
        color: "d73a4a",
        description: null,
        default: false,
      },
    ];
    const config = makeRepoConfig({
      bug: { color: "d73a4a", new_name: "defect" },
    });

    const result = await processor.process(config, mockGitHubRepo, {});

    assert.equal(result.success, true);
    assert.equal(result.changes?.update, 1);
    const updateCalls = mockStrategy.calls.filter((c) => c.method === "update");
    assert.equal(updateCalls.length, 1);
    const updatePayload = updateCalls[0].args[1] as { new_name?: string };
    assert.equal(updatePayload.new_name, "defect");
  });

  test("reports no changes needed when all labels are unchanged", async () => {
    mockStrategy.listResponse = [
      {
        id: 1,
        name: "bug",
        color: "d73a4a",
        description: null,
        default: false,
      },
    ];
    const config = makeRepoConfig({ bug: { color: "d73a4a" } });

    const result = await processor.process(config, mockGitHubRepo, {});

    assert.equal(result.success, true);
    assert.equal(result.message, "No changes needed");
    assert.equal(result.changes?.unchanged, 1);
  });

  test("includes planOutput in result", async () => {
    mockStrategy.listResponse = [];
    const config = makeRepoConfig({ bug: { color: "d73a4a" } });

    const result = await processor.process(config, mockGitHubRepo, {});

    assert.ok(result.planOutput);
    assert.equal(result.planOutput.creates, 1);
  });

  test("creates label without description", async () => {
    mockStrategy.listResponse = [];
    const config = makeRepoConfig({
      bug: { color: "d73a4a" },
    });

    const result = await processor.process(config, mockGitHubRepo, {});

    assert.equal(result.success, true);
    assert.equal(result.changes?.create, 1);
    const createCalls = mockStrategy.calls.filter((c) => c.method === "create");
    assert.equal(createCalls.length, 1);
    const payload = createCalls[0].args[0] as {
      name: string;
      color: string;
      description?: string;
    };
    assert.equal(payload.description, undefined);
  });

  test("updates label description property", async () => {
    mockStrategy.listResponse = [
      {
        id: 1,
        name: "bug",
        color: "d73a4a",
        description: "Old description",
        default: false,
      },
    ];
    const config = makeRepoConfig({
      bug: { color: "d73a4a", description: "New description" },
    });

    const result = await processor.process(config, mockGitHubRepo, {});

    assert.equal(result.success, true);
    assert.equal(result.changes?.update, 1);
    const updateCalls = mockStrategy.calls.filter((c) => c.method === "update");
    assert.equal(updateCalls.length, 1);
    const payload = updateCalls[0].args[1] as { description?: string };
    assert.equal(payload.description, "New description");
  });
});
