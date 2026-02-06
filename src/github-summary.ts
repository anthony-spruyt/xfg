import { appendFileSync } from "node:fs";

export type MergeOutcome = "manual" | "auto" | "force" | "direct";

export interface FileChanges {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
}

export interface RepoResult {
  repoName: string;
  status: "succeeded" | "skipped" | "failed";
  message: string;
  prUrl?: string;
  mergeOutcome?: MergeOutcome;
  fileChanges?: FileChanges;
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
      const changes = formatFileChanges(result.fileChanges);
      const resultText = formatResult(result);
      lines.push(`| ${repo} | ${status} | ${changes} | ${resultText} |`);
    }

    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}

export function isGitHubActions(): boolean {
  return !!process.env.GITHUB_STEP_SUMMARY;
}

export function writeSummary(data: SummaryData): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatSummary(data);
  appendFileSync(summaryPath, markdown + "\n");
}
