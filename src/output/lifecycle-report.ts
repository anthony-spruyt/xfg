// src/output/lifecycle-report.ts
import { appendFileSync } from "node:fs";
import chalk from "chalk";

export interface LifecycleReport {
  actions: LifecycleAction[];
  totals: {
    created: number;
    forked: number;
    migrated: number;
    existed: number;
  };
}

export interface LifecycleAction {
  repoName: string;
  action: "existed" | "created" | "forked" | "migrated";
  upstream?: string;
  source?: string;
  settings?: {
    visibility?: string;
    description?: string;
  };
}

export interface LifecycleReportInput {
  repoName: string;
  action: "existed" | "created" | "forked" | "migrated";
  upstream?: string;
  source?: string;
  settings?: {
    visibility?: string;
    description?: string;
  };
}

// =============================================================================
// Builder
// =============================================================================

export function buildLifecycleReport(
  results: LifecycleReportInput[]
): LifecycleReport {
  const actions: LifecycleAction[] = [];
  const totals = { created: 0, forked: 0, migrated: 0, existed: 0 };

  for (const result of results) {
    actions.push({
      repoName: result.repoName,
      action: result.action,
      upstream: result.upstream,
      source: result.source,
      settings: result.settings,
    });

    totals[result.action]++;
  }

  return { actions, totals };
}

// =============================================================================
// Helpers
// =============================================================================

function formatSummary(totals: LifecycleReport["totals"]): string {
  const total = totals.created + totals.forked + totals.migrated;

  if (total === 0) {
    return "No changes";
  }

  const parts: string[] = [];
  if (totals.created > 0) parts.push(`${totals.created} to create`);
  if (totals.forked > 0) parts.push(`${totals.forked} to fork`);
  if (totals.migrated > 0) parts.push(`${totals.migrated} to migrate`);

  const repoWord = total === 1 ? "repo" : "repos";
  return `Plan: ${total} ${repoWord} (${parts.join(", ")})`;
}

/**
 * Returns true if the report has any non-"existed" actions worth displaying.
 */
export function hasLifecycleChanges(report: LifecycleReport): boolean {
  return report.actions.some((a) => a.action !== "existed");
}

// =============================================================================
// CLI Formatter
// =============================================================================

export function formatLifecycleReportCLI(report: LifecycleReport): string[] {
  if (!hasLifecycleChanges(report)) {
    return [];
  }

  const lines: string[] = [];

  for (const action of report.actions) {
    if (action.action === "existed") continue;

    switch (action.action) {
      case "created":
        lines.push(chalk.green(`+ CREATE ${action.repoName}`));
        break;

      case "forked":
        lines.push(
          chalk.green(
            `+ FORK ${action.upstream ?? "upstream"} -> ${action.repoName}`
          )
        );
        break;

      case "migrated":
        lines.push(
          chalk.green(
            `+ MIGRATE ${action.source ?? "source"} -> ${action.repoName}`
          )
        );
        break;
    }

    if (action.settings) {
      if (action.settings.visibility) {
        lines.push(`    visibility: ${action.settings.visibility}`);
      }
      if (action.settings.description) {
        lines.push(`    description: "${action.settings.description}"`);
      }
    }
  }

  lines.push("");

  // Summary
  lines.push(formatSummary(report.totals));

  return lines;
}

// =============================================================================
// Markdown Formatter
// =============================================================================

export function formatLifecycleReportMarkdown(
  report: LifecycleReport,
  dryRun: boolean
): string {
  if (!hasLifecycleChanges(report)) {
    return "";
  }

  const lines: string[] = [];

  // Title
  const titleSuffix = dryRun ? " (Dry Run)" : "";
  lines.push(`## Lifecycle Summary${titleSuffix}`);
  lines.push("");

  // Dry-run warning
  if (dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Diff block
  const diffLines: string[] = [];

  for (const action of report.actions) {
    if (action.action === "existed") continue;

    switch (action.action) {
      case "created":
        diffLines.push(`+ CREATE ${action.repoName}`);
        break;

      case "forked":
        diffLines.push(
          `+ FORK ${action.upstream ?? "upstream"} -> ${action.repoName}`
        );
        break;

      case "migrated":
        diffLines.push(
          `+ MIGRATE ${action.source ?? "source"} -> ${action.repoName}`
        );
        break;
    }

    if (action.settings) {
      if (action.settings.visibility) {
        diffLines.push(`    visibility: ${action.settings.visibility}`);
      }
      if (action.settings.description) {
        diffLines.push(`    description: "${action.settings.description}"`);
      }
    }
  }

  if (diffLines.length > 0) {
    lines.push("```diff");
    lines.push(...diffLines);
    lines.push("```");
    lines.push("");
  }

  // Summary
  lines.push(`**${formatSummary(report.totals)}**`);

  return lines.join("\n");
}

// =============================================================================
// File Writer
// =============================================================================

export function writeLifecycleReportSummary(
  report: LifecycleReport,
  dryRun: boolean
): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatLifecycleReportMarkdown(report, dryRun);
  if (!markdown) return;

  appendFileSync(summaryPath, "\n" + markdown + "\n");
}
