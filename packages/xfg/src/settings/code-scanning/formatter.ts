import { formatScalarValue } from "../../shared/string-utils.js";
import type { CodeScanningChange } from "./diff.js";
import { formatChangeLines, type PlanEntry } from "../base-processor.js";

export type CodeScanningPlanEntry = PlanEntry;

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
  return formatChangeLines(changes, formatValue);
}
