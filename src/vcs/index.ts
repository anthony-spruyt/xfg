// Types
export type {
  PRMergeConfig,
  FileChange,
  FileAction,
  IGitOps,
  ILocalGitOps,
  INetworkGitOps,
  IPRStrategy,
  GitAuthOptions,
  PRResult,
  PRStrategyOptions,
  MergeOptions,
  MergeResult,
  CloseExistingPROptions,
  CommitOptions,
  CommitResult,
  ICommitStrategy,
} from "./types.js";

// Git operations options
export type { GitOpsOptions } from "./git-ops.js";

// Commit strategies
export {
  getCommitStrategy,
  createTokenManager,
} from "./commit-strategy-selector.js";
// PR strategy factory
export { getPRStrategy } from "./pr-strategy-factory.js";
// PR creation and merge
export { createPR, mergePR } from "./pr-creator.js";
