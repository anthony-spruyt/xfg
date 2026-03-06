// Sync report (repo-grouped file changes)
export {
  formatSyncReportCLI,
  formatSyncReportMarkdown,
  writeSyncReportSummary,
  type SyncReport,
  type RepoFileChanges,
  type ReportFileChange,
} from "./sync-report.js";

// Settings report (repo-grouped settings changes)
export {
  formatSettingsReportCLI,
  formatSettingsReportMarkdown,
  writeSettingsReportSummary,
  type SettingsReport,
  type RepoChanges,
  type RulesetChange,
  type SettingChange,
} from "./settings-report.js";

// Unified summary (lifecycle + sync + settings in one diff block)
export {
  formatUnifiedSummaryMarkdown,
  writeUnifiedSummary,
} from "./unified-summary.js";

// GitHub Actions summary
export {
  formatSummary,
  isGitHubActions,
  writeSummary,
  type MergeOutcome,
  type FileChanges,
  type RulesetPlanDetail,
  type RepoSettingsPlanDetail,
  type RepoResult,
  type SummaryData,
} from "./github-summary.js";

// Summary utilities
export {
  getMergeOutcome,
  toFileChanges,
  buildRepoResult,
  buildErrorResult,
} from "./summary-utils.js";
