import chalk from "chalk";
import type { VariableChange, VariableAction } from "./diff.js";
import { countActions } from "../base-processor.js";

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
  const lines: string[] = [];
  const entries: VariablesPlanEntry[] = [];

  const {
    create: creates,
    update: updates,
    delete: deletes,
    unchanged,
  } = countActions(changes);

  const grouped: Record<VariableAction, VariableChange[]> = {
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
      lines.push(chalk.green(`    + variable "${change.name}"`));
      if (change.newValue !== undefined) {
        lines.push(chalk.green(`        value: "${change.newValue}"`));
      }
      entries.push({
        name: change.name,
        action: "create",
        newValue: change.newValue,
      });
      lines.push("");
    }
  }

  if (grouped.update.length > 0) {
    lines.push(chalk.bold("  Update:"));
    for (const change of grouped.update) {
      lines.push(chalk.yellow(`    ~ variable "${change.name}"`));
      if (change.oldValue !== undefined && change.newValue !== undefined) {
        lines.push(
          chalk.yellow(
            `        value: "${change.oldValue}" → "${change.newValue}"`
          )
        );
      }
      entries.push({
        name: change.name,
        action: "update",
        oldValue: change.oldValue,
        newValue: change.newValue,
      });
      lines.push("");
    }
  }

  if (grouped.delete.length > 0) {
    lines.push(chalk.bold("  Delete:"));
    for (const change of grouped.delete) {
      lines.push(chalk.red(`    - variable "${change.name}"`));
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
    lines.push(`  Plan: ${total} variables (${parts.join(", ")})`);
  }

  return { lines, creates, updates, deletes, unchanged, entries };
}
