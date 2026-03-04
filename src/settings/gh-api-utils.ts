import { escapeShellArg } from "../shared/shell-utils.js";
import { withRetry } from "../shared/retry-utils.js";
import type { ICommandExecutor } from "../shared/command-executor.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface GhApiOptions {
  token?: string;
  host?: string;
}

export interface GhApiCallOptions {
  executor: ICommandExecutor;
  retries: number;
}

/**
 * Executes a GitHub API call using the gh CLI.
 * Shared by labels, rulesets, and repo-settings strategies.
 *
 * Note: Uses ICommandExecutor.exec() which delegates to the gh CLI shell
 * command. Token injection is safe via escapeShellArg.
 */
export async function ghApiCall(
  method: HttpMethod,
  endpoint: string,
  opts: GhApiCallOptions,
  apiOpts?: GhApiOptions,
  payload?: unknown,
  paginate?: boolean
): Promise<string> {
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

  const tokenPrefix = apiOpts?.token
    ? `GH_TOKEN=${escapeShellArg(apiOpts.token)} `
    : "";

  if (
    payload &&
    (method === "POST" || method === "PUT" || method === "PATCH")
  ) {
    const payloadJson = JSON.stringify(payload);
    const command = `echo ${escapeShellArg(payloadJson)} | ${tokenPrefix}${baseCommand} --input -`;
    return await withRetry(() => opts.executor.exec(command, process.cwd()), {
      retries: opts.retries,
    });
  }

  const command = `${tokenPrefix}${baseCommand}`;
  return await withRetry(() => opts.executor.exec(command, process.cwd()), {
    retries: opts.retries,
  });
}
