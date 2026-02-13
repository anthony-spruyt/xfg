// src/output/sync-report.ts
import { appendFileSync } from "node:fs";
import chalk from "chalk";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

export function formatSyncReportMarkdown(
  report: SyncReport,
  dryRun: boolean
): string {
  const lines: string[] = [];

  // Title
  const titleSuffix = dryRun ? " (Dry Run)" : "";
  lines.push(`## Config Sync Summary${titleSuffix}`);
  lines.push("");

  // Dry-run warning
  if (dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Colored diff output using HTML <pre> with inline styles
  // Colors: green (#3fb950) for creates, yellow (#d29922) for changes, red (#f85149) for deletes
  const diffLines: string[] = [];

  for (const repo of report.repos) {
    if (repo.files.length === 0 && !repo.error) {
      continue;
    }

    diffLines.push(
      `<span style="color:#d29922">~ ${escapeHtml(repo.repoName)}</span>`
    );

    for (const file of repo.files) {
      if (file.action === "create") {
        diffLines.push(
          `<span style="color:#3fb950">    + ${escapeHtml(file.path)}</span>`
        );
      } else if (file.action === "update") {
        diffLines.push(
          `<span style="color:#d29922">    ~ ${escapeHtml(file.path)}</span>`
        );
      } else if (file.action === "delete") {
        diffLines.push(
          `<span style="color:#f85149">    - ${escapeHtml(file.path)}</span>`
        );
      }
    }

    if (repo.error) {
      diffLines.push(
        `<span style="color:#f85149">    ! Error: ${escapeHtml(repo.error)}</span>`
      );
    }
  }

  if (diffLines.length > 0) {
    lines.push("<pre>");
    lines.push(...diffLines);
    lines.push("</pre>");
    lines.push("");
  }

  // Summary
  lines.push(`**${formatSummary(report.totals)}**`);

  return lines.join("\n");
}

export function writeSyncReportSummary(
  report: SyncReport,
  dryRun: boolean
): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatSyncReportMarkdown(report, dryRun);
  appendFileSync(summaryPath, "\n" + markdown + "\n");
}
