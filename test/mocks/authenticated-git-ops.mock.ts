import type { IGitOps } from "../../src/vcs/types.js";

export interface AuthenticatedGitOpsMockConfig {
  // Return value overrides
  fileExists?: boolean | ((fileName: string) => boolean);
  fileContent?: string | null | ((fileName: string) => string | null);
  wouldChange?: boolean | ((fileName: string, content: string) => boolean);
  hasChanges?: boolean;
  hasStagedChanges?: boolean;
  changedFiles?: string[];
  defaultBranch?: { branch: string; method: string };
  commitResult?: boolean;
  fileExistsOnBranch?:
    | boolean
    | ((fileName: string, branch: string) => boolean);
  lsRemoteResult?: string;

  // Error simulation
  cloneError?: Error;
  pushError?: Error;
  commitError?: Error;
  cleanupError?: Error | ((callCount: number) => Error | undefined);
  lsRemoteError?: Error;

  // Callbacks for side effects (e.g., writing files)
  onWriteFile?: (fileName: string, content: string) => void;
  onDeleteFile?: (fileName: string) => void;
  onSetExecutable?: (fileName: string) => void;
}

export interface LocalGitOpsMockCalls {
  cleanWorkspace: Array<Record<string, never>>;
  createBranch: Array<{ branchName: string }>;
  commit: Array<{ message: string }>;
  writeFile: Array<{ fileName: string; content: string }>;
  deleteFile: Array<{ fileName: string }>;
  setExecutable: Array<{ fileName: string }>;
}

export interface NetworkGitOpsMockCalls {
  clone: Array<{ gitUrl: string }>;
  fetch: Array<{ options?: { prune?: boolean } }>;
  push: Array<{ branchName: string; force?: boolean }>;
  lsRemote: Array<{ branchName: string; options?: { skipRetry?: boolean } }>;
  pushRefspec: Array<{ refspec: string; options?: { delete?: boolean } }>;
  fetchBranch: Array<{ branchName: string }>;
}

export interface AuthenticatedGitOpsMockResult {
  gitOps: IGitOps;
  localCalls: LocalGitOpsMockCalls;
  networkCalls: NetworkGitOpsMockCalls;
  reset: () => void;
}

export function createMockAuthenticatedGitOps(
  config: AuthenticatedGitOpsMockConfig = {}
): AuthenticatedGitOpsMockResult {
  const localCalls: LocalGitOpsMockCalls = {
    cleanWorkspace: [],
    createBranch: [],
    commit: [],
    writeFile: [],
    deleteFile: [],
    setExecutable: [],
  };

  const networkCalls: NetworkGitOpsMockCalls = {
    clone: [],
    fetch: [],
    push: [],
    lsRemote: [],
    pushRefspec: [],
    fetchBranch: [],
  };

  const gitOps: IGitOps = {
    // --- ILocalGitOps methods ---

    cleanWorkspace(): void {
      localCalls.cleanWorkspace.push({});
      if (config.cleanupError) {
        if (typeof config.cleanupError === "function") {
          const error = config.cleanupError(localCalls.cleanWorkspace.length);
          if (error) throw error;
        } else {
          throw config.cleanupError;
        }
      }
    },

    async createBranch(branchName: string): Promise<void> {
      localCalls.createBranch.push({ branchName });
    },

    async commit(message: string): Promise<boolean> {
      localCalls.commit.push({ message });
      if (config.commitError) {
        throw config.commitError;
      }
      return config.commitResult ?? true;
    },

    writeFile(fileName: string, content: string): void {
      localCalls.writeFile.push({ fileName, content });
      if (config.onWriteFile) {
        config.onWriteFile(fileName, content);
      }
    },

    async setExecutable(fileName: string): Promise<void> {
      localCalls.setExecutable.push({ fileName });
      if (config.onSetExecutable) {
        config.onSetExecutable(fileName);
      }
    },

    getFileContent(fileName: string): string | null {
      if (typeof config.fileContent === "function") {
        return config.fileContent(fileName);
      }
      return config.fileContent ?? null;
    },

    deleteFile(fileName: string): void {
      localCalls.deleteFile.push({ fileName });
      if (config.onDeleteFile) {
        config.onDeleteFile(fileName);
      }
    },

    async getDefaultBranchLocal(): Promise<{ branch: string; method: string }> {
      return { branch: "main", method: "mock fallback" };
    },

    wouldChange(fileName: string, content: string): boolean {
      if (typeof config.wouldChange === "function") {
        return config.wouldChange(fileName, content);
      }
      return config.wouldChange ?? true;
    },

    async hasChanges(): Promise<boolean> {
      return config.hasChanges ?? true;
    },

    async getChangedFiles(): Promise<string[]> {
      return config.changedFiles ?? [];
    },

    async hasStagedChanges(): Promise<boolean> {
      return config.hasStagedChanges ?? true;
    },

    async fileExistsOnBranch(
      fileName: string,
      branch: string
    ): Promise<boolean> {
      if (typeof config.fileExistsOnBranch === "function") {
        return config.fileExistsOnBranch(fileName, branch);
      }
      return config.fileExistsOnBranch ?? false;
    },

    fileExists(fileName: string): boolean {
      if (typeof config.fileExists === "function") {
        return config.fileExists(fileName);
      }
      return config.fileExists ?? false;
    },

    // --- INetworkGitOps methods ---

    async clone(gitUrl: string): Promise<void> {
      networkCalls.clone.push({ gitUrl });
      if (config.cloneError) {
        throw config.cloneError;
      }
    },

    async fetch(options?: { prune?: boolean }): Promise<void> {
      networkCalls.fetch.push({ options });
    },

    async push(
      branchName: string,
      options?: { force?: boolean }
    ): Promise<void> {
      networkCalls.push.push({ branchName, force: options?.force });
      if (config.pushError) {
        throw config.pushError;
      }
    },

    async getDefaultBranch(): Promise<{ branch: string; method: string }> {
      return config.defaultBranch ?? { branch: "main", method: "mock" };
    },

    async lsRemote(
      branchName: string,
      options?: { skipRetry?: boolean }
    ): Promise<string> {
      networkCalls.lsRemote.push({ branchName, options });
      if (config.lsRemoteError) {
        throw config.lsRemoteError;
      }
      return config.lsRemoteResult ?? "";
    },

    async pushRefspec(
      refspec: string,
      options?: { delete?: boolean }
    ): Promise<void> {
      networkCalls.pushRefspec.push({ refspec, options });
      if (config.pushError) {
        throw config.pushError;
      }
    },

    async fetchBranch(branchName: string): Promise<void> {
      networkCalls.fetchBranch.push({ branchName });
    },
  };

  return {
    gitOps,
    localCalls,
    networkCalls,
    reset: () => {
      localCalls.cleanWorkspace.length = 0;
      localCalls.createBranch.length = 0;
      localCalls.commit.length = 0;
      localCalls.writeFile.length = 0;
      localCalls.deleteFile.length = 0;
      localCalls.setExecutable.length = 0;
      networkCalls.clone.length = 0;
      networkCalls.fetch.length = 0;
      networkCalls.push.length = 0;
      networkCalls.lsRemote.length = 0;
      networkCalls.pushRefspec.length = 0;
      networkCalls.fetchBranch.length = 0;
    },
  };
}
