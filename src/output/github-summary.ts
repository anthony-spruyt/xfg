import { appendFileSync } from "node:fs";
import { toErrorMessage } from "../shared/type-guards.js";
import type { DebugLog } from "../shared/logger.js";

export type MergeOutcome = "manual" | "auto" | "force" | "direct";

export interface FileChanges {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
}

export interface RulesetPlanDetail {
  name: string;
  action: "create" | "update" | "delete" | "unchanged";
  propertyCount?: number;
  propertyChanges?: {
    added: number;
    changed: number;
    removed: number;
  };
}

export interface RepoSettingsPlanDetail {
  property: string;
  action: "create" | "update";
}

export interface LabelsPlanDetail {
  name: string;
  action: "create" | "update" | "delete" | "unchanged";
  newName?: string;
}

export interface RepoResult {
  repoName: string;
  status: "succeeded" | "skipped" | "failed";
  message: string;
  prUrl?: string;
  mergeOutcome?: MergeOutcome;
  fileChanges?: FileChanges;
  rulesetPlanDetails?: RulesetPlanDetail[];
  repoSettingsPlanDetails?: RepoSettingsPlanDetail[];
  labelsPlanDetails?: LabelsPlanDetail[];
}

export interface SummaryData {
  title: string;
  dryRun?: boolean;
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  results: RepoResult[];
}

