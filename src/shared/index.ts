// Logging
export {
  Logger,
  NO_OP_DEBUG_LOG,
  type ILogger,
  type DebugLog,
  type DebugWarnLog,
  type DebugInfoLog,
  type DebugInfoWarnLog,
} from "./logger.js";

// Retry utilities
export {
  withRetry,
  isPermanentError,
  isTransientError,
  DEFAULT_PERMANENT_ERROR_PATTERNS,
} from "./retry-utils.js";

// Command execution
export {
  ShellCommandExecutor,
  type ICommandExecutor,
} from "./command-executor.js";

// Shell utilities
export { escapeShellArg, escapeRegExp } from "./shell-utils.js";

// Sanitization
export { sanitizeCredentials } from "./sanitize-utils.js";

// Environment
export {
  interpolateEnvVars,
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

// Errors
export {
  ValidationError,
  GraphQLApiError,
  SyncError,
  LifecycleError,
} from "./errors.js";

// File status
export { formatStatusBadge, type FileStatus } from "./file-status.js";

// GitHub API utilities
export {
  GhApiClient,
  getHostnameFlag,
  buildTokenEnv,
  resolveGitHubToken,
  isHttp404Error,
  parseApiJson,
  type GhApiOptions,
} from "./gh-api-utils.js";

// Interpolation engine
export {
  interpolateString,
  interpolateValue,
  type InterpolationConfig,
} from "./interpolation-engine.js";

// String utilities
export { camelToSnake } from "./string-utils.js";

// Type guards
export { isPlainObject, toErrorMessage, safeCleanup } from "./type-guards.js";

// XFG templating
export {
  interpolateXfgContent,
  type XfgTemplateContext,
} from "./xfg-template.js";
