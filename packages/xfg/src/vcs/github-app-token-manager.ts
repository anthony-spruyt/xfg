import { createSign } from "node:crypto";
import { withRetry } from "../shared/retry-utils.js";
import { SyncError } from "../shared/errors.js";
import type { GitHubRepoInfo } from "../repo/index.js";

/** Duration to cache tokens (45 minutes in milliseconds) */
const TOKEN_CACHE_DURATION_MS = 45 * 60 * 1000;

interface Installation {
  id: number;
  // Enterprise installations have an account with slug/name but no login
  account: { login?: string } | null;
}

interface TokenResponse {
  token: string;
  expires_at: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

async function assertOkResponse(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SyncError(`${context}: ${res.status}${body ? ` - ${body}` : ""}`);
  }
}

/**
 * Manages GitHub App authentication tokens for multiple organizations.
 * Handles JWT generation, installation discovery, and token caching.
 */
export class GitHubAppTokenManager {
  private readonly clientId: string;
  private readonly privateKey: string;

  /** Map of "apiHost:owner" -> installation ID */
  private installations = new Map<string, number>();

  /** Set of API hosts that have been discovered */
  private discoveredHosts = new Set<string>();

  /** Map of "apiHost:owner" -> cached token */
  private tokenCache = new Map<string, CachedToken>();

  constructor(clientId: string, privateKey: string) {
    this.clientId = clientId;
    this.privateKey = privateKey;
  }

  /**
   * Generates a JWT for GitHub App authentication.
   * The JWT is signed with RS256 and valid for 10 minutes.
   */
  generateJWT(): string {
    const now = Math.floor(Date.now() / 1000);

    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const payload = {
      iat: now - 60, // Issued 60 seconds ago to account for clock drift
      exp: now + 600, // Expires in 10 minutes
      iss: this.clientId,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));

    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    const sign = createSign("RSA-SHA256");
    sign.update(signatureInput);
    const signature = sign.sign(this.privateKey);
    const encodedSignature = base64UrlEncode(signature);

    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  /**
   * Discovers all installations for this GitHub App on the given API host.
   * Stores installations in an internal map for later lookup.
   */
  async discoverInstallations(apiHost: string): Promise<void> {
    const jwt = this.generateJWT();
    let url: string | undefined =
      `https://${apiHost}/app/installations?per_page=100`;

    while (url) {
      const pageUrl: string = url;
      const response = await withRetry(async () => {
        const res = await fetch(pageUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });

        await assertOkResponse(res, "GitHub App installations");
        return res;
      });

      const installations = (await response.json()) as Installation[];
      for (const installation of installations) {
        const login = installation.account?.login;
        if (!login) continue;
        this.installations.set(
          installationKey(apiHost, login),
          installation.id
        );
      }

      url = nextPageUrl(response.headers.get("link"));
    }

    this.discoveredHosts.add(apiHost);
  }

  getInstallationId(apiHost: string, owner: string): number | undefined {
    return this.installations.get(installationKey(apiHost, owner));
  }

  /**
   * Gets an installation access token for the given owner.
   * Returns null if no installation is found for the owner.
   * Tokens are cached for 45 minutes.
   */
  async getTokenForOwner(
    apiHost: string,
    owner: string
  ): Promise<string | null> {
    const installationId = this.getInstallationId(apiHost, owner);
    if (installationId === undefined) {
      return null;
    }

    const cacheKey = installationKey(apiHost, owner);

    // Check cache
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    // Fetch new token
    const url = `https://${apiHost}/app/installations/${installationId}/access_tokens`;
    const jwt = this.generateJWT();

    const response = await withRetry(async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      await assertOkResponse(res, "GitHub App access token");
      return res;
    });

    const tokenResponse = (await response.json()) as TokenResponse;

    // Cache the token
    this.tokenCache.set(cacheKey, {
      token: tokenResponse.token,
      expiresAt: Date.now() + TOKEN_CACHE_DURATION_MS,
    });

    return tokenResponse.token;
  }

  /**
   * Gets an installation access token for a repository.
   * Automatically discovers installations if not already done for the host.
   * Derives the API host from the repository host.
   */
  async getTokenForRepo(repoInfo: GitHubRepoInfo): Promise<string | null> {
    const apiHost = deriveApiHost(repoInfo.host);

    // Auto-discover if needed
    if (!this.discoveredHosts.has(apiHost)) {
      await this.discoverInstallations(apiHost);
    }

    return this.getTokenForOwner(apiHost, repoInfo.owner);
  }

  /**
   * FOR TESTING ONLY: Manually expire a cached token.
   */
  _expireCacheForTesting(apiHost: string, owner: string): void {
    const cacheKey = installationKey(apiHost, owner);
    const cached = this.tokenCache.get(cacheKey);
    if (cached) {
      cached.expiresAt = 0;
    }
  }
}

// GitHub logins are case-insensitive; config URLs may not match the canonical casing.
function installationKey(apiHost: string, owner: string): string {
  return `${apiHost}:${owner.toLowerCase()}`;
}

function nextPageUrl(linkHeader: string | null): string | undefined {
  return linkHeader?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
}

/**
 * Encodes data as base64url (no padding).
 */
function base64UrlEncode(data: string | Buffer): string {
  const buffer = typeof data === "string" ? Buffer.from(data) : data;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Derives the GitHub API host from a repository host.
 * - github.com -> api.github.com
 * - ghe.example.com -> ghe.example.com/api/v3
 */
function deriveApiHost(host: string): string {
  if (host === "github.com") {
    return "api.github.com";
  }
  return `${host}/api/v3`;
}
