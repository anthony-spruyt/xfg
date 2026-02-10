import chalk from "chalk";
import type { RepoSettingsChange } from "./diff.js";

export interface RepoSettingsPlanEntry {
  property: string;
  action: "add" | "change";
}

export interface RepoSettingsPlanResult {
  lines: string[];
  adds: number;
  changes: number;
  warnings: string[];
  entries: RepoSettingsPlanEntry[];
}

/**
 * Format a value for display.
 */
function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return val ? "true" : "false";
  return String(val);
}

/**
 * Get warning message for a property change.
 */
function getWarning(change: RepoSettingsChange): string | undefined {
  if (change.property === "visibility") {
    return `visibility change (${change.oldValue} → ${change.newValue}) may expose or hide repository`;
  }
  if (change.property === "archived" && change.newValue === true) {
    return "archiving makes repository read-only";
  }
  if (
    (change.property === "hasIssues" ||
      change.property === "hasWiki" ||
      change.property === "hasProjects") &&
    change.newValue === false
  ) {
    return `disabling ${change.property} may hide existing content`;
  }
  if (change.property === "defaultBranch") {
    return `changing default branch may affect existing PRs, CI workflows, and branch protections`;
  }
  return undefined;
}

/**
 * Formats repo settings changes as Terraform-style plan output.
 */
export function formatRepoSettingsPlan(
  changes: RepoSettingsChange[]
): RepoSettingsPlanResult {
  const lines: string[] = [];
  const warnings: string[] = [];
  let adds = 0;
  let changesCount = 0;
  const entries: RepoSettingsPlanEntry[] = [];

  if (changes.length === 0) {
    return { lines, adds, changes: 0, warnings, entries };
  }

  for (const change of changes) {
    const warning = getWarning(change);
    if (warning) {
      warnings.push(warning);
    }

    if (change.action === "add") {
      lines.push(
        chalk.green(`    + ${change.property}: ${formatValue(change.newValue)}`)
      );
      adds++;
      entries.push({ property: change.property, action: "add" });
    } else if (change.action === "change") {
      lines.push(
        chalk.yellow(
          `    ~ ${change.property}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`
        )
      );
      changesCount++;
      entries.push({ property: change.property, action: "change" });
    }
  }

  return { lines, adds, changes: changesCount, warnings, entries };
}

/**
 * Formats warnings for display.
 */
export function formatWarnings(warnings: string[]): string[] {
  return warnings.map((w) => chalk.yellow(`  ⚠️  Warning: ${w}`));
}
