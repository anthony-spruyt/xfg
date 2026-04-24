import chalk from "chalk";
import { formatScalarValue } from "../../shared/string-utils.js";
import { formatChangeLines, type PlanEntry } from "../base-processor.js";
import type { RepoSettingsChange } from "./diff.js";

export type RepoSettingsPlanEntry = PlanEntry;

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
  const warnings: string[] = [];

  if (changes.length === 0) {
    return { lines: [], creates: 0, updates: 0, warnings, entries: [] };
  }

  for (const change of changes) {
    const warning = getWarning(change);
    if (warning) {
      warnings.push(warning);
    }
  }

  const result = formatChangeLines(changes, formatValue);
  return { ...result, warnings };
}

/**
 * Formats warnings for display.
 */
export function formatWarnings(warnings: string[]): string[] {
  return warnings.map((w) => chalk.yellow(`  ⚠️  Warning: ${w}`));
}
