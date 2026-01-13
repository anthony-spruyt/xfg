import { execSync } from 'node:child_process';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }

  cleanWorkspace(): void {
    if (existsSync(this.workDir)) {
      rmSync(this.workDir, { recursive: true, force: true });
    }
    mkdirSync(this.workDir, { recursive: true });
  }

  clone(gitUrl: string): void {
    this.exec(`git clone "${gitUrl}" .`, this.workDir);
  }

  createBranch(branchName: string): void {
    try {
      // Check if branch exists on remote
      this.exec(`git fetch origin ${branchName}`, this.workDir);
      this.exec(`git checkout ${branchName}`, this.workDir);
    } catch {
      // Branch doesn't exist, create it
      this.exec(`git checkout -b ${branchName}`, this.workDir);
    }
  }

  writeFile(fileName: string, content: string): void {
    const filePath = join(this.workDir, fileName);
    writeFileSync(filePath, content + '\n', 'utf-8');
  }

  hasChanges(): boolean {
    const status = this.exec('git status --porcelain', this.workDir);
    return status.length > 0;
  }

  commit(message: string): void {
    if (this.dryRun) {
      return;
    }
    this.exec('git add -A', this.workDir);
    this.exec(`git commit -m "${message}"`, this.workDir);
  }

  push(branchName: string): void {
    if (this.dryRun) {
      return;
    }
    this.exec(`git push -u origin ${branchName}`, this.workDir);
  }

  getDefaultBranch(): string {
    try {
      // Try to get the default branch from remote
      const remoteInfo = this.exec('git remote show origin', this.workDir);
      const match = remoteInfo.match(/HEAD branch: (\S+)/);
      if (match) {
        return match[1];
      }
    } catch {
      // Fallback methods
    }

    // Try common default branch names
    try {
      this.exec('git rev-parse --verify origin/main', this.workDir);
      return 'main';
    } catch {
      // Try master
    }

    try {
      this.exec('git rev-parse --verify origin/master', this.workDir);
      return 'master';
    } catch {
      // Default to main
    }

    return 'main';
  }
}

export function sanitizeBranchName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, '') // Remove extension
    .replace(/[^a-z0-9-]/g, '-') // Replace non-alphanumeric with dashes
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
}
