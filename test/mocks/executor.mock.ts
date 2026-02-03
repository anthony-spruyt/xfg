import type { ICommandExecutor } from "../../src/command-executor.js";

export interface ExecutorMockConfig {
  defaultResponse?: string;
  responses?: Map<string, string | Error>;
  trackCalls?: boolean;
  /** Enable parsing of git commands to track commit messages, push branches, etc. */
  trackGitCommands?: boolean;
}

export interface GitCommandTracking {
  lastCommitMessage: string | null;
  pushBranch: string | null;
  pushForce: boolean | undefined;
}

export interface ExecutorMockResult {
  mock: ICommandExecutor;
  calls: Array<{ command: string; cwd: string }>;
  /** Git command tracking (only populated if trackGitCommands: true) */
  git: GitCommandTracking;
  reset: () => void;
}

export function createMockExecutor(
  config: ExecutorMockConfig = {}
): ExecutorMockResult {
  const calls: Array<{ command: string; cwd: string }> = [];
  const responses = config.responses ?? new Map();
  const defaultResponse = config.defaultResponse ?? "";

  const git: GitCommandTracking = {
    lastCommitMessage: null,
    pushBranch: null,
    pushForce: undefined,
  };

  const mock: ICommandExecutor = {
    async exec(command: string, cwd: string): Promise<string> {
      calls.push({ command, cwd });

      // Track git commands if enabled (mock only - no actual command execution)
      if (config.trackGitCommands) {
        // Track commit message from git commit command
        if (command.includes("git commit")) {
          const match = command.match(/-m ['"](.+)['"]/);
          if (match) {
            git.lastCommitMessage = match[1];
          } else {
            // Handle shell escaping - look for -m followed by escaped content
            const msgMatch = command.match(/-m \$'([^']+)'/);
            if (msgMatch) {
              git.lastCommitMessage = msgMatch[1].replace(/\\'/g, "'");
            }
          }
        }
        // Track push branch and force flag
        if (command.includes("git push")) {
          git.pushForce = command.includes("--force-with-lease");
          // Branch name may be shell-escaped with single quotes
          const branchMatch = command.match(
            /git push.*origin\s+'?([^'\s]+)'?(?:\s|$)/
          );
          if (branchMatch) {
            git.pushBranch = branchMatch[1];
          }
        }
      }

      // Check for matching response
      for (const [pattern, response] of responses) {
        if (command.includes(pattern)) {
          if (response instanceof Error) {
            throw response;
          }
          return response;
        }
      }

      return defaultResponse;
    },
  };

  return {
    mock,
    calls,
    git,
    reset: () => {
      calls.length = 0;
      git.lastCommitMessage = null;
      git.pushBranch = null;
      git.pushForce = undefined;
    },
  };
}
