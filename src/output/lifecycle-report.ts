import chalk from "chalk";
import { writeGitHubStepSummary } from "./github-summary.js";
import { formatCountEntry } from "./settings-report.js";

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

export function buildLifecycleReport(
  results: LifecycleAction[]
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

function formatLifecycleSummary(totals: LifecycleReport["totals"]): string {
  const entry = formatCountEntry("repo", "repos", [
    { label: "to create", value: totals.created },
    { label: "to fork", value: totals.forked },
    { label: "to migrate", value: totals.migrated },
  ]);
  return entry ? `Plan: ${entry}` : "No changes";
}

/**
 * Returns true if the report has any non-"existed" actions worth displaying.
 */
export function hasLifecycleChanges(report: LifecycleReport): boolean {
  return report.actions.some((a) => a.action !== "existed");
}

/**
 * Render action diff lines from lifecycle actions (shared between CLI and Markdown).
 */
function renderActionDiffLines(actions: LifecycleAction[]): string[] {
  const lines: string[] = [];

  for (const action of actions) {
    if (action.action === "existed") continue;

    switch (action.action) {
      case "created":
        lines.push(`+ CREATE ${action.repoName}`);
        break;

      case "forked":
        lines.push(
          `+ FORK ${action.upstream ?? "upstream"} -> ${action.repoName}`
        );
        break;

      case "migrated":
        lines.push(
          `+ MIGRATE ${action.source ?? "source"} -> ${action.repoName}`
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

  return lines;
}

export function formatLifecycleReportCLI(report: LifecycleReport): string[] {
  if (!hasLifecycleChanges(report)) {
    return [];
  }

  const lines = renderActionDiffLines(report.actions).map((line) =>
    line.startsWith("+") ? chalk.green(line) : line
  );
  lines.push("");
  lines.push(formatLifecycleSummary(report.totals));

  return lines;
}

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
  const diffLines = renderActionDiffLines(report.actions);

  if (diffLines.length > 0) {
    lines.push("```diff");
    lines.push(...diffLines);
    lines.push("```");
    lines.push("");
  }

  // Summary
  lines.push(`**${formatLifecycleSummary(report.totals)}**`);

  return lines.join("\n");
}

export function writeLifecycleReportSummary(
  report: LifecycleReport,
  dryRun: boolean,
  summaryPath: string | undefined
): void {
  const markdown = formatLifecycleReportMarkdown(report, dryRun);
  if (!markdown) return;
  writeGitHubStepSummary(markdown, summaryPath);
}
