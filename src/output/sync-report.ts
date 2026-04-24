import chalk from "chalk";
import { writeGitHubStepSummary } from "./github-summary.js";
import { formatCountEntry } from "./settings-report.js";
import { formatDiffLine } from "./diff-format.js";
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

  // Per-repo sections: heading + diff block
  for (const repo of report.repos) {
    if (repo.files.length === 0 && !repo.error) {
      continue;
    }

    lines.push(`### ${repo.repoName}`);
    lines.push("");

    const diffLines = renderSyncLines(repo);

    if (diffLines.length > 0) {
      lines.push("```diff");
      lines.push(...diffLines);
      lines.push("```");
      lines.push("");
    }
  }

  // Summary
  lines.push(`**${formatSyncSummary(report.totals)}**`);

  return lines.join("\n");
}

export function renderSyncLines(syncRepo: RepoFileChanges): string[] {
  const lines: string[] = [];

  for (let i = 0; i < syncRepo.files.length; i++) {
    const file = syncRepo.files[i];

    if (i > 0) lines.push("");

    if (file.action === "create") {
      lines.push(`+ ${file.path}`);
    } else if (file.action === "update") {
      lines.push(`! ${file.path}`);
    } else if (file.action === "delete") {
      lines.push(`- ${file.path}`);
    }

    if (file.diffLines) {
      lines.push(...file.diffLines);
    }
  }

  if (syncRepo.error) {
    lines.push(`- Error: ${syncRepo.error}`);
  }

  return lines;
}

export function writeSyncReportSummary(
  report: SyncReport,
  dryRun: boolean,
  summaryPath: string | undefined
): void {
  const markdown = formatSyncReportMarkdown(report, dryRun);
  writeGitHubStepSummary(markdown, summaryPath);
}
