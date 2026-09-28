import chalk from "chalk";
import {
  STEP_SUMMARY_MAX_BYTES,
  writeGitHubStepSummary,
} from "./github-summary.js";
import { fitSummary, summaryHeader } from "./summary-budget.js";
import { formatCountEntry } from "../shared/count-format.js";
import type { LifecycleActionKind } from "../lifecycle/index.js";
import type { RepoVisibility } from "../config/index.js";
import { quoted } from "../shared/string-utils.js";

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
  action: LifecycleActionKind;
  upstream?: string;
  source?: string;
  settings?: {
    visibility?: RepoVisibility;
    description?: string;
  };
}

function formatLifecycleSummary(totals: LifecycleReport["totals"]): string {
  const entry = formatCountEntry("repo", "repos", [
    { label: "to create", value: totals.created },
    { label: "to fork", value: totals.forked },
    { label: "to migrate", value: totals.migrated },
  ]);
  return entry ? `Plan: ${entry}` : "No changes";
}

export function hasLifecycleChanges(report: LifecycleReport): boolean {
  return report.actions.some((a) => a.action !== "existed");
}

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

      /* c8 ignore next 4 */
      default: {
        const _exhaustive: never = action.action;
        throw new Error(`Unexpected lifecycle action: ${_exhaustive}`);
      }
    }

    if (action.settings) {
      if (action.settings.visibility) {
        lines.push(`    visibility: ${action.settings.visibility}`);
      }
      if (action.settings.description) {
        lines.push(`    description: ${quoted(action.settings.description)}`);
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
  dryRun: boolean,
  maxBytes: number = STEP_SUMMARY_MAX_BYTES
): string {
  if (!hasLifecycleChanges(report)) {
    return "";
  }

  const title = `## Lifecycle Summary${dryRun ? " (Dry Run)" : ""}`;
  return fitSummary(
    {
      header: summaryHeader(dryRun, title),
      blocks: [
        {
          diffLines: renderActionDiffLines(report.actions),
          count: report.actions.filter((a) => a.action !== "existed").length,
        },
      ],
      footer: `**${formatLifecycleSummary(report.totals)}**`,
    },
    maxBytes
  );
}

export function writeLifecycleReportSummary(
  report: LifecycleReport,
  dryRun: boolean,
  summaryPath: string | undefined
): void {
  writeGitHubStepSummary(
    (maxBytes) => formatLifecycleReportMarkdown(report, dryRun, maxBytes),
    summaryPath
  );
}
