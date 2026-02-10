export { FileWriter, shouldBeExecutable } from "./file-writer.js";
export { ManifestManager } from "./manifest-manager.js";
export { BranchManager } from "./branch-manager.js";
export { AuthOptionsBuilder } from "./auth-options-builder.js";
export { RepositorySession } from "./repository-session.js";
export { CommitPushManager } from "./commit-push-manager.js";
export type {
  IFileWriter,
  FileWriteContext,
  FileWriterDeps,
  FileWriteAllResult,
  FileWriteResult,
  IManifestManager,
  OrphanProcessResult,
  OrphanDeleteOptions,
  OrphanDeleteDeps,
  IBranchManager,
  BranchSetupOptions,
  IAuthOptionsBuilder,
  AuthResult,
  IRepositorySession,
  SessionOptions,
  SessionContext,
  ICommitPushManager,
  CommitPushOptions,
  CommitPushResult,
  GitOpsFactory,
  IRepositoryProcessor,
  ProcessorOptions,
  ProcessorResult,
} from "./types.js";

// Repository processor
export { RepositoryProcessor } from "./repository-processor.js";

// Manifest handling
export {
  createEmptyManifest,
  loadManifest,
  saveManifest,
  getManagedFiles,
  getManagedRulesets,
  updateManifest,
  updateManifestRulesets,
  MANIFEST_FILENAME,
  type XfgManifest,
  type XfgManifestConfigEntry,
} from "./manifest.js";

// Diff utilities
export {
  getFileStatus,
  formatStatusBadge,
  formatDiffLine,
  generateDiff,
  createDiffStats,
  incrementDiffStats,
  type FileStatus,
  type DiffStats,
} from "./diff-utils.js";

// XFG templating
export {
  interpolateXfgContent,
  type XfgTemplateContext,
  type XfgInterpolationOptions,
} from "./xfg-template.js";
