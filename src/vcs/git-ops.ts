import {
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { escapeShellArg } from "../shared/shell-utils.js";
import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import { withRetry } from "../shared/retry-utils.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { logger } from "../shared/logger.js";
import type { ILocalGitOps } from "./authenticated-git-ops.js";

export interface GitOpsOptions {
  workDir: string;
  dryRun?: boolean;
  executor?: ICommandExecutor;
  /** Number of retries for network operations (default: 3) */
  retries?: number;
}

export class GitOps implements ILocalGitOps {
  private readonly _workDir: string;
  private readonly dryRun: boolean;
  private readonly _executor: ICommandExecutor;
  private readonly _retries: number;

  get workDir(): string {
    return this._workDir;
  }

  get executor(): ICommandExecutor {
    return this._executor;
  }

  get retries(): number {
    return this._retries;
  }

  constructor(options: GitOpsOptions) {
    this._workDir = options.workDir;
    this.dryRun = options.dryRun ?? false;
    this._executor = options.executor ?? defaultExecutor;
    this._retries = options.retries ?? 3;
  }

  private async exec(command: string, cwd?: string): Promise<string> {
    return this._executor.exec(command, cwd ?? this._workDir);
  }

  /**
   * Run a command with retry logic for transient failures.
   * Used for network operations like clone, fetch, push.
   */
  private async execWithRetry(command: string, cwd?: string): Promise<string> {
    return withRetry(() => this.exec(command, cwd), {
      retries: this._retries,
    });
  }

  /**
   * Validates that a file path doesn't escape the workspace directory.
   * @returns The resolved absolute file path
   * @throws Error if path traversal is detected
   */
  private validatePath(fileName: string): string {
    const filePath = join(this._workDir, fileName);
    const resolvedPath = resolve(filePath);
    const resolvedWorkDir = resolve(this._workDir);
    const relativePath = relative(resolvedWorkDir, resolvedPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`Path traversal detected: ${fileName}`);
    }
    return filePath;
  }

  cleanWorkspace(): void {
    if (existsSync(this._workDir)) {
      rmSync(this._workDir, { recursive: true, force: true });
    }
    mkdirSync(this._workDir, { recursive: true });
  }

  async clone(gitUrl: string): Promise<void> {
    await this.execWithRetry(
      `git clone ${escapeShellArg(gitUrl)} .`,
      this._workDir
    );
  }

  /**
   * Fetch from remote with optional pruning of stale refs.
   * Used to update local tracking refs after remote branch deletion.
   */
  async fetch(options?: { prune?: boolean }): Promise<void> {
    const pruneFlag = options?.prune ? " --prune" : "";
    await this.execWithRetry(`git fetch origin${pruneFlag}`, this._workDir);
  }

  /**
   * Create a new branch from the current HEAD.
   * Always creates fresh - existing branches should be cleaned up beforehand
   * by closing any existing PRs (which deletes the remote branch).
   */
  async createBranch(branchName: string): Promise<void> {
    try {
      await this.exec(
        `git checkout -b ${escapeShellArg(branchName)}`,
        this._workDir
      );
    } catch (error) {
      const message = toErrorMessage(error);
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
   * Marks a file as executable both on the filesystem and in git's index.
   * - Filesystem: Uses chmod to set 755 permissions (rwxr-xr-x)
   * - Git index: Uses update-index --chmod=+x so the mode is committed
   * @param fileName - The file path relative to the work directory
   */
  async setExecutable(fileName: string): Promise<void> {
    if (this.dryRun) {
      return;
    }
    const filePath = this.validatePath(fileName);

    // Set filesystem permissions (755 = rwxr-xr-x)
    chmodSync(filePath, 0o755);

    // Also update git's index so the executable bit is committed
    const relativePath = relative(this._workDir, filePath);
    await this.exec(
      `git update-index --add --chmod=+x ${escapeShellArg(relativePath)}`,
      this._workDir
    );
  }

  /**
   * Get the content of a file in the workspace.
   * Returns null if the file doesn't exist.
   */
  getFileContent(fileName: string): string | null {
    const filePath = this.validatePath(fileName);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      return readFileSync(filePath, "utf-8");
    } catch (error) {
      logger.debug(`Failed to read ${fileName}: ${toErrorMessage(error)}`);
      return null;
    }
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
    } catch (error) {
      logger.debug(
        `Failed to read ${fileName} for comparison: ${toErrorMessage(error)}`
      );
      return true;
    }
  }

  async hasChanges(): Promise<boolean> {
    const status = await this.exec("git status --porcelain", this._workDir);
    return status.length > 0;
  }

  /**
   * Get list of files that have changes according to git status.
   * Returns relative file paths for files that are modified, added, or untracked.
   * Uses the same this.exec() pattern as other methods in this class.
   */
  async getChangedFiles(): Promise<string[]> {
    const status = await this.exec("git status --porcelain", this._workDir);
    if (!status) return [];

    return status
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => line.slice(3)); // Remove status prefix (e.g., " M ", "?? ", "A  ")
  }

  /**
   * Check if there are staged changes ready to commit.
   * Uses `git diff --cached --quiet` which exits with 1 if there are staged changes.
   */
  async hasStagedChanges(): Promise<boolean> {
    try {
      await this.exec("git diff --cached --quiet", this._workDir);
      return false; // Exit code 0 = no staged changes
    } catch (error) {
      // Exit code 1 is expected when staged changes exist
      logger.debug(`hasStagedChanges: ${toErrorMessage(error)}`);
      return true;
    }
  }

  /**
   * Check if a file exists on a specific branch.
   * Used for createOnly checks against the base branch (not the working directory).
   */
  async fileExistsOnBranch(fileName: string, branch: string): Promise<boolean> {
    try {
      await this.exec(
        `git show ${escapeShellArg(branch)}:${escapeShellArg(fileName)}`,
        this._workDir
      );
      return true;
    } catch (error) {
      // Expected when file doesn't exist on branch
      logger.debug(
        `fileExistsOnBranch(${fileName}, ${branch}): ${toErrorMessage(error)}`
      );
      return false;
    }
  }

  /**
   * Check if a file exists in the working directory.
   */
  fileExists(fileName: string): boolean {
    const filePath = this.validatePath(fileName);
    return existsSync(filePath);
  }

  /**
   * Delete a file from the working directory.
   * Does nothing in dry-run mode.
   *
   * @param fileName - The file path relative to the work directory
   */
  deleteFile(fileName: string): void {
    if (this.dryRun) {
      return;
    }
    const filePath = this.validatePath(fileName);

    if (!existsSync(filePath)) {
      return; // File doesn't exist, nothing to delete
    }

    rmSync(filePath);
  }

  /**
   * Stage all changes and commit with the given message.
   * Uses --no-verify to skip pre-commit hooks (config sync should always succeed).
   * @returns true if a commit was made, false if there were no staged changes
   */
  async commit(message: string): Promise<boolean> {
    if (this.dryRun) {
      return true;
    }
    await this.exec("git add -A", this._workDir);

    // Check if there are actually staged changes after git add
    if (!(await this.hasStagedChanges())) {
      return false; // No changes to commit
    }

    // Use --no-verify to skip pre-commit hooks
    await this.exec(
      `git commit --no-verify -m ${escapeShellArg(message)}`,
      this._workDir
    );
    return true;
  }

  async push(branchName: string, options?: { force?: boolean }): Promise<void> {
    if (this.dryRun) {
      return;
    }
    const forceFlag = options?.force ? "--force-with-lease " : "";
    await this.execWithRetry(
      `git push ${forceFlag}-u origin ${escapeShellArg(branchName)}`,
      this._workDir
    );
  }

  async getDefaultBranch(): Promise<{ branch: string; method: string }> {
    try {
      // Try to get the default branch from remote (network operation with retry)
      const remoteInfo = await this.execWithRetry(
        "git remote show origin",
        this._workDir
      );
      const match = remoteInfo.match(/HEAD branch: (\S+)/);
      if (match && match[1] !== "(unknown)") {
        return { branch: match[1], method: "remote HEAD" };
      }
    } catch (error) {
      const msg = toErrorMessage(error);
      logger.debug(`git remote show origin failed - ${msg}`);
    }

    return this.getDefaultBranchLocal();
  }

  /**
   * Fallback default branch detection using local refs only.
   * Checks origin/main, then origin/master, then defaults to "main".
   */
  async getDefaultBranchLocal(): Promise<{
    branch: string;
    method: string;
  }> {
    try {
      await this.exec("git rev-parse --verify origin/main", this._workDir);
      return { branch: "main", method: "origin/main exists" };
    } catch (error) {
      const msg = toErrorMessage(error);
      logger.debug(`origin/main check failed - ${msg}`);
    }

    try {
      await this.exec("git rev-parse --verify origin/master", this._workDir);
      return { branch: "master", method: "origin/master exists" };
    } catch (error) {
      const msg = toErrorMessage(error);
      logger.debug(`origin/master check failed - ${msg}`);
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
  if (/[\s~^:?*[\\]/.test(branchName) || branchName.includes("..")) {
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
