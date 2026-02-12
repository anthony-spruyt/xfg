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

    const lines = formatLifecycleAction(result, {
      source: "dev.azure.com/org/project/repo",
    });

    assert.ok(lines.some((l) => l.includes("MIGRATE")));
    assert.ok(lines.some((l) => l.includes("dev.azure.com")));
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

  test("returns empty for existed action", () => {
    const result: LifecycleResult = {
      repoInfo: mockRepoInfo,
      action: "existed",
    };

    const lines = formatLifecycleAction(result);

    assert.equal(lines.length, 0);
  });
});