function escapeMarkdown(text: string): string {
  // Escape backslashes first, then pipes (order matters to prevent double-escaping)
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function formatFileChanges(changes?: FileChanges): string {
  if (!changes) return "-";
  return `+${changes.added} ~${changes.modified} -${changes.deleted}`;
}

function formatChangesColumn(result: RepoResult): string {
  if (result.fileChanges) {
    return formatFileChanges(result.fileChanges);
  }
  // For settings results, derive changes from plan details
  const parts: string[] = [];
  if (result.rulesetPlanDetails && result.rulesetPlanDetails.length > 0) {
    parts.push(formatPlanSummary(result.rulesetPlanDetails));
  }
  if (
    result.repoSettingsPlanDetails &&
    result.repoSettingsPlanDetails.length > 0
  ) {
    parts.push(formatPlanSummary(result.repoSettingsPlanDetails));
  }
  if (result.labelsPlanDetails && result.labelsPlanDetails.length > 0) {
    parts.push(formatPlanSummary(result.labelsPlanDetails));
  }
  return parts.length > 0 ? parts.join("; ") : "-";
}

function formatStatus(result: RepoResult, dryRun?: boolean): string {
  if (result.status === "skipped")
    return dryRun ? "⏭️ Would Skip" : "⏭️ Skipped";
  if (result.status === "failed") return dryRun ? "❌ Would Fail" : "❌ Failed";

  // Succeeded - format based on merge outcome
  switch (result.mergeOutcome) {
    case "manual":
      return dryRun ? "✅ Would Open" : "✅ Open";
    case "auto":
      return dryRun ? "✅ Would Auto-merge" : "✅ Auto-merge";
    case "force":
      return dryRun ? "✅ Would Merge" : "✅ Merged";
    case "direct":
      return dryRun ? "✅ Would Push" : "✅ Pushed";
    default:
      return dryRun ? "✅ Would Succeed" : "✅ Succeeded";
  }
}

function formatResult(result: RepoResult): string {
  if (result.prUrl) {
    // Extract PR number from URL
    const prMatch = result.prUrl.match(/\/pull\/(\d+)/);
    const prNum = prMatch ? prMatch[1] : "PR";
    return `[PR #${prNum}](${result.prUrl})`;
  }

  if (result.mergeOutcome === "direct") {
    return "Direct to main";
  }

  return escapeMarkdown(result.message);
}

function formatRulesetAction(action: string): string {
  switch (action) {
    case "create":
      return "+ Create";
    case "update":
      return "~ Update";
    case "delete":
      return "- Delete";
    case "unchanged":
      return "= Unchanged";
    default:
      return action;
  }
}

function formatRulesetProperties(detail: RulesetPlanDetail): string {
  if (detail.propertyChanges) {
    return `+${detail.propertyChanges.added} ~${detail.propertyChanges.changed} -${detail.propertyChanges.removed}`;
  }
  if (detail.propertyCount !== undefined) {
    return `${detail.propertyCount} properties`;
  }
  return "-";
}

function formatPlanSummary(details: { action: string }[]): string {
  const counts: Record<string, number> = {};
  for (const d of details) {
    counts[d.action] = (counts[d.action] ?? 0) + 1;
  }
  const parts: string[] = [];
  if (counts.create) parts.push(`${counts.create} to create`);
  if (counts.update) parts.push(`${counts.update} to update`);
  if (counts.delete) parts.push(`${counts.delete} to delete`);
  return parts.join(", ") || "no changes";
}

function formatSettingsAction(action: string): string {
  switch (action) {
    case "create":
      return "+ Create";
    case "update":
      return "~ Update";
    default:
      return action;
  }
}

export function formatSummary(data: SummaryData): string {
  const lines: string[] = [];

  // Header
  const titleSuffix = data.dryRun ? " (Dry Run)" : "";
  lines.push(`## ${data.title}${titleSuffix}`);
  lines.push("");

  // Dry-run warning banner
  if (data.dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Stats table
  const succeededLabel = data.dryRun ? "✅ Would Succeed" : "✅ Succeeded";
  const skippedLabel = data.dryRun ? "⏭️ Would Skip" : "⏭️ Skipped";
  const failedLabel = data.dryRun ? "❌ Would Fail" : "❌ Failed";
  lines.push("| Status | Count |");
  lines.push("|--------|-------|");
  lines.push(`| ${succeededLabel} | ${data.succeeded} |`);
  lines.push(`| ${skippedLabel} | ${data.skipped} |`);
  lines.push(`| ${failedLabel} | ${data.failed} |`);
  lines.push(`| **Total** | **${data.total}** |`);

  // Repo details table (only if there are results)
  if (data.results.length > 0) {
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>Repository Details</summary>");
    lines.push("");
    lines.push("| Repository | Status | Changes | Result |");
    lines.push("|------------|--------|---------|--------|");

    for (const result of data.results) {
      const repo = result.repoName;
      const status = formatStatus(result, data.dryRun);
      const changes = formatChangesColumn(result);
      const resultText = formatResult(result);
      lines.push(`| ${repo} | ${status} | ${changes} | ${resultText} |`);
    }

    // Plan details nested sections
    for (const result of data.results) {
      if (result.rulesetPlanDetails && result.rulesetPlanDetails.length > 0) {
        lines.push("");
        lines.push("<details>");
        lines.push(
          `<summary>${result.repoName} — Rulesets: ${formatPlanSummary(result.rulesetPlanDetails)}</summary>`
        );
        lines.push("");
        lines.push("| Ruleset | Action | Properties |");
        lines.push("|---------|--------|------------|");
        for (const detail of result.rulesetPlanDetails) {
          lines.push(
            `| ${detail.name} | ${formatRulesetAction(detail.action)} | ${formatRulesetProperties(detail)} |`
          );
        }
        lines.push("");
        lines.push("</details>");
      }

      if (
        result.repoSettingsPlanDetails &&
        result.repoSettingsPlanDetails.length > 0
      ) {
        lines.push("");
        lines.push("<details>");
        lines.push(
          `<summary>${result.repoName} — Repo Settings: ${formatPlanSummary(result.repoSettingsPlanDetails)}</summary>`
        );
        lines.push("");
        lines.push("| Setting | Action |");
        lines.push("|---------|--------|");
        for (const detail of result.repoSettingsPlanDetails) {
          lines.push(
            `| ${detail.property} | ${formatSettingsAction(detail.action)} |`
          );
        }
        lines.push("");
        lines.push("</details>");
      }

      if (result.labelsPlanDetails && result.labelsPlanDetails.length > 0) {
        lines.push("");
        lines.push("<details>");
        lines.push(
          `<summary>${result.repoName} — Labels: ${formatPlanSummary(result.labelsPlanDetails)}</summary>`
        );
        lines.push("");
        lines.push("| Label | Action |");
        lines.push("|-------|--------|");
        for (const detail of result.labelsPlanDetails) {
          const action =
            detail.action === "create"
              ? "+ Create"
              : detail.action === "update"
                ? "~ Update"
                : detail.action === "delete"
                  ? "- Delete"
                  : "No change";
          const name = detail.newName
            ? `${detail.name} \u2192 ${detail.newName}`
            : detail.name;
          lines.push(`| ${name} | ${action} |`);
        }
        lines.push("");
        lines.push("</details>");
      }
    }

    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}

export function shouldWriteSummary(summaryPath: string | undefined): boolean {
  return !!summaryPath;
}

/**
 * Append markdown content to GITHUB_STEP_SUMMARY.
 * No-op if summaryPath is not provided.
 */
export function writeGitHubStepSummary(
  markdown: string,
  summaryPath: string | undefined,
  log?: DebugLog
): void {
  const path = summaryPath;
  if (!path) return;
  try {
    appendFileSync(path, "\n" + markdown + "\n");
  } catch (error) {
    log?.debug(`Failed to write GitHub step summary: ${toErrorMessage(error)}`);
  }
}

export function writeSummary(
  data: SummaryData,
  summaryPath: string | undefined
): void {
  const markdown = formatSummary(data);
  writeGitHubStepSummary(markdown, summaryPath);
}
