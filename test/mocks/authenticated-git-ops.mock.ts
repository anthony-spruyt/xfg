import type { IAuthenticatedGitOps } from "../../src/authenticated-git-ops.js";

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

export interface AuthenticatedGitOpsMockCalls {
  cleanWorkspace: Array<Record<string, never>>;
  clone: Array<{ gitUrl: string }>;
  fetch: Array<{ options?: { prune?: boolean } }>;
  createBranch: Array<{ branchName: string }>;
  commit: Array<{ message: string }>;
  push: Array<{ branchName: string; force?: boolean }>;
  writeFile: Array<{ fileName: string; content: string }>;
  deleteFile: Array<{ fileName: string }>;
  setExecutable: Array<{ fileName: string }>;
  lsRemote: Array<{ branchName: string; options?: { skipRetry?: boolean } }>;
  pushRefspec: Array<{ refspec: string; options?: { delete?: boolean } }>;
  fetchBranch: Array<{ branchName: string }>;
}

export interface AuthenticatedGitOpsMockResult {
  mock: IAuthenticatedGitOps;
  calls: AuthenticatedGitOpsMockCalls;
  reset: () => void;
}

export function createMockAuthenticatedGitOps(
  config: AuthenticatedGitOpsMockConfig = {}
): AuthenticatedGitOpsMockResult {
  const calls: AuthenticatedGitOpsMockCalls = {
    cleanWorkspace: [],
    clone: [],
    fetch: [],
    createBranch: [],
    commit: [],
    push: [],
    writeFile: [],
    deleteFile: [],
    setExecutable: [],
    lsRemote: [],
    pushRefspec: [],
    fetchBranch: [],
  };

  const mock: IAuthenticatedGitOps = {
    cleanWorkspace(): void {
      calls.cleanWorkspace.push({});
      if (config.cleanupError) {
        // Support conditional cleanup error (e.g., only on 2nd call)
        if (typeof config.cleanupError === "function") {
          const error = config.cleanupError(calls.cleanWorkspace.length);
          if (error) throw error;
        } else {
          throw config.cleanupError;
        }
      }
    },

    async clone(gitUrl: string): Promise<void> {
      calls.clone.push({ gitUrl });
      if (config.cloneError) {
        throw config.cloneError;
      }
    },

    async fetch(options?: { prune?: boolean }): Promise<void> {
      calls.fetch.push({ options });
    },

    async createBranch(branchName: string): Promise<void> {
      calls.createBranch.push({ branchName });
    },

    async commit(message: string): Promise<boolean> {
      calls.commit.push({ message });
      if (config.commitError) {
        throw config.commitError;
      }
      return config.commitResult ?? true;
    },

    async push(
      branchName: string,
      options?: { force?: boolean }
    ): Promise<void> {
      calls.push.push({ branchName, force: options?.force });
      if (config.pushError) {
        throw config.pushError;
      }
    },

    async getDefaultBranch(): Promise<{ branch: string; method: string }> {
      return config.defaultBranch ?? { branch: "main", method: "mock" };
    },

    writeFile(fileName: string, content: string): void {
      calls.writeFile.push({ fileName, content });
      if (config.onWriteFile) {
        config.onWriteFile(fileName, content);
      }
    },

    async setExecutable(fileName: string): Promise<void> {
      calls.setExecutable.push({ fileName });
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
      calls.deleteFile.push({ fileName });
      if (config.onDeleteFile) {
        config.onDeleteFile(fileName);
      }
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

    // Additional IAuthenticatedGitOps methods
    async lsRemote(
      branchName: string,
      options?: { skipRetry?: boolean }
    ): Promise<string> {
      calls.lsRemote.push({ branchName, options });
      if (config.lsRemoteError) {
        throw config.lsRemoteError;
      }
      return config.lsRemoteResult ?? "";
    },

    async pushRefspec(
      refspec: string,
      options?: { delete?: boolean }
    ): Promise<void> {
      calls.pushRefspec.push({ refspec, options });
      if (config.pushError) {
        throw config.pushError;
      }
    },

    async fetchBranch(branchName: string): Promise<void> {
      calls.fetchBranch.push({ branchName });
    },
  };

  return {
    mock,
    calls,
    reset: () => {
      calls.cleanWorkspace.length = 0;
      calls.clone.length = 0;
      calls.fetch.length = 0;
      calls.createBranch.length = 0;
      calls.commit.length = 0;
      calls.push.length = 0;
      calls.writeFile.length = 0;
      calls.deleteFile.length = 0;
      calls.setExecutable.length = 0;
      calls.lsRemote.length = 0;
      calls.pushRefspec.length = 0;
      calls.fetchBranch.length = 0;
    },
  };
}
