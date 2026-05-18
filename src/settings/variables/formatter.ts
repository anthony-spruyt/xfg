import type { VariableChange, VariableAction } from "./diff.js";
import { formatGroupedPlan } from "../base-processor.js";

export interface VariablesPlanEntry {
  name: string;
  action: VariableAction;
  oldValue?: string;
  newValue?: string;
}

export interface VariablesPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  entries: VariablesPlanEntry[];
}

export function formatVariablesPlan(
  changes: VariableChange[]
): VariablesPlanResult {
  return formatGroupedPlan<VariableChange, VariablesPlanEntry>(
    "variable",
    "variables",
    changes,
    {
      renderCreate(change) {
        const extraLines: string[] = [];
        if (change.newValue !== undefined) {
          extraLines.push(`        value: "${change.newValue}"`);
        }
        return {
          extraLines,
          entry: {
            name: change.name,
            action: "create",
            newValue: change.newValue,
          },
        };
      },

      renderUpdate(change) {
        const extraLines: string[] = [];
        if (change.oldValue !== undefined && change.newValue !== undefined) {
          extraLines.push(
            `        value: "${change.oldValue}" → "${change.newValue}"`
          );
        }
        return {
          extraLines,
          entry: {
            name: change.name,
            action: "update",
            oldValue: change.oldValue,
            newValue: change.newValue,
          },
        };
      },

      renderDelete(change) {
        return { name: change.name, action: "delete" };
      },

      renderUnchanged(change) {
        return { name: change.name, action: "unchanged" };
      },
    }
  );
}
