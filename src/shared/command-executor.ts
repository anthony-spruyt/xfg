import { execFileSync } from "node:child_process";
import { sanitizeCredentials } from "../vcs/sanitize-utils.js";

export interface ExecOptions {
  /** Additional environment variables to set for the command */
  env?: Record<string, string>;
}

export interface ICommandExecutor {
  exec(command: string, cwd: string, options?: ExecOptions): Promise<string>;
}

export class ShellCommandExecutor implements ICommandExecutor {
  private readonly getEnv: () => Record<string, string | undefined>;

  constructor(baseEnv: Record<string, string | undefined>) {
    this.getEnv = () => baseEnv;
  }

  async exec(
    command: string,
    cwd: string,
    options?: ExecOptions
  ): Promise<string> {
    try {
      // When no per-command env overrides, omit env to inherit parent process
      // environment directly (avoids CodeQL js/indirect-command-line-injection).
      // Only construct an explicit env when merging per-command vars.
      const env = options?.env
        ? ({ ...this.getEnv(), ...options.env } as NodeJS.ProcessEnv)
        : undefined;
      return execFileSync("sh", ["-c", command], {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env,
      }).trim();
    } catch (error) {
      // Normalise and sanitise the exec error so downstream retry logic
      // sees a string stderr with no raw credentials.
      const execError = error as {
        stderr?: Buffer | string;
        message?: string;
      };
      if (execError.stderr && typeof execError.stderr !== "string") {
        execError.stderr = execError.stderr.toString();
      }
      if (execError.stderr) {
        execError.stderr = sanitizeCredentials(execError.stderr);
      }
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

/** Extract stderr string from an exec error (child_process errors attach stderr). */
export function getStderr(error: unknown): string {
  if (error != null && typeof error === "object" && "stderr" in error) {
    const { stderr } = error as { stderr: unknown };
    return typeof stderr === "string" ? stderr : "";
  }
  return "";
}
