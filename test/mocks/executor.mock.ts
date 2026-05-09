import type {
  ICommandExecutor,
  ExecOptions,
} from "../../src/shared/command-executor.js";

/** Response value: a string, an Error to throw, or a factory function returning either. */
export type MockResponse = string | Error | (() => string | Error);

export interface ExecutorMockConfig {
  defaultResponse?: string;
  responses?: Map<string, MockResponse>;
  trackCalls?: boolean;
  trackGitCommands?: boolean;
}

export interface ExecutorMockCall {
  executable: string;
  args: string[];
  cwd: string;
  options?: ExecOptions;
}

export interface GitCommandTracking {
  lastCommitMessage: string | null;
  pushBranch: string | null;
  pushForce: boolean | undefined;
}

export interface ExecutorMockResult {
  mock: ICommandExecutor;
  calls: ExecutorMockCall[];
  responses: Map<string, MockResponse>;
  git: GitCommandTracking;
  reset: () => void;
}

function matchesPattern(
  executable: string,
  args: string[],
  pattern: string
): boolean {
  const allParts = [executable, ...args];
  const tokens = pattern.split(/\s+/);
  return tokens.every((token) => allParts.includes(token));
}

export function createMockExecutor(
  config: ExecutorMockConfig = {}
): ExecutorMockResult {
  const calls: ExecutorMockCall[] = [];
  const responses = config.responses ?? new Map();
  const defaultResponse = config.defaultResponse ?? "";

  const git: GitCommandTracking = {
    lastCommitMessage: null,
    pushBranch: null,
    pushForce: undefined,
  };

  const mock: ICommandExecutor = {
    async exec(
      executable: string,
      args: string[],
      cwd: string,
      opts?: ExecOptions
    ): Promise<string> {
      calls.push({ executable, args, cwd, options: opts });

      if (config.trackGitCommands) {
        if (executable === "git" && args.includes("commit")) {
          const mIndex = args.indexOf("-m");
          if (mIndex !== -1 && mIndex + 1 < args.length) {
            git.lastCommitMessage = args[mIndex + 1];
          }
        }
        if (executable === "git" && args.includes("push")) {
          git.pushForce = args.includes("--force-with-lease");
          const originIndex = args.indexOf("origin");
          if (originIndex !== -1 && originIndex + 1 < args.length) {
            git.pushBranch = args[originIndex + 1];
          }
        }
      }

      for (const [pattern, response] of responses) {
        if (matchesPattern(executable, args, pattern)) {
          const result = typeof response === "function" ? response() : response;
          if (result instanceof Error) {
            throw result;
          }
          return result;
        }
      }

      return defaultResponse;
    },
  };

  return {
    mock,
    calls,
    responses,
    git,
    reset: () => {
      calls.length = 0;
      git.lastCommitMessage = null;
      git.pushBranch = null;
      git.pushForce = undefined;
    },
  };
}
