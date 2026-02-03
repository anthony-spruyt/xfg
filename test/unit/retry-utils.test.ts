import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  isPermanentError,
  isTransientError,
  withRetry,
  promisify,
} from "../../src/retry-utils.js";

describe("isPermanentError", () => {
  test("returns true for permission denied", () => {
    const error = new Error("Permission denied (publickey)");
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for authentication failed", () => {
    const error = new Error("Authentication failed for repository");
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for bad credentials", () => {
    const error = new Error("Bad credentials");
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for 401 status", () => {
    const error = new Error("HTTP 401 Unauthorized");
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for 404 status", () => {
    const error = new Error("HTTP 404 Not Found");
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for repository not found", () => {
    const error = new Error("Repository not found");
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for not a git repository", () => {
    const error = new Error("fatal: not a git repository");
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for non-fast-forward", () => {
    const error = new Error("error: non-fast-forward updates were rejected");
    assert.equal(isPermanentError(error), true);
  });

  test("returns false for timeout", () => {
    const error = new Error("Connection timed out");
    assert.equal(isPermanentError(error), false);
  });

  test("returns false for network error", () => {
    const error = new Error("ECONNRESET");
    assert.equal(isPermanentError(error), false);
  });

  test("checks stderr if present", () => {
    const error = new Error("Command failed") as Error & { stderr: string };
    error.stderr = "fatal: Authentication failed";
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for GH_TOKEN environment variable error", () => {
    const error = new Error(
      "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable"
    );
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for GITHUB_TOKEN environment variable error", () => {
    const error = new Error(
      "error: GITHUB_TOKEN environment variable is required"
    );
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for AZURE_DEVOPS_EXT_PAT environment variable error", () => {
    const error = new Error(
      "az: To use Azure CLI, set the AZURE_DEVOPS_EXT_PAT environment variable"
    );
    assert.equal(isPermanentError(error), true);
  });

  test("returns true for GITLAB_TOKEN environment variable error", () => {
    const error = new Error("glab: GITLAB_TOKEN environment variable not set");
    assert.equal(isPermanentError(error), true);
  });
});

describe("isTransientError", () => {
  test("returns true for timeout", () => {
    const error = new Error("Connection timed out");
    assert.equal(isTransientError(error), true);
  });

  test("returns true for ETIMEDOUT", () => {
    const error = new Error("ETIMEDOUT");
    assert.equal(isTransientError(error), true);
  });

  test("returns true for ECONNRESET", () => {
    const error = new Error("ECONNRESET");
    assert.equal(isTransientError(error), true);
  });

  test("returns true for ECONNREFUSED", () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:443");
    assert.equal(isTransientError(error), true);
  });

  test("returns true for rate limit", () => {
    const error = new Error("API rate limit exceeded");
    assert.equal(isTransientError(error), true);
  });

  test("returns true for 429 status", () => {
    const error = new Error("HTTP 429 Too Many Requests");
    assert.equal(isTransientError(error), true);
  });

  test("returns true for 503 status", () => {
    const error = new Error("HTTP 503 Service Unavailable");
    assert.equal(isTransientError(error), true);
  });

  test("returns true for connection reset", () => {
    const error = new Error("connection reset by peer");
    assert.equal(isTransientError(error), true);
  });

  test("returns true for could not resolve host", () => {
    const error = new Error("Could not resolve host: github.com");
    assert.equal(isTransientError(error), true);
  });

  test("returns false for permanent error", () => {
    const error = new Error("Permission denied");
    assert.equal(isTransientError(error), false);
  });

  test("returns false for unknown error", () => {
    const error = new Error("Some random error");
    assert.equal(isTransientError(error), false);
  });
});

describe("withRetry", () => {
  test("returns result on first success", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return "success";
    });
    assert.equal(result, "success");
    assert.equal(attempts, 1);
  });

  test("retries on transient error and succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Connection timed out");
        }
        return "success";
      },
      { retries: 3 }
    );
    assert.equal(result, "success");
    assert.equal(attempts, 3);
  });

  test("stops immediately on permanent error", async () => {
    let attempts = 0;
    await assert.rejects(async () => {
      await withRetry(
        async () => {
          attempts++;
          throw new Error("Permission denied");
        },
        { retries: 3 }
      );
    }, /Permission denied/);
    // Key assertion: only 1 attempt, no retries for permanent errors
    assert.equal(attempts, 1);
  });

  test("throws last error after exhausting retries", async () => {
    let attempts = 0;
    await assert.rejects(async () => {
      await withRetry(
        async () => {
          attempts++;
          throw new Error("Connection timed out");
        },
        { retries: 2 }
      );
    }, /Connection timed out/);
    // 1 initial attempt + 2 retries = 3 total
    assert.equal(attempts, 3);
  });

  test("calls onRetry callback on failed attempts", async () => {
    const retryAttempts: number[] = [];
    await assert.rejects(async () => {
      await withRetry(
        async () => {
          throw new Error("Connection timed out");
        },
        {
          retries: 2,
          onRetry: (_error, attempt) => {
            retryAttempts.push(attempt);
          },
        }
      );
    });
    // onRetry is called on attempts 1 and 2 (before the final failure)
    assert.deepEqual(retryAttempts, [1, 2]);
  });

  test("uses default of 3 retries when not specified", async () => {
    let attempts = 0;
    await assert.rejects(async () => {
      await withRetry(async () => {
        attempts++;
        throw new Error("Connection timed out");
      });
    });
    // 1 initial + 3 retries = 4 total
    assert.equal(attempts, 4);
  });

  test("does not retry when retries is 0", async () => {
    let attempts = 0;
    await assert.rejects(async () => {
      await withRetry(
        async () => {
          attempts++;
          throw new Error("Connection timed out");
        },
        { retries: 0 }
      );
    });
    assert.equal(attempts, 1);
  });
});

describe("promisify", () => {
  test("resolves with sync return value", async () => {
    const result = await promisify(() => "hello");
    assert.equal(result, "hello");
  });

  test("rejects with sync thrown error", async () => {
    await assert.rejects(async () => {
      await promisify(() => {
        throw new Error("sync error");
      });
    }, /sync error/);
  });

  test("preserves error properties", async () => {
    const customError = new Error("custom") as Error & { code: string };
    customError.code = "CUSTOM_CODE";

    await assert.rejects(
      async () => {
        await promisify(() => {
          throw customError;
        });
      },
      (error: Error & { code?: string }) => {
        assert.equal(error.message, "custom");
        assert.equal(error.code, "CUSTOM_CODE");
        return true;
      }
    );
  });
});

describe("integration: withRetry + promisify", () => {
  test("retries sync function wrapped in promisify", async () => {
    let attempts = 0;
    const result = await withRetry(
      () =>
        promisify(() => {
          attempts++;
          if (attempts < 2) {
            throw new Error("Connection timed out");
          }
          return "success";
        }),
      { retries: 3 }
    );
    assert.equal(result, "success");
    assert.equal(attempts, 2);
  });

  test("stops retrying permanent errors from sync function", async () => {
    let attempts = 0;
    await assert.rejects(async () => {
      await withRetry(
        () =>
          promisify(() => {
            attempts++;
            throw new Error("Permission denied");
          }),
        { retries: 3 }
      );
    }, /Permission denied/);
    // Key assertion: only 1 attempt, no retries for permanent errors
    assert.equal(attempts, 1);
  });
});
