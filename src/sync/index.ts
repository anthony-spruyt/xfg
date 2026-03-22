export type { DiffStats } from "./diff-utils.js";
export {
  computeUnifiedDiff,
  isBinaryFile,
  formatDiffLine,
} from "./diff-utils.js";
export type {
  FileChangeDetail,
  GitOpsFactory,
  IAuthOptionsBuilder,
  IBranchManager,
  ICommitPushManager,
  IFileSyncOrchestrator,
  IPRMergeHandler,
  IRepositoryProcessor,
  IRepositorySession,
  IWorkStrategy,
  ProcessorResult,
  SessionContext,
  WorkResult,
} from "./types.js";
export { RepositoryProcessor } from "./repository-processor.js";
