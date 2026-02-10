export { FileWriter, shouldBeExecutable } from "./file-writer.js";
export { ManifestManager } from "./manifest-manager.js";
export { BranchManager } from "./branch-manager.js";
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
} from "./types.js";

// Repository processor
export {
  RepositoryProcessor,
  type IRepositoryProcessor,
  type ProcessorResult,
  type ProcessorOptions,
  type GitOpsFactory,
} from "./repository-processor.js";

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
