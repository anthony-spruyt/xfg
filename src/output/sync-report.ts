// src/output/sync-report.ts
import chalk from "chalk";
import { writeGitHubStepSummary } from "./github-summary.js";
import { formatCountEntry } from "./settings-report.js";
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

    for (const file of repo.files) {
      if (file.action === "create") {
        diffLines.push(`+ ${file.path}`);
      } else if (file.action === "update") {
        diffLines.push(`! ${file.path}`);
      } else if (file.action === "delete") {
        diffLines.push(`- ${file.path}`);
      }
    }

    if (repo.error) {
      diffLines.push(`- Error: ${repo.error}`);
    }
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
