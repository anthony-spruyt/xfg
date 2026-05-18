export type { FileStatus } from "../../shared/file-status.js";
export { formatStatusBadge } from "../../shared/file-status.js";
export {
  getFileStatus,
  isBinaryFile,
  computeUnifiedDiff,
  generateDiff,
  createDiffStats,
  incrementDiffStats,
  type DiffStats,
} from "./diff-utils.js";
