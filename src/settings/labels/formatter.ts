import type { LabelChange, LabelAction } from "./diff.js";
import type { Label } from "../../config/index.js";
import { formatGroupedPlan } from "../base-processor.js";

export interface LabelsPlanEntry {
  name: string;
  action: LabelAction;
  newName?: string;
  propertyChanges?: {
    property: string;
    oldValue?: string;
    newValue?: string;
  }[];
  config?: Label;
}

export interface LabelsPlanResult {
  lines: string[];
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  entries: LabelsPlanEntry[];
}

/**
 * Format label changes as a Terraform-style plan.
 */
export function formatLabelsPlan(changes: LabelChange[]): LabelsPlanResult {
  return formatGroupedPlan<LabelChange, LabelsPlanEntry>(
    "label",
    "labels",
    changes,
    {
      renderCreate(change) {
        const extraLines: string[] = [];
        if (change.desired) {
          extraLines.push(`        color: "${change.desired.color}"`);
          if (change.desired.description !== undefined) {
            extraLines.push(
              `        description: "${change.desired.description}"`
            );
          }
        }
        return {
          extraLines,
          entry: {
            name: change.name,
            action: "create",
            config: change.desired,
          },
        };
      },

      renderUpdate(change) {
        const extraLines: string[] = [];
        const headerOverride = change.newName
          ? `    ~ label "${change.name}" → "${change.newName}"`
          : undefined;
        if (change.propertyChanges) {
          for (const prop of change.propertyChanges) {
            if (prop.property === "new_name") continue; // shown in header
            if (prop.oldValue !== undefined) {
              extraLines.push(
                `        ${prop.property}: "${prop.oldValue}" → "${prop.newValue}"`
              );
            } else {
              extraLines.push(`        ${prop.property}: "${prop.newValue}"`);
            }
          }
        }
        return {
          extraLines,
          entry: {
            name: change.name,
            action: "update",
            newName: change.newName,
            propertyChanges: change.propertyChanges,
          },
          headerOverride,
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
