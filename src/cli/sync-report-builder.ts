// src/cli/sync-report-builder.ts
import type {
  SyncReport,
  RepoFileChanges,
  FileChange,
} from "../output/sync-report.js";

interface FileChangeInput {
  path: string;
  action: "create" | "update" | "delete";
}

interface SyncResultInput {
  repoName: string;
  success: boolean;
  fileChanges: FileChangeInput[];
  prUrl?: string;
  mergeOutcome?: "manual" | "auto" | "force" | "direct";
  error?: string;
}

export function buildSyncReport(results: SyncResultInput[]): SyncReport {
  const repos: RepoFileChanges[] = [];
  const totals = {
    files: { create: 0, update: 0, delete: 0 },
  };

  for (const result of results) {
    const files: FileChange[] = result.fileChanges.map((f) => ({
      path: f.path,
      action: f.action,
    }));

    // Count totals
    for (const file of files) {
      if (file.action === "create") totals.files.create++;
      else if (file.action === "update") totals.files.update++;
      else if (file.action === "delete") totals.files.delete++;
    }

    repos.push({
      repoName: result.repoName,
      files,
      prUrl: result.prUrl,
      mergeOutcome: result.mergeOutcome,
      error: result.error,
    });
  }

  return { repos, totals };
}
