import chalk from "chalk";
import type { LabelChange, LabelAction } from "./diff.js";
import type { Label } from "../../config/index.js";
import { countActions } from "../base-processor.js";

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
  const createChanges = changes.filter((c) => c.action === "create");
  const updateChanges = changes.filter((c) => c.action === "update");
  const deleteChanges = changes.filter((c) => c.action === "delete");
  const unchangedItems = changes.filter((c) => c.action === "unchanged");

  // Format creates
  if (createChanges.length > 0) {
    lines.push(chalk.bold("  Create:"));
    for (const change of createChanges) {
      lines.push(chalk.green(`    + label "${change.name}"`));
      if (change.desired) {
        lines.push(chalk.green(`        color: "${change.desired.color}"`));
        if (change.desired.description !== undefined) {
          lines.push(
            chalk.green(`        description: "${change.desired.description}"`)
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

  // Format updates
  if (updateChanges.length > 0) {
    lines.push(chalk.bold("  Update:"));
    for (const change of updateChanges) {
      if (change.newName) {
        lines.push(
          chalk.yellow(
            `    ~ label "${change.name}" \u2192 "${change.newName}"`
          )
        );
      } else {
        lines.push(chalk.yellow(`    ~ label "${change.name}"`));
      }
      if (change.propertyChanges) {
        for (const prop of change.propertyChanges) {
          if (prop.property === "new_name") continue; // shown in header
          if (prop.oldValue !== undefined) {
            lines.push(
              chalk.yellow(
                `        ${prop.property}: "${prop.oldValue}" \u2192 "${prop.newValue}"`
              )
            );
          } else {
            lines.push(
              chalk.yellow(`        ${prop.property}: "${prop.newValue}"`)
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

  // Format deletes
  if (deleteChanges.length > 0) {
    lines.push(chalk.bold("  Delete:"));
    for (const change of deleteChanges) {
      lines.push(chalk.red(`    - label "${change.name}"`));
      entries.push({ name: change.name, action: "delete" });
    }
    lines.push("");
  }

  // Unchanged (entries only, no output lines)
  for (const change of unchangedItems) {
    entries.push({ name: change.name, action: "unchanged" });
  }

  // Summary line
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
