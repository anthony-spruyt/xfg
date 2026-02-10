// Core git operations
export {
  GitOps,
  sanitizeBranchName,
  validateBranchName,
  type IGitOps,
  type GitOpsOptions,
} from "./git-ops.js";

// Authenticated git operations (with per-command auth)
export {
  AuthenticatedGitOps,
  type IAuthenticatedGitOps,
  type GitAuthOptions,
} from "./authenticated-git-ops.js";

// PR creation
export {
  createPR,
  mergePR,
  formatPRBody,
  formatPRTitle,
  escapeShellArg,
  type PROptions,
  type PRResult,
  type FileAction,
  type MergePROptions,
} from "./pr-creator.js";

// GitHub App token management
export { GitHubAppTokenManager } from "./github-app-token-manager.js";
