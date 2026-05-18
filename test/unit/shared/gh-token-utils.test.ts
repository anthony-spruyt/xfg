import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveGitHubToken,
  isHttp404Error,
} from "../../../src/shared/gh-token-utils.js";
import type { GitHubRepoInfo } from "../../../src/repo/index.js";

function makeRepoInfo(overrides: Partial<GitHubRepoInfo> = {}): GitHubRepoInfo {
  return {
    type: "github",
    gitUrl: "https://github.com/test-owner/test-repo.git",
    repo: "test-repo",
    owner: "test-owner",
    host: "github.com",
    ...overrides,
  };
}

describe("resolveGitHubToken", () => {
  const repoInfo = makeRepoInfo();

  describe("token from token manager (GitHub App path)", () => {
    test("returns app token when token manager resolves a token", async () => {
      const tokenManager = {
        getTokenForRepo: async () => "app-token-123",
      };
      const result = await resolveGitHubToken({
        repoInfo,
        tokenManager,
        context: "test-repo",
      });
      assert.deepStrictEqual(result, {
        token: "app-token-123",
        skipped: false,
      });
    });

    test("prefers app token over envToken when both are available", async () => {
      const tokenManager = {
        getTokenForRepo: async () => "app-token",
      };
      const result = await resolveGitHubToken({
        repoInfo,
        tokenManager,
        context: "test-repo",
        envToken: "env-token",
      });
      assert.deepStrictEqual(result, { token: "app-token", skipped: false });
    });

    test("returns skipped when token manager returns null (no installation)", async () => {
      const tokenManager = {
        getTokenForRepo: async () => null,
      };
      const result = await resolveGitHubToken({
        repoInfo,
        tokenManager,
        context: "test-repo",
        envToken: "env-token",
      });
      assert.deepStrictEqual(result, { token: undefined, skipped: true });
    });
  });

  describe("env var fallback", () => {
    test("falls back to envToken when token manager is null", async () => {
      const result = await resolveGitHubToken({
        repoInfo,
        tokenManager: null,
        context: "test-repo",
        envToken: "env-fallback-token",
      });
      assert.deepStrictEqual(result, {
        token: "env-fallback-token",
        skipped: false,
      });
    });

    test("falls back to envToken when token manager throws", async () => {
      const tokenManager = {
        getTokenForRepo: async () => {
          throw new Error("GitHub App auth failed");
        },
      };
      const result = await resolveGitHubToken({
        repoInfo,
        tokenManager,
        context: "test-repo",
        envToken: "fallback-token",
      });
      assert.deepStrictEqual(result, {
        token: "fallback-token",
        skipped: false,
      });
    });

    test("logs debug when falling back to envToken on error", async () => {
      const debugMessages: string[] = [];
      const log = {
        debug: (msg: string) => debugMessages.push(msg),
        warn: () => {},
      };
      const tokenManager = {
        getTokenForRepo: async () => {
          throw new Error("connection timeout");
        },
      };
      await resolveGitHubToken({
        repoInfo,
        tokenManager,
        context: "my-org/my-repo",
        log,
        envToken: "fallback",
      });
      assert.equal(debugMessages.length, 1);
      assert.match(debugMessages[0], /connection timeout/);
      assert.match(debugMessages[0], /my-org\/my-repo/);
      assert.match(debugMessages[0], /falling back to GH_TOKEN/);
    });
  });

  describe("no token available", () => {
    test("returns undefined token when no token manager and no envToken", async () => {
      const result = await resolveGitHubToken({
        repoInfo,
        tokenManager: null,
        context: "test-repo",
      });
      assert.deepStrictEqual(result, { token: undefined, skipped: false });
    });

    test("returns undefined token when token manager throws and no envToken", async () => {
      const tokenManager = {
        getTokenForRepo: async () => {
          throw new Error("auth failure");
        },
      };
      const result = await resolveGitHubToken({
        repoInfo,
        tokenManager,
        context: "test-repo",
      });
      assert.deepStrictEqual(result, { token: undefined, skipped: false });
    });

    test("logs warn when token manager throws and no envToken", async () => {
      const warnMessages: string[] = [];
      const log = {
        debug: () => {},
        warn: (msg: string) => warnMessages.push(msg),
      };
      const tokenManager = {
        getTokenForRepo: async () => {
          throw new Error("auth failure");
        },
      };
      await resolveGitHubToken({
        repoInfo,
        tokenManager,
        context: "my-repo",
        log,
      });
      assert.equal(warnMessages.length, 1);
      assert.match(warnMessages[0], /no fallback token available/);
    });
  });
});

describe("isHttp404Error", () => {
  test("returns true for Error with HTTP 404 message", () => {
    assert.equal(isHttp404Error(new Error("HTTP 404: Not Found")), true);
  });

  test("returns true for Error containing HTTP 404 substring", () => {
    assert.equal(
      isHttp404Error(new Error("Request failed: HTTP 404 from API")),
      true
    );
  });

  test("returns false for other HTTP error codes", () => {
    assert.equal(isHttp404Error(new Error("HTTP 500: Server Error")), false);
    assert.equal(isHttp404Error(new Error("HTTP 403: Forbidden")), false);
  });

  test("returns false for non-error values", () => {
    assert.equal(isHttp404Error("some string"), false);
    assert.equal(isHttp404Error(null), false);
    assert.equal(isHttp404Error(undefined), false);
    assert.equal(isHttp404Error(42), false);
  });
});
