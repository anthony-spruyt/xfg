import { execFileSync } from "node:child_process";
import { sanitizeCredentials } from "./sanitize-utils.js";

export interface ExecOptions {
  env?: Record<string, string>;
  input?: string;
}

export interface ICommandExecutor {
  exec(
    executable: string,
    args: string[],
    cwd: string,
    options?: ExecOptions
  ): Promise<string>;
}

export class ProcessExecutor implements ICommandExecutor {
  private readonly baseEnv: Record<string, string | undefined>;

  constructor(baseEnv: Record<string, string | undefined>) {
    this.baseEnv = baseEnv;
  }

  async exec(
    executable: string,
    args: string[],
    cwd: string,
    options?: ExecOptions
  ): Promise<string> {
    try {
      return execFileSync(executable, args, {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        input: options?.input,
        env: options?.env
          ? { ...this.baseEnv, ...options.env }
          : (this.baseEnv as NodeJS.ProcessEnv),
      }).trim();
    } catch (error) {
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
    if (typeof stderr === "string") return stderr;
    if (Buffer.isBuffer(stderr)) return stderr.toString();
  }
  return "";
}
