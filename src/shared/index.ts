// Logging
export { Logger, logger, type ILogger } from "./logger.js";

// Retry utilities
export {
  withRetry,
  isPermanentError,
  isTransientError,
  promisify,
  DEFAULT_PERMANENT_ERROR_PATTERNS,
  AbortError,
} from "./retry-utils.js";

// Command execution
export {
  ShellCommandExecutor,
  defaultExecutor,
  type ICommandExecutor,
} from "./command-executor.js";

// Shell utilities
export { escapeShellArg, escapeRegExp } from "./shell-utils.js";

// Sanitization
export { sanitizeCredentials } from "./sanitize-utils.js";

// Environment
export {
  interpolateEnvVars,
  interpolateEnvVarsInString,
  interpolateEnvVarsInLines,
  interpolateContent,
  type EnvInterpolationOptions,
} from "./env.js";

// Workspace utilities
export { generateWorkspaceName } from "./workspace-utils.js";

// Repository detection
export {
  detectRepoType,
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
  isAzureDevOpsRepo,
  isGitLabRepo,
  type RepoInfo,
  type GitHubRepoInfo,
  type AzureDevOpsRepoInfo,
  type GitLabRepoInfo,
} from "./repo-detector.js";
