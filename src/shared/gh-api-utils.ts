import { escapeShellArg } from "./shell-utils.js";
import { withRetry } from "./retry-utils.js";
import type { ICommandExecutor } from "./command-executor.js";
import type { RateLimitedError } from "./errors.js";

export interface GitHubApiTarget {
  host: string;
  owner: string;
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
  /** Override for delay function (test injection) */
  _retryDelay?: (ms: number) => Promise<void>;
}

interface GhApiCallOptions {
  executor: ICommandExecutor;
  retries: number;
  cwd: string;
  apiOpts?: GhApiOptions;
  payload?: unknown;
  paginate?: boolean;
  _retryDelay?: (ms: number) => Promise<void>;
}

/**
 * Get the hostname flag for gh commands.
 * Returns "--hostname HOST" for GHE, empty string for github.com.
 */
export function getHostnameFlag(
  repoInfo: Pick<GitHubApiTarget, "host">
): string {
  if (repoInfo.host !== "github.com") {
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
 * Strips HTTP response headers from `gh api --include` output.
 * Splits on the first blank line (LF or CRLF) and returns everything after it.
 * If no blank line is found, returns the full string (no headers present).
 */
export function parseResponseBody(raw: string): string {
  // Try CRLF first, then LF
  const crlfIndex = raw.indexOf("\r\n\r\n");
  if (crlfIndex !== -1) {
    return raw.slice(crlfIndex + 4);
  }
  const lfIndex = raw.indexOf("\n\n");
  if (lfIndex !== -1) {
    return raw.slice(lfIndex + 2);
  }
  return raw;
}

/**
 * Parses Retry-After header from an exec error's stdout and attaches it
 * as error.retryAfter (number of seconds). Only extracts the numeric value
 * to avoid leaking tokens from other headers.
 *
 * No-op if stdout is absent or does not contain a numeric Retry-After header.
 */
function hasStdout(error: unknown): error is { stdout: string | Buffer } {
  return (
    typeof error === "object" &&
    error !== null &&
    "stdout" in error &&
    (typeof (error as Record<string, unknown>).stdout === "string" ||
      Buffer.isBuffer((error as Record<string, unknown>).stdout))
  );
}

export function attachRetryAfter(error: unknown): void {
  if (!hasStdout(error)) return;
  const stdout = error.stdout;

  const stdoutStr = typeof stdout === "string" ? stdout : stdout.toString();
  const match = stdoutStr.match(/^retry-after:\s*(\d+)\s*$/im);
  if (match) {
    (error as RateLimitedError).retryAfter = parseInt(match[1], 10);
  }
}

/**
 * Extracts GitHub API validation error details from `gh api --include` stdout
 * and appends them to the error message. This surfaces the descriptive error
 * messages that GitHub returns in 422 responses (e.g., "The branch main was
 * not found") which are otherwise lost when only stderr is shown.
 *
 * No-op if stdout is absent or does not contain parseable error JSON.
 */
export function attachValidationDetails(error: unknown): void {
  if (!hasStdout(error)) return;
  const stdout = error.stdout;

  const stdoutStr = typeof stdout === "string" ? stdout : stdout.toString();
  const body = parseResponseBody(stdoutStr);

  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      errors?: Array<{ message?: string; field?: string }>;
    };

    const details: string[] = [];

    if (parsed.errors && parsed.errors.length > 0) {
      for (const err of parsed.errors) {
        if (err.message) {
          const fieldPrefix = err.field ? `${err.field}: ` : "";
          details.push(`${fieldPrefix}${err.message}`);
        }
      }
    } else if (parsed.message) {
      details.push(parsed.message);
    }

    if (details.length > 0 && error instanceof Error) {
      error.message += ` [${details.join("; ")}]`;
    }
  } catch {
    // JSON parse failed — stdout is not a JSON error response
  }
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
  } else {
    args.push("--include");
  }

  if (apiOpts?.host && apiOpts.host !== "github.com") {
    args.push("--hostname", escapeShellArg(apiOpts.host));
  }

  args.push(escapeShellArg(endpoint));

  const baseCommand = args.join(" ");
  const env = buildTokenEnv(apiOpts?.token);

  const execAndParse = async (command: string): Promise<string> => {
    try {
      const raw = await executor.exec(command, cwd, { env });
      return paginate ? raw : parseResponseBody(raw);
    } catch (error) {
      if (!paginate) {
        attachRetryAfter(error);
        attachValidationDetails(error);
      }
      throw error;
    }
  };

  const retryOpts = {
    retries,
    ...(opts._retryDelay ? { _delay: opts._retryDelay } : {}),
  };

  if (
    payload &&
    (method === "POST" || method === "PUT" || method === "PATCH")
  ) {
    const payloadJson = JSON.stringify(payload);
    const command = `echo ${escapeShellArg(payloadJson)} | ${baseCommand} --input -`;
    return withRetry(() => execAndParse(command), retryOpts);
  }

  return withRetry(() => execAndParse(baseCommand), retryOpts);
}

/**
 * Encapsulates executor + retries for GitHub API calls.
 * Strategies compose with this instead of duplicating ghApi wrappers.
 */
export class GhApiClient {
  constructor(
    private readonly executor: ICommandExecutor,
    private readonly retries: number,
    private readonly cwd: string
  ) {}

  call(
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
      _retryDelay: params?._retryDelay,
    });
  }
}
