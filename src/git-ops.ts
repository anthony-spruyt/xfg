import { execSync } from "node:child_process";
import {
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { escapeShellArg } from "./shell-utils.js";

export interface GitOpsOptions {
  workDir: string;
  dryRun?: boolean;
}

export class GitOps {
  private workDir: string;
  private dryRun: boolean;

  constructor(options: GitOpsOptions) {
    this.workDir = options.workDir;
    this.dryRun = options.dryRun ?? false;
  }

  private exec(command: string, cwd?: string): string {
    return execSync(command, {
      cwd: cwd ?? this.workDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }

  cleanWorkspace(): void {
    if (existsSync(this.workDir)) {
      rmSync(this.workDir, { recursive: true, force: true });
    }
    mkdirSync(this.workDir, { recursive: true });
  }

  clone(gitUrl: string): void {
    this.exec(`git clone ${escapeShellArg(gitUrl)} .`, this.workDir);
  }

  createBranch(branchName: string): void {
    try {
      // Check if branch exists on remote
      this.exec(`git fetch origin ${escapeShellArg(branchName)}`, this.workDir);
      this.exec(`git checkout ${escapeShellArg(branchName)}`, this.workDir);
    } catch {
      // Branch doesn't exist, create it
      try {
        this.exec(
          `git checkout -b ${escapeShellArg(branchName)}`,
          this.workDir,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create branch '${branchName}': ${message}`);
      }
    }
  }

  writeFile(fileName: string, content: string): void {
    if (this.dryRun) {
      return;
    }
    const filePath = join(this.workDir, fileName);
    writeFileSync(filePath, content + "\n", "utf-8");
  }

  /**
   * Checks if writing the given content would result in changes.
   * Works in both normal and dry-run modes by comparing content directly.
   */
  wouldChange(fileName: string, content: string): boolean {
    const filePath = join(this.workDir, fileName);
    const newContent = content + "\n";

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

  hasChanges(): boolean {
    const status = this.exec("git status --porcelain", this.workDir);
    return status.length > 0;
  }

  commit(message: string): void {
    if (this.dryRun) {
      return;
    }
    this.exec("git add -A", this.workDir);
    this.exec(`git commit -m ${escapeShellArg(message)}`, this.workDir);
  }

  push(branchName: string): void {
    if (this.dryRun) {
      return;
    }
    this.exec(`git push -u origin ${escapeShellArg(branchName)}`, this.workDir);
  }

  getDefaultBranch(): { branch: string; method: string } {
    try {
      // Try to get the default branch from remote
      const remoteInfo = this.exec("git remote show origin", this.workDir);
      const match = remoteInfo.match(/HEAD branch: (\S+)/);
      if (match) {
        return { branch: match[1], method: "remote HEAD" };
      }
    } catch {
      // Fallback methods
    }

    // Try common default branch names
    try {
      this.exec("git rev-parse --verify origin/main", this.workDir);
      return { branch: "main", method: "origin/main exists" };
    } catch {
      // Try master
    }

    try {
      this.exec("git rev-parse --verify origin/master", this.workDir);
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
