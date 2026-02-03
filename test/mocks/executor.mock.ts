import type { ICommandExecutor } from "../../src/command-executor.js";

export interface ExecutorMockConfig {
  defaultResponse?: string;
  responses?: Map<string, string | Error>;
  trackCalls?: boolean;
}

export interface ExecutorMockResult {
  mock: ICommandExecutor;
  calls: Array<{ command: string; cwd: string }>;
  reset: () => void;
}

export function createMockExecutor(
  config: ExecutorMockConfig = {}
): ExecutorMockResult {
  const calls: Array<{ command: string; cwd: string }> = [];
  const responses = config.responses ?? new Map();
  const defaultResponse = config.defaultResponse ?? "";

  const mock: ICommandExecutor = {
    async exec(command: string, cwd: string): Promise<string> {
      calls.push({ command, cwd });

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
    reset: () => {
      calls.length = 0;
    },
  };
}
