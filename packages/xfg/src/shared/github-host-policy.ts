import { isIP } from "node:net";
import { ValidationError } from "./errors.js";

export const ALLOWED_GITHUB_HOSTS_ENV = "XFG_ALLOWED_GITHUB_HOSTS";

const GITHUB_DOT_COM = "github.com";
const GITHUB_DOT_COM_API = "api.github.com";
const GHES_API_SUFFIX = "/api/v3";
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const NUMERIC_HOST = /^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+)){0,3}$/i;

/** A bare DNS hostname: no scheme, userinfo, port, path, whitespace or trailing dot. */
export function isValidHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  return host.split(".").every((label) => HOSTNAME_LABEL.test(label));
}

/** Includes the short and hex forms (`1.2.3`, `0x7f.1`) that inet_aton accepts. */
export function isIpLiteral(host: string): boolean {
  const unbracketed = host.replace(/^\[(.*)\]$/, "$1");
  return isIP(unbracketed) !== 0 || NUMERIC_HOST.test(host);
}

export class GitHubHostNotAllowedError extends ValidationError {
  constructor(host: string) {
    super(
      `GitHub host '${host}' is not in ${ALLOWED_GITHUB_HOSTS_ENV}; refusing to send GitHub credentials to it. ` +
        `Only github.com is allowed by default. Set ${ALLOWED_GITHUB_HOSTS_ENV} to trust a GitHub Enterprise Server host.`
    );
  }
}

/** Decides which GitHub hosts may receive App JWTs and tokens. */
export interface IGitHubHostPolicy {
  isAllowed(host: string): boolean;
  isAllowedApiHost(apiHost: string): boolean;
}

export class GitHubHostPolicy implements IGitHubHostPolicy {
  private readonly hosts: Set<string>;

  constructor(extraHosts: readonly string[] = []) {
    this.hosts = new Set([
      GITHUB_DOT_COM,
      ...extraHosts.map((h) => h.toLowerCase()),
    ]);
  }

  isAllowed(host: string): boolean {
    return isValidHostname(host) && this.hosts.has(host.toLowerCase());
  }

  isAllowedApiHost(apiHost: string): boolean {
    const lower = apiHost.toLowerCase();
    if (lower === GITHUB_DOT_COM_API) return true;
    if (!lower.endsWith(GHES_API_SUFFIX)) return false;
    const host = lower.slice(0, -GHES_API_SUFFIX.length);
    return host !== GITHUB_DOT_COM && this.isAllowed(host);
  }
}

export function parseAllowedGitHubHosts(value: string | undefined): string[] {
  const entries = (value ?? "").split(/[\s,]+/).filter(Boolean);
  return entries.map((entry) => {
    if (!isValidHostname(entry)) {
      throw new ValidationError(
        `${ALLOWED_GITHUB_HOSTS_ENV} entries must be bare hostnames (no scheme, userinfo, port or path). Got: ${entry}`
      );
    }
    if (isIpLiteral(entry)) {
      throw new ValidationError(
        `${ALLOWED_GITHUB_HOSTS_ENV} entries must be hostnames, not IP addresses. Got: ${entry}`
      );
    }
    return entry.toLowerCase();
  });
}

export function createGitHubHostPolicyFromEnv(
  env: Record<string, string | undefined>
): GitHubHostPolicy {
  return new GitHubHostPolicy(
    parseAllowedGitHubHosts(env[ALLOWED_GITHUB_HOSTS_ENV])
  );
}
