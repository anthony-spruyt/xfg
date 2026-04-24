import type { MergeMode } from "../config/index.js";
import type { ActiveAction } from "../settings/index.js";

export interface ReportFileChange {
  path: string;
  action: ActiveAction;
  diffLines?: string[];
}

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
