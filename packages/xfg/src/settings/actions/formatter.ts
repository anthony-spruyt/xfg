import { formatScalarValue } from "../../shared/string-utils.js";
import type { ActionsChange } from "./diff.js";
import { formatChangeLines, type PlanEntry } from "../base-processor.js";

export type ActionsPlanEntry = PlanEntry;

export interface ActionsPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  entries: ActionsPlanEntry[];
}

function formatValue(val: unknown): string {
  if (Array.isArray(val)) {
    return `[${val.join(", ")}]`;
  }
  return formatScalarValue(val) ?? String(val);
}

/**
 * Formats Actions changes as Terraform-style plan output.
 */
export function formatActionsPlan(changes: ActionsChange[]): ActionsPlanResult {
  return formatChangeLines(changes, formatValue);
}
