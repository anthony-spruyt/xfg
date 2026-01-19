import {
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { escapeShellArg } from "./shell-utils.js";
import { CommandExecutor, defaultExecutor } from "./command-executor.js";
import { withRetry } from "./retry-utils.js";
import { logger } from "./logger.js";

/**
 * Patterns indicating a git branch does not exist.
 * Used to distinguish "branch not found" from other errors.
 */
const BRANCH_NOT_FOUND_PATTERNS = [
  "couldn't find remote ref",
  "pathspec",
  "did not match any",
];

/**
 * Checks if an error message indicates a branch was not found.
 */
function isBranchNotFoundError(message: string): boolean {
  return BRANCH_NOT_FOUND_PATTERNS.some((pattern) => message.includes(pattern));
}

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

  /**
   * Validates that a file path doesn't escape the workspace directory.
   * @returns The resolved absolute file path
   * @throws Error if path traversal is detected
   */
  private validatePath(fileName: string): string {
    const filePath = join(this.workDir, fileName);
    const resolvedPath = resolve(filePath);
    const resolvedWorkDir = resolve(this.workDir);
    const relativePath = relative(resolvedWorkDir, resolvedPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`Path traversal detected: ${fileName}`);
    }
    return filePath;
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
      // Ensure clean workspace before checkout (defensive - handles edge cases)
      await this.exec("git reset --hard HEAD", this.workDir);
      await this.exec("git clean -fd", this.workDir);
      await this.execWithRetry(
        `git checkout ${escapeShellArg(branchName)}`,
        this.workDir,
      );
      return;
    } catch (error) {
      // Only proceed to create branch if error indicates branch doesn't exist
      const message = error instanceof Error ? error.message : String(error);

      if (!isBranchNotFoundError(message)) {
        throw new Error(
          `Failed to fetch/checkout branch '${branchName}': ${message}`,
        );
      }
    }

    // Branch doesn't exist on remote, create it locally
    try {
      await this.exec(
        `git checkout -b ${escapeShellArg(branchName)}`,
        this.workDir,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create branch '${branchName}': ${message}`);
    }
  }

  writeFile(fileName: string, content: string): void {
    if (this.dryRun) {
      return;
    }
    const filePath = this.validatePath(fileName);

    // Create parent directories if they don't exist
    mkdirSync(dirname(filePath), { recursive: true });

    // Normalize trailing newline - ensure exactly one
    const normalized = content.endsWith("\n") ? content : content + "\n";
    writeFileSync(filePath, normalized, "utf-8");
  }

  /**
   * Marks a file as executable in git using update-index --chmod=+x.
   * This modifies the file mode in git's index, not the filesystem.
   * @param fileName - The file path relative to the work directory
   */
  async setExecutable(fileName: string): Promise<void> {
    if (this.dryRun) {
      return;
    }
    const filePath = this.validatePath(fileName);
    // Use relative path from workDir for git command
    const relativePath = relative(this.workDir, filePath);
    await this.exec(
      `git update-index --chmod=+x ${escapeShellArg(relativePath)}`,
      this.workDir,
    );
  }

  /**
   * Checks if writing the given content would result in changes.
   * Works in both normal and dry-run modes by comparing content directly.
   */
  wouldChange(fileName: string, content: string): boolean {
    const filePath = this.validatePath(fileName);

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
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.info(`Debug: git remote show origin failed - ${msg}`);
    }

    // Try common default branch names (local operations, no retry needed)
    try {
      await this.exec("git rev-parse --verify origin/main", this.workDir);
      return { branch: "main", method: "origin/main exists" };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.info(`Debug: origin/main check failed - ${msg}`);
    }

    try {
      await this.exec("git rev-parse --verify origin/master", this.workDir);
      return { branch: "master", method: "origin/master exists" };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.info(`Debug: origin/master check failed - ${msg}`);
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

/**
 * Validates a user-provided branch name against git's naming rules.
 * @throws Error if the branch name is invalid
 */
export function validateBranchName(branchName: string): void {
  if (!branchName || branchName.trim() === "") {
    throw new Error("Branch name cannot be empty");
  }

  if (branchName.startsWith(".") || branchName.startsWith("-")) {
    throw new Error('Branch name cannot start with "." or "-"');
  }

  // Git disallows: space, ~, ^, :, ?, *, [, \, and consecutive dots (..)
  if (/[\s~^:?*\[\\]/.test(branchName) || branchName.includes("..")) {
    throw new Error("Branch name contains invalid characters");
  }

  if (
    branchName.endsWith("/") ||
    branchName.endsWith(".lock") ||
    branchName.endsWith(".")
  ) {
    throw new Error("Branch name has invalid ending");
  }
}
