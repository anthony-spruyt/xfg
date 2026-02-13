import type { IRepoLifecycleManager } from "../../src/lifecycle/types.js";

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
