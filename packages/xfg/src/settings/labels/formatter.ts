import chalk from "chalk";
import type { LabelChange, LabelAction } from "./diff.js";
import type { Label } from "../../config/index.js";
import { countActions } from "../base-processor.js";
import { formatScalarValue, quoted } from "../../shared/string-utils.js";

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
  const lines: string[] = [];
  const entries: LabelsPlanEntry[] = [];

  const {
    create: creates,
    update: updates,
    delete: deletes,
    unchanged,
  } = countActions(changes);

  const grouped: Record<LabelAction, LabelChange[]> = {
    create: [],
    update: [],
    delete: [],
    unchanged: [],
  };
  for (const c of changes) {
    grouped[c.action].push(c);
  }

  if (grouped.create.length > 0) {
    lines.push(chalk.bold("  Create:"));
    for (const change of grouped.create) {
      lines.push(chalk.green(`    + label ${quoted(change.name)}`));
      if (change.desired) {
        lines.push(chalk.green(`        color: "${change.desired.color}"`));
        if (change.desired.description !== undefined) {
          lines.push(
            chalk.green(
              `        description: ${quoted(change.desired.description)}`
            )
          );
        }
      }
      entries.push({
        name: change.name,
        action: "create",
        config: change.desired,
      });
      lines.push("");
    }
  }

  if (grouped.update.length > 0) {
    lines.push(chalk.bold("  Update:"));
    for (const change of grouped.update) {
      if (change.newName) {
        lines.push(
          chalk.yellow(
            `    ~ label ${quoted(change.name)} \u2192 ${quoted(change.newName)}`
          )
        );
      } else {
        lines.push(chalk.yellow(`    ~ label ${quoted(change.name)}`));
      }
      if (change.propertyChanges) {
        for (const prop of change.propertyChanges) {
          if (prop.property === "new_name") continue;
          if (prop.oldValue !== undefined) {
            lines.push(
              chalk.yellow(
                `        ${prop.property}: ${formatScalarValue(prop.oldValue)} \u2192 ${formatScalarValue(prop.newValue)}`
              )
            );
          } else {
            lines.push(
              chalk.yellow(
                `        ${prop.property}: ${formatScalarValue(prop.newValue)}`
              )
            );
          }
        }
      }
      entries.push({
        name: change.name,
        action: "update",
        newName: change.newName,
        propertyChanges: change.propertyChanges,
      });
      lines.push("");
    }
  }

  if (grouped.delete.length > 0) {
    lines.push(chalk.bold("  Delete:"));
    for (const change of grouped.delete) {
      lines.push(chalk.red(`    - label ${quoted(change.name)}`));
      entries.push({ name: change.name, action: "delete" });
    }
    lines.push("");
  }

  for (const change of grouped.unchanged) {
    entries.push({ name: change.name, action: "unchanged" });
  }

  const total = creates + updates + deletes;
  if (total > 0) {
    const parts: string[] = [];
    if (creates > 0) parts.push(`${creates} to create`);
    if (updates > 0) parts.push(`${updates} to update`);
    if (deletes > 0) parts.push(`${deletes} to delete`);
    lines.push(`  Plan: ${total} labels (${parts.join(", ")})`);
  }

  return { lines, creates, updates, deletes, unchanged, entries };
}
