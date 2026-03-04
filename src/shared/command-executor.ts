import { execSync } from "node:child_process";
import { sanitizeCredentials } from "./sanitize-utils.js";

export interface ExecOptions {
  /** Additional environment variables to set for the command */
  env?: Record<string, string>;
}

export interface ICommandExecutor {
  exec(command: string, cwd: string, options?: ExecOptions): Promise<string>;
}

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

export const defaultExecutor: ICommandExecutor = new ShellCommandExecutor();

/** Extract stderr string from an exec error (child_process errors attach stderr). */
export function getStderr(error: unknown): string {
  if (error != null && typeof error === "object" && "stderr" in error) {
    const { stderr } = error as { stderr: unknown };
    return typeof stderr === "string" ? stderr : "";
  }
  return "";
}
