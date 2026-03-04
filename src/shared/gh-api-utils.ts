import { escapeShellArg } from "../shared/shell-utils.js";
import { withRetry } from "../shared/retry-utils.js";
import type { ICommandExecutor } from "../shared/command-executor.js";
import type { GitHubRepoInfo } from "../shared/repo-detector.js";
import type { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface GhApiOptions {
  token?: string;
  host?: string;
}

interface GhApiCallOptions {
  executor: ICommandExecutor;
  retries: number;
  apiOpts?: GhApiOptions;
  payload?: unknown;
  paginate?: boolean;
}

/**
 * Get the hostname flag for gh commands.
 * Returns "--hostname HOST" for GHE, empty string for github.com.
 */
export function getHostnameFlag(repoInfo: GitHubRepoInfo): string {
  if (repoInfo.host && repoInfo.host !== "github.com") {
    return `--hostname ${escapeShellArg(repoInfo.host)}`;
  }
  return "";
}

export function buildTokenEnv(
  token?: string
): Record<string, string> | undefined {
  return token ? { GH_TOKEN: token } : undefined;
}

/**
 * Executes a GitHub API call using the gh CLI.
 * Shared by labels, rulesets, and repo-settings strategies.
 *
 * Token is injected via ExecOptions.env (matching the PR strategy pattern)
 * rather than shell-prefix string interpolation.
 */
export async function ghApiCall(
  method: HttpMethod,
  endpoint: string,
  opts: GhApiCallOptions
): Promise<string> {
  const { executor, retries, apiOpts, payload, paginate } = opts;
  const args: string[] = ["gh", "api"];

  if (method !== "GET") {
    args.push("-X", method);
  }

  if (paginate) {
    args.push("--paginate");
  }

  if (apiOpts?.host && apiOpts.host !== "github.com") {
    args.push("--hostname", escapeShellArg(apiOpts.host));
  }

  args.push(escapeShellArg(endpoint));

  const baseCommand = args.join(" ");
  const env = buildTokenEnv(apiOpts?.token);

  if (
    payload &&
    (method === "POST" || method === "PUT" || method === "PATCH")
  ) {
    const payloadJson = JSON.stringify(payload);
    const command = `echo ${escapeShellArg(payloadJson)} | ${baseCommand} --input -`;
    return await withRetry(
      () => executor.exec(command, process.cwd(), { env }),
      { retries }
    );
  }

  return await withRetry(
    () => executor.exec(baseCommand, process.cwd(), { env }),
    { retries }
  );
}

/**
 * Resolve a GitHub token for a repo: GitHub App token → GH_TOKEN env fallback.
 * Returns { token, skipped } where skipped=true means no App installation found
 * and no GH_TOKEN is available. Both sync and settings paths use this function.
 */
export async function resolveGitHubToken(
  repoInfo: GitHubRepoInfo,
  tokenManager: GitHubAppTokenManager | null,
  context: string
): Promise<{ token: string | undefined; skipped: boolean }> {
  try {
    const appToken = await tokenManager?.getTokenForRepo(repoInfo);
    if (appToken === null) {
      // null = no installation found for this owner
      return { token: undefined, skipped: true };
    }
    // string = app token; undefined = no manager configured
    return { token: appToken ?? process.env.GH_TOKEN, skipped: false };
  } catch {
    // Token resolution failed; fall back to env var
    return { token: process.env.GH_TOKEN, skipped: false };
  }
}

/**
 * Parse a JSON API response with a contextual error message.
 * Wraps JSON.parse so callers get "Failed to parse <context>: ..." instead of
 * a bare "Unexpected token" SyntaxError.
 */
export function parseApiJson<T>(response: string, context: string): T {
  try {
    return JSON.parse(response) as T;
  } catch {
    const preview = response.slice(0, 200);
    throw new Error(`Failed to parse ${context}: ${preview}`);
  }
}
