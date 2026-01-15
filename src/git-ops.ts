import {
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { escapeShellArg } from "./shell-utils.js";
import { CommandExecutor, defaultExecutor } from "./command-executor.js";
import { withRetry } from "./retry-utils.js";

export interface GitOpsOptions {
  workDir: string;
  dryRun?: boolean;
  executor?: CommandExecutor;
  /** Number of retries for network operations (default: 3) */
  retries?: number;
}

export class GitOps {
  private workDir: string;
  private dryRun: boolean;
  private executor: CommandExecutor;
  private retries: number;

  constructor(options: GitOpsOptions) {
    this.workDir = options.workDir;
    this.dryRun = options.dryRun ?? false;
    this.executor = options.executor ?? defaultExecutor;
    this.retries = options.retries ?? 3;
  }

  private async exec(command: string, cwd?: string): Promise<string> {
    return this.executor.exec(command, cwd ?? this.workDir);
  }

  /**
   * Run a command with retry logic for transient failures.
   * Used for network operations like clone, fetch, push.
   */
  private async execWithRetry(command: string, cwd?: string): Promise<string> {
    return withRetry(() => this.exec(command, cwd), {
      retries: this.retries,
    });
  }

  cleanWorkspace(): void {
    if (existsSync(this.workDir)) {
      rmSync(this.workDir, { recursive: true, force: true });
    }
    mkdirSync(this.workDir, { recursive: true });
  }

  async clone(gitUrl: string): Promise<void> {
    await this.execWithRetry(
      `git clone ${escapeShellArg(gitUrl)} .`,
      this.workDir,
    );
  }

  async createBranch(branchName: string): Promise<void> {
    try {
      // Check if branch exists on remote (network operation with retry)
      await this.execWithRetry(
        `git fetch origin ${escapeShellArg(branchName)}`,
        this.workDir,
      );
      this.exec(`git checkout ${escapeShellArg(branchName)}`, this.workDir);
      return;
    } catch (error) {
      // Only proceed to create branch if error indicates branch doesn't exist
      const message = error instanceof Error ? error.message : String(error);
      const isBranchNotFound =
        message.includes("couldn't find remote ref") ||
        message.includes("pathspec") ||
        message.includes("did not match any");

      if (!isBranchNotFound) {
        throw new Error(
          `Failed to fetch/checkout branch '${branchName}': ${message}`,
        );
      }
    }

    // Branch doesn't exist on remote, create it locally
    try {
      this.exec(`git checkout -b ${escapeShellArg(branchName)}`, this.workDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create branch '${branchName}': ${message}`);
    }
  }

  writeFile(fileName: string, content: string): void {
    if (this.dryRun) {
      return;
    }
    const filePath = join(this.workDir, fileName);

    // Runtime path traversal check using relative path
    const resolvedPath = resolve(filePath);
    const resolvedWorkDir = resolve(this.workDir);
    const relativePath = relative(resolvedWorkDir, resolvedPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`Path traversal detected: ${fileName}`);
    }

    // Normalize trailing newline - ensure exactly one
    const normalized = content.endsWith("\n") ? content : content + "\n";
    writeFileSync(filePath, normalized, "utf-8");
  }

  /**
   * Checks if writing the given content would result in changes.
   * Works in both normal and dry-run modes by comparing content directly.
   */
  wouldChange(fileName: string, content: string): boolean {
    const filePath = join(this.workDir, fileName);

    // Runtime path traversal check using relative path
    const resolvedPath = resolve(filePath);
    const resolvedWorkDir = resolve(this.workDir);
    const relativePath = relative(resolvedWorkDir, resolvedPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`Path traversal detected: ${fileName}`);
    }

    // Normalize trailing newline - ensure exactly one
    const newContent = content.endsWith("\n") ? content : content + "\n";

    if (!existsSync(filePath)) {
      // File doesn't exist, so writing it would be a change
      return true;
    }

    try {
      const existingContent = readFileSync(filePath, "utf-8");
      return existingContent !== newContent;
    } catch {
      // If we can't read the file, assume it would change
      return true;
    }
  }

  async hasChanges(): Promise<boolean> {
    const status = await this.exec("git status --porcelain", this.workDir);
    return status.length > 0;
  }

  async commit(message: string): Promise<void> {
    if (this.dryRun) {
      return;
    }
    await this.exec("git add -A", this.workDir);
    await this.exec(`git commit -m ${escapeShellArg(message)}`, this.workDir);
  }

  async push(branchName: string): Promise<void> {
    if (this.dryRun) {
      return;
    }
    await this.execWithRetry(
      `git push -u origin ${escapeShellArg(branchName)}`,
      this.workDir,
    );
  }

  async getDefaultBranch(): Promise<{ branch: string; method: string }> {
    try {
      // Try to get the default branch from remote (network operation with retry)
      const remoteInfo = await this.execWithRetry(
        "git remote show origin",
        this.workDir,
      );
      const match = remoteInfo.match(/HEAD branch: (\S+)/);
      if (match) {
        return { branch: match[1], method: "remote HEAD" };
      }
    } catch {
      // Fallback methods
    }

    // Try common default branch names (local operations, no retry needed)
    try {
      await this.exec("git rev-parse --verify origin/main", this.workDir);
      return { branch: "main", method: "origin/main exists" };
    } catch {
      // Try master
    }

    try {
      await this.exec("git rev-parse --verify origin/master", this.workDir);
      return { branch: "master", method: "origin/master exists" };
    } catch {
      // Default to main
    }

    return { branch: "main", method: "fallback default" };
  }
}

export function sanitizeBranchName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, "") // Remove extension
    .replace(/[^a-z0-9-]/g, "-") // Replace non-alphanumeric with dashes
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, ""); // Remove leading/trailing dashes
}
