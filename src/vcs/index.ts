// Types
export type {
  PRMergeConfig,
  FileChange,
  FileAction,
  IGitOps,
  ILocalGitOps,
  IPRStrategy,
  GitAuthOptions,
  PRResult,
  ICommitStrategy,
} from "./types.js";

// Git operations options
export type { GitOpsOptions } from "./git-ops.js";

// Commit strategies
export {
  createCommitStrategy,
  createTokenManager,
} from "./commit-strategy-selector.js";
// Token manager type (concrete class used as type by sync module)
export type { GitHubAppTokenManager } from "./github-app-token-manager.js";
// Git operations
export { GitOps } from "./git-ops.js";
export { AuthenticatedGitOps } from "./authenticated-git-ops.js";
// PR strategy factory
export { createPRStrategy } from "./pr-strategy-factory.js";
// PR creation and merge
export { createPR, mergePR } from "./pr-creator.js";
