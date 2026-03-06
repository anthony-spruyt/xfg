import { escapeShellArg } from "./shell-utils.js";
import { withRetry } from "./retry-utils.js";
import type { ICommandExecutor } from "./command-executor.js";
import type { GitHubRepoInfo } from "./repo-detector.js";
import { toErrorMessage } from "./type-guards.js";
import { GraphQLApiError } from "./errors.js";

interface ITokenManager {
  getTokenForRepo(repoInfo: GitHubRepoInfo): Promise<string | null>;
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface GhApiOptions {
  token?: string;
  host?: string;
}

interface GhApiCallParams {
  payload?: unknown;
  options?: GhApiOptions;
  paginate?: boolean;
}

interface GhApiCallOptions {
  executor: ICommandExecutor;
  retries: number;
  cwd: string;
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
async function ghApiCall(
  method: HttpMethod,
  endpoint: string,
  opts: GhApiCallOptions
): Promise<string> {
  const { executor, retries, cwd, apiOpts, payload, paginate } = opts;
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
    return await withRetry(() => executor.exec(command, cwd, { env }), {
      retries,
    });
  }

  return await withRetry(() => executor.exec(baseCommand, cwd, { env }), {
    retries,
  });
}

/**
 * Encapsulates executor + retries for GitHub API calls.
 * Strategies compose with this instead of duplicating ghApi wrappers.
 */
export class GhApiClient {
  constructor(
    private readonly executor: ICommandExecutor,
    private readonly retries: number,
    private readonly cwd: string = "."
  ) {}

  async call(
    method: HttpMethod,
    endpoint: string,
    params?: GhApiCallParams
  ): Promise<string> {
    return ghApiCall(method, endpoint, {
      executor: this.executor,
      retries: this.retries,
      cwd: this.cwd,
      apiOpts: params?.options,
      payload: params?.payload,
      paginate: params?.paginate,
    });
  }
}

/**
 * Resolve a GitHub token for a repo: GitHub App token → GH_TOKEN env fallback.
 * Returns { token, skipped } where skipped=true means no App installation found
 * and no GH_TOKEN is available. Both sync and settings paths use this function.
 */
export async function resolveGitHubToken(
  repoInfo: GitHubRepoInfo,
  tokenManager: ITokenManager | null,
  context: string,
  log?: { debug(msg: string): void },
  envToken?: string
): Promise<{ token: string | undefined; skipped: boolean }> {
  try {
    const appToken = await tokenManager?.getTokenForRepo(repoInfo);
    if (appToken === null) {
      // null = no installation found for this owner
      return { token: undefined, skipped: true };
    }
    // string = app token; undefined = no manager configured
    return { token: appToken ?? envToken, skipped: false };
  } catch (error) {
    log?.debug(
      `GitHub App token resolution failed for ${context}: ${toErrorMessage(error)}; falling back to GH_TOKEN`
    );
    return { token: envToken, skipped: false };
  }
}

/**
 * Check if an error message indicates an HTTP 404 response from the GitHub API.
 */
export function isHttp404Error(error: unknown): boolean {
  return toErrorMessage(error).includes("HTTP 404");
}

/**
 * Parse a JSON API response with a contextual error message.
 * Wraps JSON.parse so callers get "Failed to parse <context>: ..." instead of
 * a bare "Unexpected token" SyntaxError.
 */
export function parseApiJson<T>(response: string, context: string): T {
  try {
    return JSON.parse(response) as T;
  } catch (error) {
    const preview = response.slice(0, 200);
    throw new GraphQLApiError(
      `Failed to parse ${context}: ${toErrorMessage(error)} — ${preview}`
    );
  }
}
