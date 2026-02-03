import type { IGitOps } from "../../src/git-ops.js";

export interface GitOpsMockConfig {
  // Return value overrides
  fileExists?: boolean | ((fileName: string) => boolean);
  fileContent?: string | null | ((fileName: string) => string | null);
  wouldChange?: boolean;
  hasChanges?: boolean;
  hasStagedChanges?: boolean;
  changedFiles?: string[];
  defaultBranch?: { branch: string; method: string };
  commitResult?: boolean;
  fileExistsOnBranch?:
    | boolean
    | ((fileName: string, branch: string) => boolean);

  // Error simulation
  cloneError?: Error;
  pushError?: Error;
  commitError?: Error;
  cleanupError?: Error;
}

export interface GitOpsMockCalls {
  clone: Array<{ gitUrl: string }>;
  fetch: Array<{ options?: { prune?: boolean } }>;
  createBranch: Array<{ branchName: string }>;
  commit: Array<{ message: string }>;
  push: Array<{ branchName: string; force?: boolean }>;
  writeFile: Array<{ fileName: string; content: string }>;
  deleteFile: Array<{ fileName: string }>;
  setExecutable: Array<{ fileName: string }>;
}

export interface GitOpsMockResult {
  mock: IGitOps;
  calls: GitOpsMockCalls;
  reset: () => void;
}

export function createMockGitOps(
  config: GitOpsMockConfig = {}
): GitOpsMockResult {
  const calls: GitOpsMockCalls = {
    clone: [],
    fetch: [],
    createBranch: [],
    commit: [],
    push: [],
    writeFile: [],
    deleteFile: [],
    setExecutable: [],
  };

  const mock: IGitOps = {
    cleanWorkspace(): void {
      if (config.cleanupError) {
        throw config.cleanupError;
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
    },

    async setExecutable(fileName: string): Promise<void> {
      calls.setExecutable.push({ fileName });
    },

    getFileContent(fileName: string): string | null {
      if (typeof config.fileContent === "function") {
        return config.fileContent(fileName);
      }
      return config.fileContent ?? null;
    },

    deleteFile(fileName: string): void {
      calls.deleteFile.push({ fileName });
    },

    wouldChange(_fileName: string, _content: string): boolean {
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
  };

  return {
    mock,
    calls,
    reset: () => {
      calls.clone.length = 0;
      calls.fetch.length = 0;
      calls.createBranch.length = 0;
      calls.commit.length = 0;
      calls.push.length = 0;
      calls.writeFile.length = 0;
      calls.deleteFile.length = 0;
      calls.setExecutable.length = 0;
    },
  };
}
