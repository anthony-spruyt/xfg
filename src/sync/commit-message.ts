import type { FileAction } from "../vcs/pr-creator.js";

/**
 * Format a commit message based on the files being changed.
 *
 * Rules:
 * - Delete-only: "chore: remove <file>" or "chore: remove N orphaned config files"
 * - Single file: "chore: sync <file>"
 * - 2-3 files: "chore: sync file1, file2, file3"
 * - 4+ files: "chore: sync N config files"
 */
export function formatCommitMessage(files: FileAction[]): string {
  const changedFiles = files.filter((f) => f.action !== "skip");
  const deletedFiles = changedFiles.filter((f) => f.action === "delete");
  const syncedFiles = changedFiles.filter((f) => f.action !== "delete");

  if (syncedFiles.length === 0 && deletedFiles.length > 0) {
    if (deletedFiles.length === 1) {
      return `chore: remove ${deletedFiles[0].fileName}`;
    }
    return `chore: remove ${deletedFiles.length} orphaned config files`;
  }

  if (changedFiles.length === 1) {
    return `chore: sync ${changedFiles[0].fileName}`;
  }

  if (changedFiles.length <= 3) {
    return `chore: sync ${changedFiles.map((f) => f.fileName).join(", ")}`;
  }

  return `chore: sync ${changedFiles.length} config files`;
}
