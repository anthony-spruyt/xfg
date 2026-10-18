import type {
  CreateRepoSettings,
  IRepoLifecycleManager,
} from "../../src/lifecycle/types.js";

export const noopLifecycleManager: IRepoLifecycleManager = {
  async ensureRepo(_repoConfig, repoInfo) {
    return { repoInfo, action: "existed" };
  },
};

export const failingLifecycleManager: IRepoLifecycleManager = {
  async ensureRepo() {
    throw new Error("Lifecycle check failed: repo creation error");
  },
};

export const creatingLifecycleManager: IRepoLifecycleManager = {
  async ensureRepo(_repoConfig, repoInfo) {
    return { repoInfo, action: "created" };
  },
};

export interface RecordingLifecycleManager extends IRepoLifecycleManager {
  readonly calls: {
    git: string;
    settings: CreateRepoSettings | undefined;
  }[];
}

export function createRecordingLifecycleManager(): RecordingLifecycleManager {
  const calls: RecordingLifecycleManager["calls"] = [];
  return {
    calls,
    async ensureRepo(repoConfig, repoInfo, _options, settings) {
      calls.push({ git: repoConfig.git, settings });
      return { repoInfo, action: "created" };
    },
  };
}
