import type { FileChangeDetail } from "../sync/types.js";

export type ReportFileChange = FileChangeDetail;

export interface SyncReport {
  repos: RepoFileChanges[];
  totals: {
    files: { create: number; update: number; delete: number };
  };
}

export interface RepoFileChanges {
  repoName: string;
  files: ReportFileChange[];
  prUrl?: string;
  mergeOutcome?: "manual" | "auto" | "force" | "direct";
  error?: string;
}
