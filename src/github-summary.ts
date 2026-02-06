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

function formatStatus(result: RepoResult): string {
  if (result.status === "skipped") return "⏭️ Skipped";
  if (result.status === "failed") return "❌ Failed";

  // Succeeded - format based on merge outcome
  switch (result.mergeOutcome) {
    case "manual":
      return "✅ Open";
    case "auto":
      return "✅ Auto-merge";
    case "force":
      return "✅ Merged";
    case "direct":
      return "✅ Pushed";
    default:
      return "✅ Succeeded";
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
  lines.push(`## ${data.title}`);
  lines.push("");

  // Stats table
  lines.push("| Status | Count |");
  lines.push("|--------|-------|");
  lines.push(`| ✅ Succeeded | ${data.succeeded} |`);
  lines.push(`| ⏭️ Skipped | ${data.skipped} |`);
  lines.push(`| ❌ Failed | ${data.failed} |`);
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
      const status = formatStatus(result);
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
