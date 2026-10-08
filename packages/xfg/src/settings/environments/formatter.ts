import chalk from "chalk";
import { quoted } from "../../shared/string-utils.js";
import { countActions } from "../base-processor.js";
import { formatActionCountEntry } from "../../shared/count-format.js";
import type { DeploymentBranchPattern } from "../../config/index.js";
import type { BranchPolicyKind, EnvironmentChange } from "./diff.js";

export interface EnvironmentsPlanEntry {
  name: string;
  action: "create" | "update";
  /** Set on updates that change the policy kind */
  currentKind?: BranchPolicyKind;
  desiredKind: BranchPolicyKind;
  addedPatterns: DeploymentBranchPattern[];
}

export interface EnvironmentsPlanResult {
  lines: string[];
  entries: EnvironmentsPlanEntry[];
}

function toEntry(change: EnvironmentChange): EnvironmentsPlanEntry | null {
  if (change.action === "unchanged") return null;
  const entry: EnvironmentsPlanEntry = {
    name: change.name,
    action: change.action,
    desiredKind: change.desiredKind,
    addedPatterns: change.missingPatterns,
  };
  if (change.action === "update" && change.putPolicy) {
    entry.currentKind = change.currentKind;
  }
  return entry;
}

export function formatPolicyLine(entry: EnvironmentsPlanEntry): string | null {
  if (entry.action === "create") {
    return `deployment branches: ${entry.desiredKind}`;
  }
  if (entry.currentKind !== undefined) {
    return `deployment branches: ${entry.currentKind} → ${entry.desiredKind}`;
  }
  return null;
}

export function formatPatternLabel(pattern: DeploymentBranchPattern): string {
  return `${pattern.type} ${quoted(pattern.name)}`;
}

function formatEntry(entry: EnvironmentsPlanEntry): string[] {
  const color = entry.action === "create" ? chalk.green : chalk.yellow;
  const sign = entry.action === "create" ? "+" : "~";
  const lines = [color(`    ${sign} environment ${quoted(entry.name)}`)];
  const policy = formatPolicyLine(entry);
  if (policy) lines.push(`        ${policy}`);
  for (const pattern of entry.addedPatterns) {
    lines.push(chalk.green(`        + ${formatPatternLabel(pattern)}`));
  }
  return lines;
}

function actionRank(entry: EnvironmentsPlanEntry): number {
  return entry.action === "create" ? 0 : 1;
}

export function formatEnvironmentsPlan(
  changes: EnvironmentChange[],
  dryRun: boolean
): EnvironmentsPlanResult {
  const entries = changes
    .map(toEntry)
    .filter((e): e is EnvironmentsPlanEntry => e !== null)
    .sort((a, b) => actionRank(a) - actionRank(b));

  const summary = formatActionCountEntry(
    "environment",
    "environments",
    countActions(entries),
    dryRun
  );
  if (!summary) {
    return { lines: [], entries };
  }

  return {
    lines: [
      ...entries.flatMap(formatEntry),
      `  ${dryRun ? "Plan" : "Applied"}: ${summary}`,
    ],
    entries,
  };
}
