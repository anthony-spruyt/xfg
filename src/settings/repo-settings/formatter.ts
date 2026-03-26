import chalk from "chalk";
import { formatScalarValue } from "../../shared/string-utils.js";
import type { RepoSettingsChange } from "./diff.js";

export interface RepoSettingsPlanEntry {
  property: string;
  action: "create" | "update";
  oldValue?: unknown;
  newValue?: unknown;
}

export interface RepoSettingsPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  warnings: string[];
  entries: RepoSettingsPlanEntry[];
}

/**
 * Format a value for display.
 */
function formatValue(val: unknown): string {
  return formatScalarValue(val) ?? String(val);
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
  let creates = 0;
  let updates = 0;
  const entries: RepoSettingsPlanEntry[] = [];

  if (changes.length === 0) {
    return { lines, creates, updates, warnings, entries };
  }

  for (const change of changes) {
    const warning = getWarning(change);
    if (warning) {
      warnings.push(warning);
    }

    if (change.action === "create") {
      lines.push(
        chalk.green(`    + ${change.property}: ${formatValue(change.newValue)}`)
      );
      creates++;
      entries.push({
        property: change.property,
        action: "create",
        newValue: change.newValue,
      });
    } else if (change.action === "update") {
      lines.push(
        chalk.yellow(
          `    ~ ${change.property}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`
        )
      );
      updates++;
      entries.push({
        property: change.property,
        action: "update",
        oldValue: change.oldValue,
        newValue: change.newValue,
      });
    }
  }

  return { lines, creates, updates, warnings, entries };
}

/**
 * Formats warnings for display.
 */
export function formatWarnings(warnings: string[]): string[] {
  return warnings.map((w) => chalk.yellow(`  ⚠️  Warning: ${w}`));
}
