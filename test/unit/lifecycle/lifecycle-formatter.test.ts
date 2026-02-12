import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatLifecycleAction } from "../../../src/lifecycle/lifecycle-formatter.js";
import type { LifecycleResult } from "../../../src/lifecycle/types.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";

describe("formatLifecycleAction", () => {
  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:my-org/my-repo.git",
    owner: "my-org",
    repo: "my-repo",
    host: "github.com",
  };

  test("formats create action", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "created",
    };

    const lines = formatLifecycleAction(result);

    assert.ok(lines.some((l) => l.includes("CREATE")));
    assert.ok(lines.some((l) => l.includes("my-org/my-repo")));
  });

  test("formats fork action with upstream", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "forked",
    };

    const lines = formatLifecycleAction(result, {
      upstream: "github.com/opensource/tool",
    });

    assert.ok(lines.some((l) => l.includes("FORK")));
    assert.ok(lines.some((l) => l.includes("opensource/tool")));
    assert.ok(lines.some((l) => l.includes("my-org/my-repo")));
  });

  test("formats migrate action with source", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "migrated",
    };

    const sourceUrl = "dev.azure.com/org/project/repo";
    const lines = formatLifecycleAction(result, {
      source: sourceUrl,
    });

    assert.ok(lines.some((l) => l.includes("MIGRATE")));
    assert.ok(lines.some((l) => l.includes(sourceUrl)));
    assert.ok(lines.some((l) => l.includes("my-org/my-repo")));
  });

  test("includes settings details when provided", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "created",
    };

    const lines = formatLifecycleAction(result, {
      settings: {
        visibility: "private",
        description: "Test repo",
      },
    });

    assert.ok(lines.some((l) => l.includes("visibility: private")));
    assert.ok(lines.some((l) => l.includes('description: "Test repo"')));
  });

  test("includes only visibility when no description", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "created",
    };

    const lines = formatLifecycleAction(result, {
      settings: { visibility: "internal" },
    });

    assert.ok(lines.some((l) => l.includes("visibility: internal")));
    assert.ok(!lines.some((l) => l.includes("description")));
  });

  test("includes only description when no visibility", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "created",
    };

    const lines = formatLifecycleAction(result, {
      settings: { description: "My repo" },
    });

    assert.ok(!lines.some((l) => l.includes("visibility")));
    assert.ok(lines.some((l) => l.includes('description: "My repo"')));
  });

  test("uses default upstream text when not provided", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "forked",
    };

    const lines = formatLifecycleAction(result);

    assert.ok(lines.some((l) => l.includes("upstream")));
  });

  test("uses default source text when not provided", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "migrated",
    };

    const lines = formatLifecycleAction(result);

    assert.ok(lines.some((l) => l.includes("source")));
  });

  test("returns empty for existed action", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "existed",
    };

    const lines = formatLifecycleAction(result);

    assert.equal(lines.length, 0);
  });
});
