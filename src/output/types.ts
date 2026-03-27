import type { MergeMode } from "../config/index.js";
import type { FileChangeDetail } from "../sync/index.js";

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
  mergeOutcome?: MergeMode;
  error?: string;
}
