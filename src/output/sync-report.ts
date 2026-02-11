// src/output/sync-report.ts

export interface SyncReport {
  repos: RepoFileChanges[];
  totals: {
    files: { create: number; update: number; delete: number };
  };
}

export interface RepoFileChanges {
  repoName: string;
  files: FileChange[];
  prUrl?: string;
  mergeOutcome?: "manual" | "auto" | "force" | "direct";
  error?: string;
}

export interface FileChange {
  path: string;
  action: "create" | "update" | "delete";
}

function formatSummary(totals: SyncReport["totals"]): string {
  const total = totals.files.create + totals.files.update + totals.files.delete;

  if (total === 0) {
    return "No changes";
  }

  const parts: string[] = [];
  if (totals.files.create > 0) parts.push(`${totals.files.create} to create`);
  if (totals.files.update > 0) parts.push(`${totals.files.update} to update`);
  if (totals.files.delete > 0) parts.push(`${totals.files.delete} to delete`);

  const fileWord = total === 1 ? "file" : "files";
  return `Plan: ${total} ${fileWord} (${parts.join(", ")})`;
}

export function formatSyncReportCLI(report: SyncReport): string[] {
  const lines: string[] = [];
  lines.push(formatSummary(report.totals));
  return lines;
}
