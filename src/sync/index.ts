// Types
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

// Diff utilities
export {
  type DiffStats,
  computeUnifiedDiff,
  createDiffStats,
  generateDiff,
  getFileStatus,
  incrementDiffStats,
  isBinaryFile,
} from "./diff/index.js";

// Manifest
export {
  MANIFEST_FILENAME,
  ManifestManager,
  createEmptyManifest,
  getManagedFiles,
  loadManifest,
  parseManifestContent,
  saveManifest,
  updateManifest,
  type XfgManifest,
  type XfgManifestConfigEntry,
} from "./manifest/index.js";

// File sync
export {
  FileSyncOrchestrator,
  FileSyncStrategy,
  FileWriter,
  formatCommitMessage,
} from "./file/index.js";

// Orchestration
export { RepositoryProcessor } from "./repository-processor.js";
