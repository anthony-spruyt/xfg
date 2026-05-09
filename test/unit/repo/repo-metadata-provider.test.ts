import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubRepoMetadataProvider } from "../../../src/repo/index.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../src/repo/index.js";

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "https://github.com/test-org/test-repo.git",
  host: "github.com",
  owner: "test-org",
  repo: "test-repo",
};

class MockExecutor implements ICommandExecutor {
  result = "";
  async exec(_command: string, _cwd: string): Promise<string> {
    return this.result;
  }
}

describe("GitHubRepoMetadataProvider", () => {
  let executor: MockExecutor;
  let provider: GitHubRepoMetadataProvider;

  beforeEach(() => {
    executor = new MockExecutor();
    provider = new GitHubRepoMetadataProvider(executor, { cwd: "/tmp" });
  });

  test("returns metadata for public repo without GHAS", async () => {
    executor.result = JSON.stringify({
      visibility: "public",
      owner: { type: "Organization" },
    });

    const metadata = await provider.getMetadata(githubRepo);

    assert.equal(metadata.visibility, "public");
    assert.equal(metadata.ownerType, "Organization");
    assert.equal(metadata.hasGHAS, false);
  });

  test("detects GHAS from security_and_analysis", async () => {
    executor.result = JSON.stringify({
      visibility: "private",
      owner: { type: "Organization" },
      security_and_analysis: {
        advanced_security: { status: "enabled" },
      },
    });

    const metadata = await provider.getMetadata(githubRepo);

    assert.equal(metadata.visibility, "private");
    assert.equal(metadata.hasGHAS, true);
  });

  test("returns hasGHAS false when security_and_analysis is null", async () => {
    executor.result = JSON.stringify({
      visibility: "private",
      owner: { type: "User" },
      security_and_analysis: null,
    });

    const metadata = await provider.getMetadata(githubRepo);

    assert.equal(metadata.ownerType, "User");
    assert.equal(metadata.hasGHAS, false);
  });
});
