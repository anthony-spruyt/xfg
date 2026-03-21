import chalk from "chalk";
import { writeGitHubStepSummary } from "./github-summary.js";
import { formatCountEntry } from "./settings-report.js";
import { renderSyncLines } from "./unified-summary.js";
import { formatDiffLine } from "../sync/index.js";
import type { SyncReport, RepoFileChanges, ReportFileChange } from "./types.js";

export type { SyncReport, RepoFileChanges, ReportFileChange };

function formatSyncSummary(totals: SyncReport["totals"]): string {
  const entry = formatCountEntry("file", "files", [
    { label: "to create", value: totals.files.create },
    { label: "to update", value: totals.files.update },
    { label: "to delete", value: totals.files.delete },
  ]);
  return entry ? `Plan: ${entry}` : "No changes";
}

export function formatSyncReportCLI(report: SyncReport): string[] {
  const lines: string[] = [];

  for (const repo of report.repos) {
    if (repo.files.length === 0 && !repo.error) {
      continue;
    }

    // Repo header
    lines.push(chalk.yellow(`~ ${repo.repoName}`));

    // Files
    for (const file of repo.files) {
      if (file.action === "create") {
        lines.push(chalk.green(`    + ${file.path}`));
      } else if (file.action === "update") {
        lines.push(chalk.yellow(`    ~ ${file.path}`));
      } else if (file.action === "delete") {
        lines.push(chalk.red(`    - ${file.path}`));
      }

      // Content diff for structured data files
      if (file.diffLines) {
        for (const diffLine of file.diffLines) {
          lines.push(`      ${formatDiffLine(diffLine)}`);
        }
      }
    }

    // Error
    if (repo.error) {
      lines.push(chalk.red(`    Error: ${repo.error}`));
    }

    lines.push(""); // Blank line between repos
  }

  // Summary
  lines.push(formatSyncSummary(report.totals));

  return lines;
}

export function formatSyncReportMarkdown(
  report: SyncReport,
  dryRun: boolean
): string {
  const lines: string[] = [];

  // Title
  const title = dryRun ? "## xfg Plan" : "## xfg Apply";
  lines.push(title);
  lines.push("");

  // Dry-run warning
  if (dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Diff block
  const diffLines: string[] = [];

  for (const repo of report.repos) {
    if (repo.files.length === 0 && !repo.error) {
      continue;
    }

    diffLines.push(`@@ ${repo.repoName} @@`);

    renderSyncLines(repo, diffLines);
  }

  if (diffLines.length > 0) {
    lines.push("```diff");
    lines.push(...diffLines);
    lines.push("```");
    lines.push("");
  }

  // Summary
  lines.push(`**${formatSyncSummary(report.totals)}**`);

  return lines.join("\n");
}

export function writeSyncReportSummary(
  report: SyncReport,
  dryRun: boolean,
  summaryPath: string | undefined
): void {
  const markdown = formatSyncReportMarkdown(report, dryRun);
  writeGitHubStepSummary(markdown, summaryPath);
}
