import chalk from "chalk";
import type { PropertyDiff } from "../settings/rulesets/formatter.js";
import type { Ruleset } from "../config/index.js";

export interface SettingsReport {
  repos: RepoChanges[];
  totals: {
    settings: { add: number; change: number };
    rulesets: { create: number; update: number; delete: number };
  };
}

export interface RepoChanges {
  repoName: string;
  settings: SettingChange[];
  rulesets: RulesetChange[];
  error?: string;
}

export interface SettingChange {
  name: string;
  action: "add" | "change";
  oldValue?: unknown;
  newValue: unknown;
}

export interface RulesetChange {
  name: string;
  action: "create" | "update" | "delete";
  propertyDiffs?: PropertyDiff[];
  config?: Ruleset;
}

// =============================================================================
// Helpers
// =============================================================================

function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return val ? "true" : "false";
  return String(val);
}

function formatSummary(totals: SettingsReport["totals"]): string {
  const parts: string[] = [];
  const settingsTotal = totals.settings.add + totals.settings.change;
  const rulesetsTotal =
    totals.rulesets.create + totals.rulesets.update + totals.rulesets.delete;

  if (settingsTotal > 0) {
    const settingWord = settingsTotal === 1 ? "setting" : "settings";
    const actions: string[] = [];
    if (totals.settings.add > 0) actions.push(`${totals.settings.add} to add`);
    if (totals.settings.change > 0)
      actions.push(`${totals.settings.change} to change`);
    parts.push(`${settingsTotal} ${settingWord} (${actions.join(", ")})`);
  }

  if (rulesetsTotal > 0) {
    const rulesetWord = rulesetsTotal === 1 ? "ruleset" : "rulesets";
    const actions: string[] = [];
    if (totals.rulesets.create > 0)
      actions.push(`${totals.rulesets.create} to create`);
    if (totals.rulesets.update > 0)
      actions.push(`${totals.rulesets.update} to update`);
    if (totals.rulesets.delete > 0)
      actions.push(`${totals.rulesets.delete} to delete`);
    parts.push(`${rulesetsTotal} ${rulesetWord} (${actions.join(", ")})`);
  }

  if (parts.length === 0) {
    return "No changes";
  }

  return `Plan: ${parts.join(", ")}`;
}

// =============================================================================
// CLI Formatter
// =============================================================================

export function formatSettingsReportCLI(report: SettingsReport): string[] {
  const lines: string[] = [];

  for (const repo of report.repos) {
    if (
      repo.settings.length === 0 &&
      repo.rulesets.length === 0 &&
      !repo.error
    ) {
      continue;
    }

    // Repo header
    lines.push(chalk.yellow(`~ ${repo.repoName}`));

    // Settings
    for (const setting of repo.settings) {
      if (setting.action === "add") {
        lines.push(
          chalk.green(`    + ${setting.name}: ${formatValue(setting.newValue)}`)
        );
      } else {
        lines.push(
          chalk.yellow(
            `    ~ ${setting.name}: ${formatValue(setting.oldValue)} → ${formatValue(setting.newValue)}`
          )
        );
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
