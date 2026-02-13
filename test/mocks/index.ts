export { createMockExecutor } from "./executor.mock.js";
export type {
  ExecutorMockConfig,
  ExecutorMockResult,
  GitCommandTracking,
} from "./executor.mock.js";

export { createMockLogger } from "./logger.mock.js";
export type { LoggerMockResult, DiffStatusEntry } from "./logger.mock.js";

export { createMockGitOps } from "./git-ops.mock.js";
export type {
  GitOpsMockConfig,
  GitOpsMockCalls,
  GitOpsMockResult,
} from "./git-ops.mock.js";

export { createMockAuthenticatedGitOps } from "./authenticated-git-ops.mock.js";
export type {
  AuthenticatedGitOpsMockConfig,
  AuthenticatedGitOpsMockCalls,
  AuthenticatedGitOpsMockResult,
} from "./authenticated-git-ops.mock.js";

export type { MockCallTracker } from "./types.js";

export {
  noopLifecycleManager,
  failingLifecycleManager,
  creatingLifecycleManager,
} from "./lifecycle.mock.js";
