import chalk from "chalk";
import { formatCountEntry } from "../shared/count-format.js";
import { formatDiffLine } from "../shared/diff-format.js";
import type { MergeMode } from "../config/index.js";
import type { ActiveAction } from "../settings/index.js";
import {
  STEP_SUMMARY_MAX_BYTES,
  writeGitHubStepSummary,
} from "./github-summary.js";
import { fitSummary, summaryHeader } from "./summary-budget.js";

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

    lines.push(chalk.yellow(`~ ${repo.repoName}`));

    for (const file of repo.files) {
      if (file.action === "create") {
        lines.push(chalk.green(`    + ${file.path}`));
      } else if (file.action === "update") {
        lines.push(chalk.yellow(`    ~ ${file.path}`));
      } else if (file.action === "delete") {
        lines.push(chalk.red(`    - ${file.path}`));
      }

      if (file.diffLines) {
        for (const diffLine of file.diffLines) {
          lines.push(`      ${formatDiffLine(diffLine)}`);
        }
      }
    }

    if (repo.error) {
      lines.push(chalk.red(`    Error: ${repo.error}`));
    }

    lines.push("");
  }

  lines.push(formatSyncSummary(report.totals));

  return lines;
}

export function formatSyncReportMarkdown(
  report: SyncReport,
  dryRun: boolean,
  maxBytes: number = STEP_SUMMARY_MAX_BYTES
): string {
  const blocks = report.repos
    .filter((repo) => repo.files.length > 0 || repo.error)
    .map((repo) => ({
      heading: `### ${repo.repoName}`,
      diffLines: renderSyncLines(repo),
    }));

  return fitSummary(
    {
      header: summaryHeader(dryRun),
      blocks,
      footer: `**${formatSyncSummary(report.totals)}**`,
    },
    maxBytes
  );
}

// Stops one huge file from using up the summary space the other files need.
export const SUMMARY_DIFF_LINE_LIMIT = 500;

export function renderSyncLines(
  syncRepo: RepoFileChanges,
  lines: string[] = []
): string[] {
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

    const diffLines = file.diffLines ?? [];
    const shown = Math.min(diffLines.length, SUMMARY_DIFF_LINE_LIMIT);
    for (let j = 0; j < shown; j++) lines.push(diffLines[j]);
    if (diffLines.length > shown) {
      lines.push(`... ${diffLines.length - shown} more lines not shown`);
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
  writeGitHubStepSummary(
    (maxBytes) => formatSyncReportMarkdown(report, dryRun, maxBytes),
    summaryPath
  );
}
