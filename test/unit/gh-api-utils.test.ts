import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  getHostnameFlag,
  buildTokenEnv,
  isHttp404Error,
  resolveGitHubToken,
  GhApiClient,
  parseResponseBody,
  attachRetryAfter,
  attachValidationDetails,
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
    const log = {
      debug: (msg: string) => debugMessages.push(msg),
      warn: () => {},
    };
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

  test("warns 'no fallback' when no envToken on error", async () => {
    const warnMessages: string[] = [];
    const log = {
      debug: () => {},
      warn: (msg: string) => warnMessages.push(msg),
    };
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
    assert.equal(warnMessages.length, 1);
    assert.match(warnMessages[0], /no fallback token available/);
  });
});

describe("parseResponseBody", () => {
  test("strips headers and returns body with LF separator", () => {
    const raw = [
      "HTTP/2.0 200 OK",
      "Content-Type: application/json",
      "X-Ratelimit-Remaining: 4999",
      "",
      '{"id": 1, "name": "test"}',
    ].join("\n");
    assert.equal(parseResponseBody(raw), '{"id": 1, "name": "test"}');
  });

  test("strips headers and returns body with CRLF separator", () => {
    const raw = [
      "HTTP/2.0 200 OK",
      "Content-Type: application/json",
      "",
      '{"id": 1}',
    ].join("\r\n");
    assert.equal(parseResponseBody(raw), '{"id": 1}');
  });

  test("returns full string when no blank line separator found", () => {
    const raw = '{"id": 1}';
    assert.equal(parseResponseBody(raw), '{"id": 1}');
  });

  test("handles multiline body after headers", () => {
    const raw = [
      "HTTP/2.0 200 OK",
      "Content-Type: application/json",
      "",
      "[",
      '  {"id": 1},',
      '  {"id": 2}',
      "]",
    ].join("\n");
    assert.equal(parseResponseBody(raw), '[\n  {"id": 1},\n  {"id": 2}\n]');
  });

  test("handles empty body after headers", () => {
    const raw = ["HTTP/2.0 204 No Content", "", ""].join("\n");
    assert.equal(parseResponseBody(raw), "");
  });
});

describe("attachRetryAfter", () => {
  test("parses retry-after header from string stdout", () => {
    const error = new Error("HTTP 403") as Error & {
      stdout: string;
      retryAfter?: number;
    };
    error.stdout = [
      "HTTP/2.0 403 Forbidden",
      "Retry-After: 60",
      "Content-Type: application/json",
      "",
      '{"message": "rate limit"}',
    ].join("\n");
    attachRetryAfter(error);
    assert.equal(error.retryAfter, 60);
  });

  test("parses retry-after header from Buffer stdout", () => {
    const error = new Error("HTTP 429") as Error & {
      stdout: Buffer;
      retryAfter?: number;
    };
    error.stdout = Buffer.from(
      ["HTTP/2.0 429 Too Many Requests", "retry-after: 120", "", "{}"].join(
        "\n"
      )
    );
    attachRetryAfter(error);
    assert.equal(error.retryAfter, 120);
  });

  test("is case-insensitive for header name", () => {
    const error = new Error("HTTP 403") as Error & {
      stdout: string;
      retryAfter?: number;
    };
    error.stdout = "HTTP/2.0 403\nRETRY-AFTER: 45\n\n{}";
    attachRetryAfter(error);
    assert.equal(error.retryAfter, 45);
  });

  test("is a no-op when stdout is absent", () => {
    const error = new Error("HTTP 403") as Error & { retryAfter?: number };
    attachRetryAfter(error);
    assert.equal(error.retryAfter, undefined);
  });

  test("is a no-op when no retry-after header in stdout", () => {
    const error = new Error("HTTP 403") as Error & {
      stdout: string;
      retryAfter?: number;
    };
    error.stdout = "HTTP/2.0 403\nContent-Type: application/json\n\n{}";
    attachRetryAfter(error);
    assert.equal(error.retryAfter, undefined);
  });

  test("ignores non-numeric retry-after values", () => {
    const error = new Error("HTTP 403") as Error & {
      stdout: string;
      retryAfter?: number;
    };
    error.stdout =
      "HTTP/2.0 403\nRetry-After: Thu, 01 Jan 2099 00:00:00 GMT\n\n{}";
    attachRetryAfter(error);
    assert.equal(error.retryAfter, undefined);
  });
});

