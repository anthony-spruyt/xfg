import { RepoInfo } from "../shared/repo-detector.js";
import { IAuthenticatedGitOps } from "../git/authenticated-git-ops.js";

export interface FileChange {
  path: string;
  content: string | null; // null = deletion
}

export interface CommitOptions {
  repoInfo: RepoInfo;
  branchName: string;
  message: string;
  fileChanges: FileChange[];
  workDir: string;
  retries?: number;
  /** Use force push (--force-with-lease). Default: true for PR branches, false for direct push to main. */
  force?: boolean;
  /** GitHub App installation token for authentication (used by GraphQLCommitStrategy) */
  token?: string;
  /** Authenticated git operations wrapper (used by GraphQLCommitStrategy for network ops) */
  gitOps?: IAuthenticatedGitOps;
}

export interface CommitResult {
  sha: string;
  verified: boolean;
  pushed: boolean;
}

/**
 * Strategy interface for creating commits.
 * Implementations handle platform-specific commit mechanisms.
 */
export interface ICommitStrategy {
  /**
   * Create a commit with the given file changes and push to remote.
   * @returns Commit result with SHA and verification status
   */
  commit(options: CommitOptions): Promise<CommitResult>;
}
