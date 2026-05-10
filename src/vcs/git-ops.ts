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
import type { ICommandExecutor } from "../shared/command-executor.js";
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
  private readonly workDir: string;
  private readonly dryRun: boolean;
  private readonly executor: ICommandExecutor;
  private readonly log?: DebugLog;

  constructor(options: GitOpsOptions) {
    this.workDir = options.workDir;
    this.dryRun = options.dryRun ?? false;
    this.executor = options.executor;
    this.log = options.log;
  }

  private exec(
    executable: string,
    args: string[],
    cwd?: string
  ): Promise<string> {
    return this.executor.exec(executable, args, cwd ?? this.workDir);
  }

  /**
   * Validates that a file path doesn't escape the workspace directory.
   * @returns The resolved absolute file path
   * @throws ValidationError if path traversal is detected
   */
  private validatePath(fileName: string): string {
    const filePath = join(this.workDir, fileName);
    const resolvedPath = resolve(filePath);
    const resolvedWorkDir = resolve(this.workDir);
    const relativePath = relative(resolvedWorkDir, resolvedPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new ValidationError(`Path traversal detected: ${fileName}`);
    }
    return filePath;
  }

  cleanWorkspace(): void {
    try {
      if (existsSync(this.workDir)) {
        rmSync(this.workDir, { recursive: true, force: true });
      }
      mkdirSync(this.workDir, { recursive: true });
    } catch (error) {
      throw new SyncError(
        `Failed to clean workspace '${this.workDir}': ${toErrorMessage(error)}`,
        { cause: error }
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
      await this.exec("git", ["checkout", "-b", branchName]);
    } catch (error) {
      const message = toErrorMessage(error);
      throw new SyncError(
        `Failed to create branch '${branchName}': ${message}`,
        { cause: error }
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
        `Failed to write file '${fileName}': ${toErrorMessage(error)}`,
        { cause: error }
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
        `Failed to set executable permissions on '${fileName}': ${toErrorMessage(error)}`,
        { cause: error }
      );
    }

    const relativePath = relative(this.workDir, filePath);
    await this.exec("git", [
      "update-index",
      "--add",
      "--chmod=+x",
      relativePath,
    ]);
  }

  /**
   * Clears the executable bit on a file both on the filesystem and in git's index.
   * Symmetric inverse of setExecutable.
   * @param fileName - The file path relative to the work directory
   */
  async clearExecutable(fileName: string): Promise<void> {
    if (this.dryRun) return;
    const filePath = this.validatePath(fileName);
    try {
      chmodSync(filePath, 0o644);
    } catch (error) {
      throw new SyncError(
        `Failed to clear executable permissions on '${fileName}': ${toErrorMessage(error)}`,
        { cause: error }
      );
    }
    await this.exec("git", ["update-index", "--chmod=-x", "--", fileName]);
  }

  /**
   * Returns the git index mode for a tracked file ("100755" or "100644"),
   * or null if the file is not tracked.
   * @param fileName - The file path relative to the work directory
   */
  async getFileMode(fileName: string): Promise<"100755" | "100644" | null> {
    this.validatePath(fileName);
    const output = await this.exec("git", ["ls-files", "-s", "--", fileName]);
    const line = output.trim();
    if (!line) return null;
    const mode = line.split(/\s+/, 1)[0];
    if (mode === "100755" || mode === "100644") return mode;
    return null;
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
      throw error;
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
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES") {
        this.log?.debug(
          `Failed to read ${fileName} for comparison: ${toErrorMessage(error)}`
        );
        return true;
      }
      throw error;
    }
  }

  async hasChanges(): Promise<boolean> {
    const status = await this.exec("git", ["status", "--porcelain"]);
    return status.length > 0;
  }

  /**
   * Get list of files that have changes according to git status.
   * Returns relative file paths for files that are modified, added, or untracked.
   */
  async getChangedFiles(): Promise<string[]> {
    const status = await this.exec("git", ["status", "--porcelain"]);
    if (!status) return [];

    return status
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => line.slice(3)); // Remove status prefix (e.g., " M ", "?? ", "A  ")
  }

  async stageAll(): Promise<void> {
    await this.exec("git", ["add", "-A"]);
  }

  async hasStagedChanges(): Promise<boolean> {
    const diff = await this.exec("git", ["diff", "--cached", "--name-only"]);
    return diff.length > 0;
  }

  /**
   * Check if a file exists on a specific branch.
   * Used for createOnly checks against the base branch (not the working directory).
   */
  async fileExistsOnBranch(fileName: string, branch: string): Promise<boolean> {
    try {
      await this.exec("git", ["show", "--", `${branch}:${fileName}`]);
      return true;
    } catch (error) {
      const message = toErrorMessage(error);
      if (
        message.includes("does not exist") ||
        message.includes("did not match") ||
        message.includes("not found")
      ) {
        this.log?.debug(
          `fileExistsOnBranch(${fileName}, ${branch}): ${message}`
        );
        return false;
      }
      throw error;
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

    try {
      rmSync(filePath);
    } catch (error) {
      throw new SyncError(
        `Failed to delete file '${fileName}': ${toErrorMessage(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Stage all changes and commit with the given message.
   * Uses --no-verify to skip pre-commit hooks (config sync should always succeed).
   * @returns true if a commit was made, or false if there were no staged changes. In dry-run mode, always returns true without inspecting the working tree.
   */
  async commit(message: string): Promise<boolean> {
    if (this.dryRun) {
      return true;
    }
    await this.exec("git", ["add", "-A"]);

    // Check if there are actually staged changes after git add
    if (!(await this.hasStagedChanges())) {
      return false; // No changes to commit
    }

    await this.exec("git", ["commit", "--no-verify", "-m", message]);
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
      await this.exec("git", ["rev-parse", "--verify", "origin/main"]);
      return { branch: "main", method: "origin/main exists" };
    } catch (error) {
      const msg = toErrorMessage(error);
      this.log?.debug(`origin/main check failed - ${msg}`);
    }

    try {
      await this.exec("git", ["rev-parse", "--verify", "origin/master"]);
      return { branch: "master", method: "origin/master exists" };
    } catch (error) {
      const msg = toErrorMessage(error);
      this.log?.debug(`origin/master check failed - ${msg}`);
    }

    return { branch: "main", method: "fallback default" };
  }
}
