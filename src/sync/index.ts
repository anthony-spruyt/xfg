export { FileWriter } from "./file-writer.js";
export { ManifestManager } from "./manifest-manager.js";
export { BranchManager } from "./branch-manager.js";
export { AuthOptionsBuilder } from "./auth-options-builder.js";
export { RepositorySession } from "./repository-session.js";
export { CommitPushManager } from "./commit-push-manager.js";
export { FileSyncOrchestrator } from "./file-sync-orchestrator.js";
export { PRMergeHandler } from "./pr-merge-handler.js";

// Strategy pattern components
export { FileSyncStrategy } from "./file-sync-strategy.js";
export { SyncWorkflow } from "./sync-workflow.js";
export type {
  IFileWriter,
  IManifestManager,
  IBranchManager,
  IAuthOptionsBuilder,
  IRepositorySession,
  SessionContext,
  ICommitPushManager,
  GitOpsFactory,
  IRepositoryProcessor,
  ProcessorOptions,
  ProcessorResult,
  IFileSyncOrchestrator,
  IPRMergeHandler,
  WorkResult,
  IWorkStrategy,
  ISyncWorkflow,
} from "./types.js";

// Repository processor
export { RepositoryProcessor } from "./repository-processor.js";
