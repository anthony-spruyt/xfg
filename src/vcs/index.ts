// Types
export type {
  PRMergeConfig,
  FileChange,
  FileAction,
  FileActionKind,
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
export { createCommitStrategy, createTokenManager } from "./commit/index.js";
export { FileModeFixupCommitStrategy } from "./commit/index.js";
// Token manager type (concrete class used as type by sync module)
export type { GitHubAppTokenManager } from "./auth/index.js";
// Git operations
export { GitOps } from "./git-ops.js";
export { AuthenticatedGitOps } from "./authenticated-git-ops.js";
// PR strategy factory
export { createPRStrategy } from "./pr/index.js";
// PR creation and merge
export { createPR, mergePR } from "./pr/index.js";
