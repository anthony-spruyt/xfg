import chalk from "chalk";
import { quoted } from "../../shared/string-utils.js";
import { countActions } from "../base-processor.js";
import { formatActionCountEntry } from "../../shared/count-format.js";
import type { DeploymentBranchPattern } from "../../config/index.js";
import type {
  BranchPolicyKind,
  EnvironmentChange,
  EnvironmentDeletion,
} from "./diff.js";

export interface EnvironmentsUpsertEntry {
  name: string;
  action: "create" | "update";
  /** Set on updates that change the policy kind */
  currentKind?: BranchPolicyKind;
  desiredKind: BranchPolicyKind;
  addedPatterns: DeploymentBranchPattern[];
  removedPatterns: DeploymentBranchPattern[];
}

export interface EnvironmentsDeleteEntry {
  name: string;
  action: "delete";
}

export type EnvironmentsPlanEntry =
  | EnvironmentsUpsertEntry
  | EnvironmentsDeleteEntry;

export interface EnvironmentsPlanResult {
  lines: string[];
  entries: EnvironmentsPlanEntry[];
}

function toEntry(change: EnvironmentChange): EnvironmentsUpsertEntry | null {
  if (change.action === "unchanged") return null;
  const entry: EnvironmentsUpsertEntry = {
    name: change.name,
    action: change.action,
    desiredKind: change.desiredKind,
    addedPatterns: change.missingPatterns,
    removedPatterns: change.orphanPatterns.map(({ type, name }) => ({
      type,
      name,
    })),
  };
  if (change.action === "update" && change.putPolicy) {
    entry.currentKind = change.currentKind;
  }
  return entry;
}

export function formatPolicyLine(entry: EnvironmentsUpsertEntry): string | null {
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
  if (entry.action === "delete") {
    return [chalk.red(`    - environment ${quoted(entry.name)}`)];
  }
  const color = entry.action === "create" ? chalk.green : chalk.yellow;
  const sign = entry.action === "create" ? "+" : "~";
  const lines = [color(`    ${sign} environment ${quoted(entry.name)}`)];
  const policy = formatPolicyLine(entry);
  if (policy) lines.push(`        ${policy}`);
  for (const pattern of entry.addedPatterns) {
    lines.push(chalk.green(`        + ${formatPatternLabel(pattern)}`));
  }
  for (const pattern of entry.removedPatterns) {
    lines.push(chalk.red(`        - ${formatPatternLabel(pattern)}`));
  }
  return lines;
}

const ACTION_RANK: Record<EnvironmentsPlanEntry["action"], number> = {
  create: 0,
  update: 1,
  delete: 2,
};

export function formatEnvironmentsPlan(
  changes: EnvironmentChange[],
  dryRun: boolean,
  deletions: EnvironmentDeletion[] = []
): EnvironmentsPlanResult {
  const entries: EnvironmentsPlanEntry[] = [
    ...changes
      .map(toEntry)
      .filter((e): e is EnvironmentsUpsertEntry => e !== null),
    ...deletions.map(({ name }) => ({ name, action: "delete" as const })),
  ].sort((a, b) => ACTION_RANK[a.action] - ACTION_RANK[b.action]);

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
