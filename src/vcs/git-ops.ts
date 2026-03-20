import {
  rmSync,
  existsSync,
  statSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { escapeShellArg } from "../shared/shell-utils.js";
import { ICommandExecutor } from "../shared/command-executor.js";
import type { DebugLog } from "../shared/logger.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { ValidationError, SyncError } from "../shared/errors.js";
import type { ILocalGitOps } from "./types.js";

export interface GitOpsOptions {
  workDir: string;
  dryRun?: boolean;
  executor: ICommandExecutor;
  /** Optional logger for debug messages */
  log?: DebugLog;
}

export class GitOps implements ILocalGitOps {
  private readonly _workDir: string;
  private readonly dryRun: boolean;
  private readonly _executor: ICommandExecutor;
  private readonly log?: DebugLog;

  constructor(options: GitOpsOptions) {
    this._workDir = options.workDir;
    this.dryRun = options.dryRun ?? false;
    this._executor = options.executor;
    this.log = options.log;
  }

  private async exec(command: string, cwd?: string): Promise<string> {
    return this._executor.exec(command, cwd ?? this._workDir);
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
      throw new ValidationError(`Path traversal detected: ${fileName}`);
    }
    return filePath;
  }

  cleanWorkspace(): void {
    try {
      if (existsSync(this._workDir)) {
        rmSync(this._workDir, { recursive: true, force: true });
      }
      mkdirSync(this._workDir, { recursive: true });
    } catch (error) {
      throw new SyncError(
        `Failed to clean workspace '${this._workDir}': ${toErrorMessage(error)}`
      );
    }
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
      throw new SyncError(
        `Failed to create branch '${branchName}': ${message}`
      );
    }
  }

  writeFile(fileName: string, content: string): void {
    if (this.dryRun) {
      return;
    }
    const filePath = this.validatePath(fileName);

    try {
      mkdirSync(dirname(filePath), { recursive: true });

      const normalized = content.endsWith("\n") ? content : content + "\n";
      writeFileSync(filePath, normalized, "utf-8");
    } catch (error) {
      throw new SyncError(
        `Failed to write file '${fileName}': ${toErrorMessage(error)}`
      );
    }
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

    try {
      chmodSync(filePath, 0o755);
    } catch (error) {
      throw new SyncError(
        `Failed to set executable permissions on '${fileName}': ${toErrorMessage(error)}`
      );
    }

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

    try {
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        return null;
      }

      return readFileSync(filePath, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES") {
        return null;
      }
      this.log?.debug(
        `Unexpected error reading ${fileName}: ${toErrorMessage(error)}`
      );
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
      this.log?.debug(
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

  async stageAll(): Promise<void> {
    await this.exec("git add -A", this._workDir);
  }

  async hasStagedChanges(): Promise<boolean> {
    const diff = await this.exec(
      "git diff --cached --name-only",
      this._workDir
    );
    return diff.length > 0;
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
      this.log?.debug(
        `fileExistsOnBranch(${fileName}, ${branch}): ${toErrorMessage(error)}`
      );
      return false;
    }
  }

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
      return;
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
      this.log?.debug(`origin/main check failed - ${msg}`);
    }

    try {
      await this.exec("git rev-parse --verify origin/master", this._workDir);
      return { branch: "master", method: "origin/master exists" };
    } catch (error) {
      const msg = toErrorMessage(error);
      this.log?.debug(`origin/master check failed - ${msg}`);
    }

    return { branch: "main", method: "fallback default" };
  }
}
