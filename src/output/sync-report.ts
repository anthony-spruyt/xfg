// src/output/sync-report.ts
import chalk from "chalk";

export interface SyncReport {
  repos: RepoFileChanges[];
  totals: {
    files: { create: number; update: number; delete: number };
  };
}

export interface RepoFileChanges {
  repoName: string;
  files: FileChange[];
  prUrl?: string;
  mergeOutcome?: "manual" | "auto" | "force" | "direct";
  error?: string;
}

export interface FileChange {
  path: string;
  action: "create" | "update" | "delete";
}

function formatSummary(totals: SyncReport["totals"]): string {
  const total = totals.files.create + totals.files.update + totals.files.delete;

  if (total === 0) {
    return "No changes";
  }

  const parts: string[] = [];
  if (totals.files.create > 0) parts.push(`${totals.files.create} to create`);
  if (totals.files.update > 0) parts.push(`${totals.files.update} to update`);
  if (totals.files.delete > 0) parts.push(`${totals.files.delete} to delete`);

  const fileWord = total === 1 ? "file" : "files";
  return `Plan: ${total} ${fileWord} (${parts.join(", ")})`;
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
  lines.push(formatSummary(report.totals));

  return lines;
}
