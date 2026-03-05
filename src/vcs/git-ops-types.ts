/**
 * Options for authenticated git operations.
 */
export interface GitAuthOptions {
  /** Access token for authentication */
  token: string;
  /** Git host (e.g., "github.com", "github.mycompany.com") */
  host: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
}

/**
 * Local filesystem and git operations that don't require authentication.
 * Implemented by GitOps directly — no wrapping needed.
 */
export interface ILocalGitOps {
  cleanWorkspace(): void;
  createBranch(branchName: string): Promise<void>;
  writeFile(fileName: string, content: string): void;
  setExecutable(fileName: string): Promise<void>;
  getFileContent(fileName: string): string | null;
  wouldChange(fileName: string, content: string): boolean;
  hasChanges(): Promise<boolean>;
  getChangedFiles(): Promise<string[]>;
  hasStagedChanges(): Promise<boolean>;
  fileExistsOnBranch(fileName: string, branch: string): Promise<boolean>;
  fileExists(fileName: string): boolean;
  deleteFile(fileName: string): void;
  commit(message: string): Promise<boolean>;
  getDefaultBranchLocal(): Promise<{ branch: string; method: string }>;
}

/**
 * Network git operations that may require authentication.
 * Implemented by AuthenticatedGitOps which adds token-based auth.
 */
export interface INetworkGitOps {
  clone(gitUrl: string): Promise<void>;
  fetch(options?: { prune?: boolean }): Promise<void>;
  push(branchName: string, options?: { force?: boolean }): Promise<void>;
  getDefaultBranch(): Promise<{ branch: string; method: string }>;
  lsRemote(
    branchName: string,
    options?: { skipRetry?: boolean }
  ): Promise<string>;
  pushRefspec(refspec: string, options?: { delete?: boolean }): Promise<void>;
  fetchBranch(branchName: string): Promise<void>;
}
