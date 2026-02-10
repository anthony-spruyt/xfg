import chalk from "chalk";

export type FileStatus = "NEW" | "MODIFIED" | "UNCHANGED" | "DELETED";

/**
 * Determines file status based on existence and change detection.
 */
export function getFileStatus(exists: boolean, changed: boolean): FileStatus {
  if (!exists) return "NEW";
  return changed ? "MODIFIED" : "UNCHANGED";
}

/**
 * Format a status badge with appropriate color.
 */
export function formatStatusBadge(status: FileStatus): string {
  switch (status) {
    case "NEW":
      return chalk.green("[NEW]");
    case "MODIFIED":
      return chalk.yellow("[MODIFIED]");
    case "UNCHANGED":
      return chalk.gray("[UNCHANGED]");
    case "DELETED":
      return chalk.red("[DELETED]");
  }
}

/**
 * Format a single diff line with appropriate color.
 */
export function formatDiffLine(line: string): string {
  if (line.startsWith("+")) return chalk.green(line);
  if (line.startsWith("-")) return chalk.red(line);
  if (line.startsWith("@@")) return chalk.cyan(line);
  return line;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

/**
 * Generate a unified diff between old and new content.
 * Returns an array of formatted diff lines.
 */
export function generateDiff(
  oldContent: string | null,
  newContent: string,
  fileName: string,
  contextLines: number = 3
): string[] {
  const oldLines = oldContent ? oldContent.split("\n") : [];
  const newLines = newContent.split("\n");

  // For new files, show all lines as additions
  if (oldContent === null) {
    const result: string[] = [];
    for (const line of newLines) {
      result.push(formatDiffLine(`+${line}`));
    }
    return result;
  }

  // Simple LCS-based diff algorithm
  const hunks = computeDiffHunks(oldLines, newLines, contextLines);

  if (hunks.length === 0) {
    return [];
  }

  const result: string[] = [];
  for (const hunk of hunks) {
    result.push(
      formatDiffLine(
        `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
      )
    );
    for (const line of hunk.lines) {
      result.push(formatDiffLine(line));
    }
  }

  return result;
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
  // Compute edit script using LCS
  const editScript = computeEditScript(oldLines, newLines);

  if (editScript.length === 0) {
    return [];
  }

  // Group edits into hunks with context
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

  // Build LCS table
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

  // Backtrack to find edit script
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
  // Find ranges of changes
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

  // Merge ranges that are close together (within 2*contextLines)
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

/**
 * Create an empty diff stats object.
 */
export function createDiffStats(): DiffStats {
  return { newCount: 0, modifiedCount: 0, unchangedCount: 0, deletedCount: 0 };
}

/**
 * Increment the appropriate counter in diff stats.
 */
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
  }
}
