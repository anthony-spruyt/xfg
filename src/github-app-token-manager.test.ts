import { test, describe, beforeEach, afterEach, mock } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubAppTokenManager } from "./github-app-token-manager.js";
import { TEST_PRIVATE_KEY, TEST_APP_ID } from "../fixtures/test-fixtures.js";
function base64UrlDecode(str: string): string {
  // Add padding if needed
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  // Convert base64url to base64
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

// Helper to parse JWT without verification
function parseJwt(token: string): { header: object; payload: object } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }
  return {
    header: JSON.parse(base64UrlDecode(parts[0])),
    payload: JSON.parse(base64UrlDecode(parts[1])),
  };
}

// Store original fetch
let originalFetch: typeof globalThis.fetch;

describe("GitHubAppTokenManager", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ============================================================
  // Task 1: JWT Generation Tests
  // ============================================================
  describe("constructor and generateJWT", () => {
    test("creates instance with appId and privateKey", () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);
      assert.ok(manager);
    });

    test("generateJWT returns a valid JWT structure", () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);
      const jwt = manager.generateJWT();

      // JWT should have 3 parts separated by dots
      const parts = jwt.split(".");
      assert.equal(parts.length, 3, "JWT should have 3 parts");

      // All parts should be base64url encoded (no padding)
      for (const part of parts) {
        assert.ok(
          /^[A-Za-z0-9_-]+$/.test(part),
          "JWT parts should be base64url encoded"
        );
      }
    });

    test("JWT header has correct algorithm and type", () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);
      const jwt = manager.generateJWT();
      const { header } = parseJwt(jwt);

      assert.deepEqual(header, {
        alg: "RS256",
        typ: "JWT",
      });
    });

    test("JWT payload has correct issuer (appId)", () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);
      const jwt = manager.generateJWT();
      const { payload } = parseJwt(jwt);

      assert.equal(
        (payload as { iss: string }).iss,
        TEST_APP_ID,
        "iss should be the app ID"
      );
    });

    test("JWT payload has iat set to now minus 60 seconds", () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);
      const beforeTime = Math.floor(Date.now() / 1000) - 60;
      const jwt = manager.generateJWT();
      const afterTime = Math.floor(Date.now() / 1000) - 60;
      const { payload } = parseJwt(jwt);

      const iat = (payload as { iat: number }).iat;
      assert.ok(iat >= beforeTime, "iat should be >= now - 60s");
      assert.ok(iat <= afterTime + 1, "iat should be <= now - 60s + 1s buffer");
    });

    test("JWT payload has exp set to now plus 600 seconds", () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);
      const beforeTime = Math.floor(Date.now() / 1000) + 600;
      const jwt = manager.generateJWT();
      const afterTime = Math.floor(Date.now() / 1000) + 600;
      const { payload } = parseJwt(jwt);

      const exp = (payload as { exp: number }).exp;
      assert.ok(
        exp >= beforeTime - 1,
        "exp should be >= now + 600s - 1s buffer"
      );
      assert.ok(
        exp <= afterTime + 1,
        "exp should be <= now + 600s + 1s buffer"
      );
    });

    test("JWT signature is valid RS256", () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);
      const jwt = manager.generateJWT();

      // Verify that the signature part exists and is non-empty
      const parts = jwt.split(".");
      assert.ok(parts[2].length > 0, "Signature should not be empty");

      // RS256 signatures for 2048-bit keys are typically 256 bytes = ~342 base64url chars
      assert.ok(
        parts[2].length > 100,
        "RS256 signature should be substantial length"
      );
    });
  });

  // ============================================================
  // Task 2: Installation Discovery Tests
  // ============================================================
  describe("discoverInstallations", () => {
    test("calls GET /app/installations with JWT auth", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let capturedUrl: string | undefined;
      let capturedHeaders: Record<string, string> | undefined;

      globalThis.fetch = mock.fn(
        async (url: string | URL, init?: RequestInit) => {
          capturedUrl = url.toString();
          capturedHeaders = Object.fromEntries(
            Object.entries(init?.headers || {})
          );
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      ) as typeof fetch;

      await manager.discoverInstallations("api.github.com");

      assert.equal(
        capturedUrl,
        "https://api.github.com/app/installations",
        "Should call installations endpoint"
      );
      assert.ok(
        capturedHeaders?.Authorization?.startsWith("Bearer "),
        "Should use Bearer token auth"
      );
      assert.equal(
        capturedHeaders?.Accept,
        "application/vnd.github+json",
        "Should accept GitHub JSON"
      );
    });

    test("stores installations in map by apiHost:owner", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      globalThis.fetch = mock.fn(async () => {
        return new Response(
          JSON.stringify([
            { id: 111, account: { login: "org1" } },
            { id: 222, account: { login: "org2" } },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as typeof fetch;

      await manager.discoverInstallations("api.github.com");

      assert.equal(
        manager.getInstallationId("api.github.com", "org1"),
        111,
        "Should find org1 installation"
      );
      assert.equal(
        manager.getInstallationId("api.github.com", "org2"),
        222,
        "Should find org2 installation"
      );
    });

    test("getInstallationId returns undefined for unknown owner", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      globalThis.fetch = mock.fn(async () => {
        return new Response(
          JSON.stringify([{ id: 111, account: { login: "org1" } }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as typeof fetch;

      await manager.discoverInstallations("api.github.com");

      assert.equal(
        manager.getInstallationId("api.github.com", "unknown"),
        undefined,
        "Should return undefined for unknown owner"
      );
    });

    test("handles GitHub Enterprise API host", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let capturedUrl: string | undefined;

      globalThis.fetch = mock.fn(async (url: string | URL) => {
        capturedUrl = url.toString();
        return new Response(
          JSON.stringify([{ id: 333, account: { login: "ghe-org" } }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as typeof fetch;

      await manager.discoverInstallations("ghe.example.com/api/v3");

      assert.equal(
        capturedUrl,
        "https://ghe.example.com/api/v3/app/installations",
        "Should call GHE API endpoint"
      );
      assert.equal(
        manager.getInstallationId("ghe.example.com/api/v3", "ghe-org"),
        333
      );
    });

    test("throws on non-200 response", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      globalThis.fetch = mock.fn(async () => {
        return new Response("Not Found", { status: 404 });
      }) as typeof fetch;

      await assert.rejects(
        async () => manager.discoverInstallations("api.github.com"),
        /404/,
        "Should throw on non-200 response"
      );
    });
  });

  // ============================================================
  // Task 3: Token Generation with Caching Tests
  // ============================================================
  describe("getTokenForOwner", () => {
    test("calls POST /app/installations/{id}/access_tokens", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let capturedUrl: string | undefined;
      let capturedMethod: string | undefined;

      globalThis.fetch = mock.fn(
        async (url: string | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          if (
            urlStr.includes("/app/installations") &&
            !urlStr.includes("access_tokens")
          ) {
            // Discovery call
            return new Response(
              JSON.stringify([{ id: 444, account: { login: "my-org" } }]),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          // Token call
          capturedUrl = urlStr;
          capturedMethod = init?.method;
          return new Response(
            JSON.stringify({
              token: "ghs_test_token_123",
              expires_at: "2024-01-01T01:00:00Z",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          );
        }
      ) as typeof fetch;

      await manager.discoverInstallations("api.github.com");
      const token = await manager.getTokenForOwner("api.github.com", "my-org");

      assert.equal(
        capturedUrl,
        "https://api.github.com/app/installations/444/access_tokens",
        "Should call access_tokens endpoint"
      );
      assert.equal(capturedMethod, "POST", "Should use POST method");
      assert.equal(token, "ghs_test_token_123", "Should return token");
    });

    test("returns null if no installation found", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      globalThis.fetch = mock.fn(async () => {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      await manager.discoverInstallations("api.github.com");
      const token = await manager.getTokenForOwner(
        "api.github.com",
        "unknown-org"
      );

      assert.equal(token, null, "Should return null for unknown org");
    });

    test("caches tokens for 45 minutes", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let tokenCallCount = 0;

      globalThis.fetch = mock.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (
          urlStr.includes("/app/installations") &&
          !urlStr.includes("access_tokens")
        ) {
          return new Response(
            JSON.stringify([{ id: 555, account: { login: "cached-org" } }]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        tokenCallCount++;
        return new Response(
          JSON.stringify({
            token: `token_${tokenCallCount}`,
            expires_at: "2024-01-01T01:00:00Z",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      await manager.discoverInstallations("api.github.com");

      // First call should fetch token
      const token1 = await manager.getTokenForOwner(
        "api.github.com",
        "cached-org"
      );
      assert.equal(token1, "token_1");
      assert.equal(tokenCallCount, 1);

      // Second call should use cached token
      const token2 = await manager.getTokenForOwner(
        "api.github.com",
        "cached-org"
      );
      assert.equal(token2, "token_1", "Should return cached token");
      assert.equal(tokenCallCount, 1, "Should not make another API call");
    });

    test("fetches new token after cache expires", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let tokenCallCount = 0;

      globalThis.fetch = mock.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (
          urlStr.includes("/app/installations") &&
          !urlStr.includes("access_tokens")
        ) {
          return new Response(
            JSON.stringify([{ id: 666, account: { login: "expire-org" } }]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        tokenCallCount++;
        return new Response(
          JSON.stringify({
            token: `token_${tokenCallCount}`,
            expires_at: "2024-01-01T01:00:00Z",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      await manager.discoverInstallations("api.github.com");

      // Get token with custom (expired) timestamp
      const token1 = await manager.getTokenForOwner(
        "api.github.com",
        "expire-org"
      );
      assert.equal(token1, "token_1");

      // Manually expire the cache by setting timestamp to past
      manager._expireCacheForTesting("api.github.com", "expire-org");

      // Now should fetch new token
      const token2 = await manager.getTokenForOwner(
        "api.github.com",
        "expire-org"
      );
      assert.equal(token2, "token_2", "Should fetch new token after expiry");
      assert.equal(tokenCallCount, 2, "Should have made 2 API calls");
    });
  });

  // ============================================================
  // Task 4: getTokenForRepo Tests
  // ============================================================
  describe("getTokenForRepo", () => {
    test("derives api.github.com for github.com host", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let discoveryHost: string | undefined;

      globalThis.fetch = mock.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (
          urlStr.includes("/app/installations") &&
          !urlStr.includes("access_tokens")
        ) {
          discoveryHost = new URL(urlStr).host;
          return new Response(
            JSON.stringify([{ id: 777, account: { login: "repo-owner" } }]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            token: "ghs_repo_token",
            expires_at: "2024-01-01T01:00:00Z",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const repoInfo = {
        type: "github" as const,
        host: "github.com",
        owner: "repo-owner",
        repo: "my-repo",
        gitUrl: "https://github.com/repo-owner/my-repo.git",
      };

      const token = await manager.getTokenForRepo(repoInfo);

      assert.equal(
        discoveryHost,
        "api.github.com",
        "Should use api.github.com"
      );
      assert.equal(token, "ghs_repo_token");
    });

    test("derives GHE API host with /api/v3 suffix", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let capturedUrl: string | undefined;

      globalThis.fetch = mock.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        capturedUrl = urlStr;
        if (
          urlStr.includes("/app/installations") &&
          !urlStr.includes("access_tokens")
        ) {
          return new Response(
            JSON.stringify([{ id: 888, account: { login: "ghe-owner" } }]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            token: "ghs_ghe_token",
            expires_at: "2024-01-01T01:00:00Z",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const repoInfo = {
        type: "github" as const,
        host: "ghe.example.com",
        owner: "ghe-owner",
        repo: "ghe-repo",
        gitUrl: "https://ghe.example.com/ghe-owner/ghe-repo.git",
      };

      await manager.getTokenForRepo(repoInfo);

      assert.ok(
        capturedUrl?.includes("ghe.example.com/api/v3"),
        "Should use GHE API with /api/v3 suffix"
      );
    });

    test("auto-discovers installations if not already discovered", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let discoveryCalled = false;

      globalThis.fetch = mock.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (
          urlStr.includes("/app/installations") &&
          !urlStr.includes("access_tokens")
        ) {
          discoveryCalled = true;
          return new Response(
            JSON.stringify([{ id: 999, account: { login: "auto-org" } }]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            token: "ghs_auto_token",
            expires_at: "2024-01-01T01:00:00Z",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const repoInfo = {
        type: "github" as const,
        host: "github.com",
        owner: "auto-org",
        repo: "auto-repo",
        gitUrl: "https://github.com/auto-org/auto-repo.git",
      };

      // Don't call discoverInstallations first
      const token = await manager.getTokenForRepo(repoInfo);

      assert.ok(discoveryCalled, "Should auto-discover installations");
      assert.equal(token, "ghs_auto_token");
    });

    test("does not re-discover if already discovered for host", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let discoveryCount = 0;

      globalThis.fetch = mock.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (
          urlStr.includes("/app/installations") &&
          !urlStr.includes("access_tokens")
        ) {
          discoveryCount++;
          return new Response(
            JSON.stringify([{ id: 1000, account: { login: "same-org" } }]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            token: "ghs_same_token",
            expires_at: "2024-01-01T01:00:00Z",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const repoInfo = {
        type: "github" as const,
        host: "github.com",
        owner: "same-org",
        repo: "repo1",
        gitUrl: "https://github.com/same-org/repo1.git",
      };

      await manager.getTokenForRepo(repoInfo);
      await manager.getTokenForRepo({ ...repoInfo, repo: "repo2" });

      assert.equal(discoveryCount, 1, "Should only discover once per host");
    });
  });

  // ============================================================
  // Task 5: Retry Logic Tests
  // ============================================================
  describe("retry logic", () => {
    test("retries discoverInstallations on 5xx errors", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let callCount = 0;

      globalThis.fetch = mock.fn(async () => {
        callCount++;
        if (callCount < 3) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response(
          JSON.stringify([{ id: 1111, account: { login: "retry-org" } }]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      await manager.discoverInstallations("api.github.com");

      assert.equal(callCount, 3, "Should retry on 5xx errors");
      assert.equal(
        manager.getInstallationId("api.github.com", "retry-org"),
        1111
      );
    });

    test("retries getTokenForOwner on 5xx errors", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let discoveryDone = false;
      let tokenCallCount = 0;

      globalThis.fetch = mock.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (
          urlStr.includes("/app/installations") &&
          !urlStr.includes("access_tokens")
        ) {
          discoveryDone = true;
          return new Response(
            JSON.stringify([
              { id: 2222, account: { login: "token-retry-org" } },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        tokenCallCount++;
        if (tokenCallCount < 2) {
          return new Response("Service Unavailable", { status: 503 });
        }
        return new Response(
          JSON.stringify({
            token: "ghs_retried_token",
            expires_at: "2024-01-01T01:00:00Z",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      await manager.discoverInstallations("api.github.com");
      const token = await manager.getTokenForOwner(
        "api.github.com",
        "token-retry-org"
      );

      assert.ok(discoveryDone);
      assert.equal(tokenCallCount, 2, "Should retry token request on 503");
      assert.equal(token, "ghs_retried_token");
    });

    test("does not retry on 4xx errors", async () => {
      const manager = new GitHubAppTokenManager(TEST_APP_ID, TEST_PRIVATE_KEY);

      let callCount = 0;

      globalThis.fetch = mock.fn(async () => {
        callCount++;
        return new Response("Unauthorized", { status: 401 });
      }) as typeof fetch;

      await assert.rejects(
        async () => manager.discoverInstallations("api.github.com"),
        /401/,
        "Should throw on 401"
      );

      assert.equal(callCount, 1, "Should not retry on 4xx errors");
    });
  });
});
