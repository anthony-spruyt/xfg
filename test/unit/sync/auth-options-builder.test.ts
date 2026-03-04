import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { AuthOptionsBuilder } from "../../../src/sync/auth-options-builder.js";
import { createMockLogger } from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import type { GitHubAppTokenManager } from "../../../src/vcs/github-app-token-manager.js";

/** Mock token manager - only needs getTokenForRepo method */
type MockTokenManager = Pick<GitHubAppTokenManager, "getTokenForRepo">;

describe("AuthOptionsBuilder", () => {
  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test/repo.git",
    owner: "test",
    repo: "repo",
    host: "github.com",
  };

  describe("resolve", () => {
    test("returns token and auth options when token manager provides token", async () => {
      const { mock: mockLogger } = createMockLogger();
      const mockTokenManager: MockTokenManager = {
        getTokenForRepo: async () => "installation-token-123",
      };

      const builder = new AuthOptionsBuilder(
        mockTokenManager as GitHubAppTokenManager,
        mockLogger
      );
      const result = await builder.resolve(mockRepoInfo, "test/repo");

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.token, "installation-token-123");
      assert.ok(result.ok && result.authOptions);
      if (result.ok && result.authOptions) {
        assert.equal(result.authOptions.token, "installation-token-123");
        assert.equal(result.authOptions.host, "github.com");
        assert.equal(result.authOptions.owner, "test");
        assert.equal(result.authOptions.repo, "repo");
      }
    });

    test("returns skip result when no installation found (null token)", async () => {
      const { mock: mockLogger } = createMockLogger();
      const mockTokenManager: MockTokenManager = {
        getTokenForRepo: async () => null,
      };

      const builder = new AuthOptionsBuilder(
        mockTokenManager as GitHubAppTokenManager,
        mockLogger
      );
      const result = await builder.resolve(mockRepoInfo, "test/repo");

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.skipResult.success, true);
        assert.equal(result.skipResult.skipped, true);
        assert.ok(
          result.skipResult.message.includes("No GitHub App installation")
        );
      }
    });

    test("falls back to GH_TOKEN when no token manager", async () => {
      const { mock: mockLogger } = createMockLogger();
      const originalToken = process.env.GH_TOKEN;
      process.env.GH_TOKEN = "pat-token-456";

      try {
        const builder = new AuthOptionsBuilder(null, mockLogger);
        const result = await builder.resolve(mockRepoInfo, "test/repo");

        assert.equal(result.ok, true);
        assert.equal(result.ok && result.token, "pat-token-456");
        assert.ok(result.ok && result.authOptions);
        if (result.ok && result.authOptions) {
          assert.equal(result.authOptions.token, "pat-token-456");
        }
      } finally {
        if (originalToken === undefined) {
          delete process.env.GH_TOKEN;
        } else {
          process.env.GH_TOKEN = originalToken;
        }
      }
    });

    test("logs warning and returns undefined on token fetch error", async () => {
      const { mock: mockLogger, warnings } = createMockLogger();
      const mockTokenManager: MockTokenManager = {
        getTokenForRepo: async () => {
          throw new Error("API error");
        },
      };

      const builder = new AuthOptionsBuilder(
        mockTokenManager as GitHubAppTokenManager,
        mockLogger
      );
      const result = await builder.resolve(mockRepoInfo, "test/repo");

      // Should log warning via logger.warn()
      assert.ok(warnings.some((msg) => msg.includes("API error")));
      // Should succeed with graceful degradation (no skip)
      assert.equal(result.ok, true);
    });

    test("returns undefined token for non-GitHub repos without token manager", async () => {
      const { mock: mockLogger } = createMockLogger();
      const adoRepoInfo = {
        type: "azure-devops" as const,
        gitUrl: "git@ssh.dev.azure.com:v3/org/project/repo",
        owner: "org",
        organization: "org",
        repo: "repo",
        project: "project",
      };

      const builder = new AuthOptionsBuilder(null, mockLogger);
      const result = await builder.resolve(adoRepoInfo, "org/project/repo");

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.token, undefined);
        assert.equal(result.authOptions, undefined);
      }
    });
  });
});
