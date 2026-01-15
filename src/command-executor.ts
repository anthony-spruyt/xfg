import { execSync } from "node:child_process";

/**
 * Interface for executing shell commands.
 * Enables dependency injection for testing and alternative implementations.
 */
export interface CommandExecutor {
  /**
   * Execute a shell command and return the output.
   * @param command The command to execute
   * @param cwd The working directory for the command
   * @returns The trimmed stdout output
   * @throws Error if the command fails
   */
  exec(command: string, cwd: string): string;
}

/**
 * Default implementation that uses Node.js child_process.execSync.
 * Note: Commands are escaped using escapeShellArg before being passed here.
 */
export class ShellCommandExecutor implements CommandExecutor {
  exec(command: string, cwd: string): string {
    return execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }
}

/**
 * Default executor instance for production use.
 */
export const defaultExecutor: CommandExecutor = new ShellCommandExecutor();
