import chalk from "chalk";
import { formatScalarValue } from "../../shared/string-utils.js";
import type { CodeScanningChange } from "./diff.js";
import { countActions } from "../base-processor.js";

export interface CodeScanningPlanEntry {
  property: string;
  action: "create" | "update";
  oldValue?: unknown;
  newValue?: unknown;
}

export interface CodeScanningPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  entries: CodeScanningPlanEntry[];
}

function formatValue(val: unknown): string {
  if (Array.isArray(val)) {
    return `[${val.join(", ")}]`;
  }
  return formatScalarValue(val) ?? String(val);
}

/**
 * Formats code scanning changes as Terraform-style plan output.
 */
export function formatCodeScanningPlan(
  changes: CodeScanningChange[]
): CodeScanningPlanResult {
  const lines: string[] = [];
  const entries: CodeScanningPlanEntry[] = [];

  const { create: creates, update: updates } = countActions(changes);

  for (const change of changes) {
    if (change.action === "create") {
      lines.push(
        chalk.green(`    + ${change.property}: ${formatValue(change.newValue)}`)
      );
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
      entries.push({
        property: change.property,
        action: "update",
        oldValue: change.oldValue,
        newValue: change.newValue,
      });
    }
  }

  return { lines, creates, updates, entries };
}
