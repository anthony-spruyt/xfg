// Plan formatting (console output with chalk)
export {
  formatResourceId,
  formatResourceLine,
  formatPlanSummary,
  formatPlan,
  printPlan,
  type ResourceType,
  type ResourceAction,
  type Resource,
  type ResourceDetails,
  type PropertyChange,
  type PlanCounts,
  type Plan,
  type RepoError,
} from "./plan-formatter.js";

// Plan summary (markdown output for GitHub)
export {
  formatPlanMarkdown,
  writePlanSummary,
  type PlanMarkdownOptions,
} from "./plan-summary.js";

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