describe("attachValidationDetails", () => {
  test("extracts GitHub validation error message from stdout", () => {
    const error = new Error("Validation Failed (HTTP 422)") as Error & {
      stdout?: string;
    };
    error.stdout =
      'HTTP/2.0 422 Unprocessable Entity\nContent-Type: application/json\n\n{"message":"Validation Failed","errors":[{"message":"The branch main was not found.","resource":"Repository","field":"default_branch","code":"invalid"}]}';
    attachValidationDetails(error);
    assert.match(error.message, /The branch main was not found/);
  });

  test("handles multiple validation errors", () => {
    const error = new Error("Validation Failed (HTTP 422)") as Error & {
      stdout?: string;
    };
    error.stdout =
      'HTTP/2.0 422\n\n{"message":"Validation Failed","errors":[{"message":"error one","resource":"R","field":"f1","code":"invalid"},{"message":"error two","resource":"R","field":"f2","code":"invalid"}]}';
    attachValidationDetails(error);
    assert.match(error.message, /error one/);
    assert.match(error.message, /error two/);
  });

  test("no-op when stdout is absent", () => {
    const error = new Error("Validation Failed (HTTP 422)");
    attachValidationDetails(error);
    assert.equal(error.message, "Validation Failed (HTTP 422)");
  });

  test("no-op when stdout has no parseable JSON body", () => {
    const error = new Error("Validation Failed (HTTP 422)") as Error & {
      stdout?: string;
    };
    error.stdout = "HTTP/2.0 422\n\nnot json";
    attachValidationDetails(error);
    assert.equal(error.message, "Validation Failed (HTTP 422)");
  });

  test("handles message-only response (no errors array)", () => {
    const error = new Error("Validation Failed (HTTP 422)") as Error & {
      stdout?: string;
    };
    error.stdout = 'HTTP/2.0 422\n\n{"message":"Something went wrong"}';
    attachValidationDetails(error);
    assert.match(error.message, /Something went wrong/);
  });
});

describe("GhApiClient", () => {
  test("includes --include flag for non-paginated GET and strips headers", async () => {
    const calls: { command: string; cwd: string }[] = [];
    const executor = {
      exec: async (command: string, cwd: string) => {
        calls.push({ command, cwd });
        return 'HTTP/2.0 200 OK\nContent-Type: application/json\n\n{"ok": true}';
      },
    };
    const client = new GhApiClient(executor as never, 0, "/tmp");
    const result = await client.call("GET", "/repos/owner/repo");
    assert.equal(calls.length, 1);
    assert.match(calls[0].command, /--include/);
    assert.match(calls[0].command, /repos\/owner\/repo/);
    assert.equal(calls[0].cwd, "/tmp");
    assert.equal(result, '{"ok": true}');
  });

  test("skips --include flag for paginated requests", async () => {
    const calls: string[] = [];
    const executor = {
      exec: async (command: string) => {
        calls.push(command);
        return '[{"id": 1}, {"id": 2}]';
      },
    };
    const client = new GhApiClient(executor as never, 0, "/tmp");
    const result = await client.call("GET", "/repos/owner/repo/labels", {
      paginate: true,
    });
    assert.equal(calls.length, 1);
    assert.ok(
      !calls[0].includes("--include"),
      "Should NOT have --include with --paginate"
    );
    assert.match(calls[0], /--paginate/);
    assert.equal(result, '[{"id": 1}, {"id": 2}]');
  });

  test("adds -X flag for non-GET methods and strips headers", async () => {
    const calls: string[] = [];
    const executor = {
      exec: async (command: string) => {
        calls.push(command);
        return "HTTP/2.0 201 Created\n\n{}";
      },
    };
    const client = new GhApiClient(executor as never, 0, "/tmp");
    await client.call("POST", "/repos/owner/repo", {
      payload: { key: "value" },
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /-X POST/);
    assert.match(calls[0], /--input -/);
    assert.match(calls[0], /--include/);
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
        return "HTTP/2.0 200 OK\n\n{}";
      },
    };
    const client = new GhApiClient(executor as never, 0, "/tmp");
    await client.call("GET", "/test", {
      options: { token: "secret-token" },
    });
    assert.deepEqual(passedEnv, { GH_TOKEN: "secret-token" });
  });

  test("attaches retryAfter on failure and retries successfully", async () => {
    const delaysCalled: number[] = [];
    const noOpDelay = async (ms: number) => {
      delaysCalled.push(ms);
    };

    let attempts = 0;
    const executor = {
      exec: async () => {
        attempts++;
        if (attempts < 2) {
          const error = new Error("HTTP 403: rate limit exceeded") as Error & {
            stdout: string;
          };
          error.stdout =
            'HTTP/2.0 403 Forbidden\nRetry-After: 30\n\n{"message": "rate limit"}';
          throw error;
        }
        return "HTTP/2.0 200 OK\n\n{}";
      },
    };
    const client = new GhApiClient(executor as never, 1, "/tmp");
    const result = await client.call("GET", "/test", {
      _retryDelay: noOpDelay,
    });
    assert.equal(result, "{}");
    assert.equal(attempts, 2);
    assert.deepEqual(delaysCalled, [30_000]);
  });
});
