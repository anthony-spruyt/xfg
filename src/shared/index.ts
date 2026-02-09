// Logging
export { Logger, logger, type ILogger, type LoggerStats } from "./logger.js";

// Retry utilities
export {
  withRetry,
  isPermanentError,
  isTransientError,
  promisify,
  DEFAULT_PERMANENT_ERROR_PATTERNS,
  DEFAULT_TRANSIENT_ERROR_PATTERNS,
  AbortError,
  type RetryOptions,
} from "./retry-utils.js";

// Command execution
export {
  ShellCommandExecutor,
  defaultExecutor,
  type ICommandExecutor,
} from "./command-executor.js";

// Shell utilities
export { escapeShellArg } from "./shell-utils.js";

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
  type RepoType,
  type RepoInfo,
  type GitHubRepoInfo,
  type AzureDevOpsRepoInfo,
  type GitLabRepoInfo,
  type RepoDetectorContext,
} from "./repo-detector.js";
