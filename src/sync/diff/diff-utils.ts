export type { FileStatus } from "../../shared/file-status.js";
export { formatStatusBadge } from "../../shared/file-status.js";
import { formatDiffLine } from "../../shared/diff-format.js";
import type { FileStatus } from "../../shared/file-status.js";

export function getFileStatus(exists: boolean, changed: boolean): FileStatus {
  if (!exists) return "NEW";
  return changed ? "MODIFIED" : "UNCHANGED";
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".db",
  ".sqlite",
  ".jar",
  ".class",
  ".pyc",
  ".wasm",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
]);

/**
 * Check if a file is likely binary based on its extension.
 */
export function isBinaryFile(fileName: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Compute a unified diff between old and new content.
 * Returns raw diff lines (no ANSI formatting).
 *
 * - oldContent === null → new file (all additions)
 * - newContent === null → deleted file (all removals)
 * - both null → empty array
 */
export function computeUnifiedDiff(
  oldContent: string | null,
  newContent: string | null,
  contextLines: number = 3
): string[] {
  if (oldContent === null && newContent === null) {
    return [];
  }

  // New file: all additions
  if (oldContent === null) {
    const newLines = newContent!.split("\n");
    // Filter trailing empty string from split
    const lines =
      newLines[newLines.length - 1] === "" ? newLines.slice(0, -1) : newLines;
    if (lines.length === 0) return [];
    const result: string[] = [`@@ -0,0 +1,${lines.length} @@`];
    for (const line of lines) {
      result.push(`+${line}`);
    }
    return result;
  }

  // Deleted file: all removals
  if (newContent === null) {
    const oldLines = oldContent.split("\n");
    const lines =
      oldLines[oldLines.length - 1] === "" ? oldLines.slice(0, -1) : oldLines;
    if (lines.length === 0) return [];
    const result: string[] = [`@@ -1,${lines.length} +0,0 @@`];
    for (const line of lines) {
      result.push(`-${line}`);
    }
    return result;
  }

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const hunks = computeDiffHunks(oldLines, newLines, contextLines);
  if (hunks.length === 0) return [];

  const result: string[] = [];
  for (const hunk of hunks) {
    result.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
    );
    for (const line of hunk.lines) {
      result.push(line);
    }
  }
  return result;
}

/**
 * Generate a unified diff between old and new content.
 * Returns an array of formatted (chalk-colored) diff lines.
 */
export function generateDiff(
  oldContent: string | null,
  newContent: string,
  contextLines: number = 3
): string[] {
  return computeUnifiedDiff(oldContent, newContent, contextLines).map(
    formatDiffLine
  );
}

/**
 * Compute diff hunks using a simple line-by-line comparison.
 * This is a simplified diff that shows changed regions with context.
 */
function computeDiffHunks(
  oldLines: string[],
  newLines: string[],
  contextLines: number
): DiffHunk[] {
  const editScript = computeEditScript(oldLines, newLines);

  if (editScript.length === 0) {
    return [];
  }

  return groupIntoHunks(editScript, oldLines, newLines, contextLines);
}

type EditOp =
  | { type: "keep"; oldIdx: number; newIdx: number }
  | { type: "delete"; oldIdx: number }
  | { type: "insert"; newIdx: number };

/**
 * Compute an edit script using a simple O(mn) LCS algorithm.
 */
function computeEditScript(oldLines: string[], newLines: string[]): EditOp[] {
  const m = oldLines.length;
  const n = newLines.length;

  const lcs: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  const ops: EditOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ type: "keep", oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      ops.unshift({ type: "insert", newIdx: j - 1 });
      j--;
    } else {
      ops.unshift({ type: "delete", oldIdx: i - 1 });
      i--;
    }
  }

  return ops;
}

/**
 * Group edit operations into hunks with context lines.
 */
function groupIntoHunks(
  ops: EditOp[],
  oldLines: string[],
  newLines: string[],
  contextLines: number
): DiffHunk[] {
  const changeRanges: { start: number; end: number }[] = [];
  let inChange = false;
  let changeStart = 0;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type !== "keep") {
      if (!inChange) {
        inChange = true;
        changeStart = i;
      }
    } else if (inChange) {
      changeRanges.push({ start: changeStart, end: i });
      inChange = false;
    }
  }
  if (inChange) {
    changeRanges.push({ start: changeStart, end: ops.length });
  }

  if (changeRanges.length === 0) {
    return [];
  }

  const mergedRanges: { start: number; end: number }[] = [];
  let currentRange = { ...changeRanges[0] };

  for (let i = 1; i < changeRanges.length; i++) {
    const range = changeRanges[i];
    if (range.start - currentRange.end <= contextLines * 2) {
      currentRange.end = range.end;
    } else {
      mergedRanges.push(currentRange);
      currentRange = { ...range };
    }
  }
  mergedRanges.push(currentRange);

  // Build hunks with context
  const hunks: DiffHunk[] = [];

  for (const range of mergedRanges) {
    const contextStart = Math.max(0, range.start - contextLines);
    const contextEnd = Math.min(ops.length, range.end + contextLines);

    const hunkOps = ops.slice(contextStart, contextEnd);
    const lines: string[] = [];

    let oldStart = 1;
    let newStart = 1;
    let oldCount = 0;
    let newCount = 0;

    // Calculate starting positions
    for (let i = 0; i < contextStart; i++) {
      const op = ops[i];
      if (op.type === "keep" || op.type === "delete") {
        oldStart++;
      }
      if (op.type === "keep" || op.type === "insert") {
        newStart++;
      }
    }

    // Build hunk lines
    for (const op of hunkOps) {
      switch (op.type) {
        case "keep":
          lines.push(` ${oldLines[op.oldIdx]}`);
          oldCount++;
          newCount++;
          break;
        case "delete":
          lines.push(`-${oldLines[op.oldIdx]}`);
          oldCount++;
          break;
        case "insert":
          lines.push(`+${newLines[op.newIdx]}`);
          newCount++;
          break;

        default: {
          const _exhaustive: never = op;
          throw new Error(`Unexpected diff op: ${String(_exhaustive)}`);
        }
      }
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, lines });
  }

  return hunks;
}

export interface DiffStats {
  newCount: number;
  modifiedCount: number;
  unchangedCount: number;
  deletedCount: number;
}

export function createDiffStats(): DiffStats {
  return { newCount: 0, modifiedCount: 0, unchangedCount: 0, deletedCount: 0 };
}

export function incrementDiffStats(stats: DiffStats, status: FileStatus): void {
  switch (status) {
    case "NEW":
      stats.newCount++;
      break;
    case "MODIFIED":
      stats.modifiedCount++;
      break;
    case "UNCHANGED":
      stats.unchangedCount++;
      break;
    case "DELETED":
      stats.deletedCount++;
      break;
    default: {
      const _: never = status;
      throw new Error(`Unknown FileStatus: ${String(_)}`);
    }
  }
}
