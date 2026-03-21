import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  getHostnameFlag,
  buildTokenEnv,
  isHttp404Error,
  resolveGitHubToken,
  GhApiClient,
} from "../../src/shared/gh-api-utils.js";
import { parseApiJson } from "../../src/shared/json-utils.js";
import type { GitHubRepoInfo } from "../../src/shared/repo-detector.js";

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

describe("getHostnameFlag", () => {
  test("returns empty string for github.com", () => {
    const result = getHostnameFlag(makeRepoInfo());
    assert.equal(result, "");
  });

  test("returns --hostname flag for GHE", () => {
    const result = getHostnameFlag(makeRepoInfo({ host: "ghe.example.com" }));
    assert.equal(result, "--hostname 'ghe.example.com'");
  });
});

describe("buildTokenEnv", () => {
  test("returns GH_TOKEN env when token provided", () => {
    const result = buildTokenEnv("my-token");
    assert.deepEqual(result, { GH_TOKEN: "my-token" });
  });

  test("returns undefined when no token", () => {
    assert.equal(buildTokenEnv(undefined), undefined);
    assert.equal(buildTokenEnv(), undefined);
  });
});

describe("isHttp404Error", () => {
  test("returns true for HTTP 404 error message", () => {
    assert.equal(isHttp404Error(new Error("HTTP 404: Not Found")), true);
  });

  test("returns false for other errors", () => {
    assert.equal(isHttp404Error(new Error("HTTP 500: Server Error")), false);
  });

  test("returns false for non-error values", () => {
    assert.equal(isHttp404Error("some string"), false);
    assert.equal(isHttp404Error(null), false);
  });

  test("returns true for string containing HTTP 404", () => {
    assert.equal(isHttp404Error(new Error("got HTTP 404 from API")), true);
  });
});

describe("parseApiJson", () => {
  test("parses valid JSON", () => {
    const result = parseApiJson<{ foo: string }>(
      '{"foo": "bar"}',
      "test response"
    );
    assert.deepEqual(result, { foo: "bar" });
  });

  test("throws SyncError for invalid JSON", () => {
    assert.throws(
      () => parseApiJson("not json{", "test response"),
      (error: Error) => {
        assert.match(error.message, /Failed to parse test response/);
        assert.match(error.message, /not json\{/);
        return true;
      }
    );
  });

  test("includes preview of response in error", () => {
    const longResponse = "x".repeat(300);
    assert.throws(
      () => parseApiJson(longResponse, "long response"),
      (error: Error) => {
        // Preview should be truncated to 200 chars
        assert.match(error.message, /Failed to parse long response/);
        return true;
      }
    );
  });
});

describe("resolveGitHubToken", () => {
  const repoInfo = makeRepoInfo();

  test("returns app token when available", async () => {
    const tokenManager = {
      getTokenForRepo: async () => "app-token-123",
    };
    const result = await resolveGitHubToken({
      repoInfo,
      tokenManager,
      context: "test-context",
    });
    assert.deepEqual(result, { token: "app-token-123", skipped: false });
  });

  test("returns skipped when no installation found (null)", async () => {
    const tokenManager = {
      getTokenForRepo: async () => null,
    };
    const result = await resolveGitHubToken({
      repoInfo,
      tokenManager,
      context: "test-context",
    });
    assert.deepEqual(result, { token: undefined, skipped: true });
  });

  test("falls back to envToken when no token manager", async () => {
    const result = await resolveGitHubToken({
      repoInfo,
      tokenManager: null,
      context: "test-context",
      envToken: "env-token",
    });
    assert.deepEqual(result, { token: "env-token", skipped: false });
  });

  test("falls back to envToken on error", async () => {
    const tokenManager = {
      getTokenForRepo: async () => {
        throw new Error("auth failed");
      },
    };
    const result = await resolveGitHubToken({
      repoInfo,
      tokenManager,
      context: "test-context",
      envToken: "fallback-token",
    });
    assert.deepEqual(result, { token: "fallback-token", skipped: false });
  });

  test("returns undefined token on error without fallback", async () => {
    const tokenManager = {
      getTokenForRepo: async () => {
        throw new Error("auth failed");
      },
    };
    const result = await resolveGitHubToken({
      repoInfo,
      tokenManager,
      context: "test-context",
    });
    assert.deepEqual(result, { token: undefined, skipped: false });
  });

  test("logs debug message on error", async () => {
    const debugMessages: string[] = [];
    const log = { debug: (msg: string) => debugMessages.push(msg) };
    const tokenManager = {
      getTokenForRepo: async () => {
        throw new Error("auth failed");
      },
    };
    await resolveGitHubToken({
      repoInfo,
      tokenManager,
      context: "my-repo",
      log,
      envToken: "fallback",
    });
    assert.equal(debugMessages.length, 1);
    assert.match(debugMessages[0], /auth failed/);
    assert.match(debugMessages[0], /my-repo/);
    assert.match(debugMessages[0], /falling back to GH_TOKEN/);
  });

  test("logs 'no fallback' when no envToken on error", async () => {
    const debugMessages: string[] = [];
    const log = { debug: (msg: string) => debugMessages.push(msg) };
    const tokenManager = {
      getTokenForRepo: async () => {
        throw new Error("auth failed");
      },
    };
    await resolveGitHubToken({
      repoInfo,
      tokenManager,
      context: "my-repo",
      log,
    });
    assert.match(debugMessages[0], /no fallback token available/);
  });
});

describe("GhApiClient", () => {
  test("delegates GET call to executor", async () => {
    const calls: { command: string; cwd: string }[] = [];
    const executor = {
      exec: async (command: string, cwd: string) => {
        calls.push({ command, cwd });
        return '{"ok": true}';
      },
    };
    const client = new GhApiClient(executor as never, 0, "/tmp");
    const result = await client.call("GET", "/repos/owner/repo");
    assert.equal(calls.length, 1);
    assert.match(calls[0].command, /gh api/);
    assert.match(calls[0].command, /repos\/owner\/repo/);
    assert.equal(calls[0].cwd, "/tmp");
    assert.equal(result, '{"ok": true}');
  });

  test("adds -X flag for non-GET methods", async () => {
    const calls: string[] = [];
    const executor = {
      exec: async (command: string) => {
        calls.push(command);
        return "{}";
      },
    };
    const client = new GhApiClient(executor as never, 0, "/tmp");
    await client.call("POST", "/repos/owner/repo", {
      payload: { key: "value" },
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /-X POST/);
    assert.match(calls[0], /--input -/);
  });

  test("passes token via env", async () => {
    let passedEnv: Record<string, string> | undefined;
    const executor = {
      exec: async (
        _cmd: string,
        _cwd: string,
        opts?: { env?: Record<string, string> }
      ) => {
        passedEnv = opts?.env;
        return "{}";
      },
    };
    const client = new GhApiClient(executor as never, 0, "/tmp");
    await client.call("GET", "/test", {
      options: { token: "secret-token" },
    });
    assert.deepEqual(passedEnv, { GH_TOKEN: "secret-token" });
  });
});
