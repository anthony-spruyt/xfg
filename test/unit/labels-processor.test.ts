import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { LabelsProcessor } from "../../src/settings/labels/processor.js";
import type { RepoConfig } from "../../src/config/index.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../src/shared/repo-detector.js";
import type {
  GitHubLabel,
  ILabelsStrategy,
} from "../../src/settings/labels/types.js";

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
  org: "test-org",
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

    const result = await processor.process(config, mockAzureRepo, {
      configId: "test",
      managedLabels: [],
    });

    assert.equal(result.skipped, true);
    assert.equal(mockStrategy.calls.length, 0);
  });

  test("creates new labels", async () => {
    mockStrategy.listResponse = [];
    const config = makeRepoConfig({
      bug: { color: "d73a4a", description: "Something isn't working" },
    });

    const result = await processor.process(config, mockGitHubRepo, {
      configId: "test",
      managedLabels: [],
    });

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
      configId: "test",
      managedLabels: [],
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

    const result = await processor.process(config, mockGitHubRepo, {
      configId: "test",
      managedLabels: ["delete-me", "update-me"],
    });

    assert.equal(result.success, true);

    // Check ordering: delete first, then update, then create
    const mutationCalls = mockStrategy.calls.filter((c) => c.method !== "list");
    assert.equal(mutationCalls.length, 3);
    assert.equal(mutationCalls[0].method, "delete");
    assert.equal(mutationCalls[1].method, "update");
    assert.equal(mutationCalls[2].method, "create");
  });

  test("returns manifest update when deleteOrphaned is true", async () => {
    mockStrategy.listResponse = [];
    const config = makeRepoConfig({ bug: { color: "d73a4a" } }, true);

    const result = await processor.process(config, mockGitHubRepo, {
      configId: "test",
      managedLabels: [],
    });

    assert.ok(result.manifestUpdate);
    assert.deepEqual(result.manifestUpdate.labels, ["bug"]);
  });

  test("returns no manifest update when deleteOrphaned is false", async () => {
    mockStrategy.listResponse = [];
    const config = makeRepoConfig({ bug: { color: "d73a4a" } }, false);

    const result = await processor.process(config, mockGitHubRepo, {
      configId: "test",
      managedLabels: [],
    });

    assert.equal(result.manifestUpdate, undefined);
  });

  test("handles API errors gracefully", async () => {
    mockStrategy.shouldThrow = new Error("API rate limit exceeded");
    const config = makeRepoConfig({ bug: { color: "d73a4a" } });

    const result = await processor.process(config, mockGitHubRepo, {
      configId: "test",
      managedLabels: [],
    });

    assert.equal(result.success, false);
    assert.ok(result.message.includes("API rate limit exceeded"));
  });
});
