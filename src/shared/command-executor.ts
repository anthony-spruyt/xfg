import { execSync } from "node:child_process";
import { sanitizeCredentials } from "./sanitize-utils.js";

/**
 * Options for command execution.
 */
export interface ExecOptions {
  /** Additional environment variables to set for the command */
  env?: Record<string, string>;
}

/**
 * Interface for executing shell commands.
 * Enables dependency injection for testing and alternative implementations.
 */
export interface ICommandExecutor {
  /**
   * Execute a shell command and return the output.
   * @param command The command to execute
   * @param cwd The working directory for the command
   * @param options Optional execution options (env vars, etc.)
   * @returns Promise resolving to the trimmed stdout output
   * @throws Error if the command fails
   */
  exec(command: string, cwd: string, options?: ExecOptions): Promise<string>;
}

/**
 * Default implementation that uses Node.js child_process.execSync.
 * Note: Commands are escaped using escapeShellArg before being passed here.
 */
export class ShellCommandExecutor implements ICommandExecutor {
  async exec(
    command: string,
    cwd: string,
    options?: ExecOptions
  ): Promise<string> {
    try {
      return execSync(command, {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: options?.env ? { ...process.env, ...options.env } : undefined,
      }).trim();
    } catch (error) {
      // Ensure stderr is always a string for consistent error handling
      const execError = error as {
        stderr?: Buffer | string;
        message?: string;
      };
      if (execError.stderr && typeof execError.stderr !== "string") {
        execError.stderr = execError.stderr.toString();
      }
      // Sanitize credentials from stderr before including in error
      if (execError.stderr) {
        execError.stderr = sanitizeCredentials(execError.stderr);
      }
      // Include sanitized stderr in error message for better debugging
      if (execError.stderr && execError.message) {
        execError.message =
          sanitizeCredentials(execError.message) + "\n" + execError.stderr;
      } else if (execError.message) {
        execError.message = sanitizeCredentials(execError.message);
      }
      throw error;
    }
  }
}

/**
 * Default executor instance for production use.
 */
export const defaultExecutor: ICommandExecutor = new ShellCommandExecutor();
