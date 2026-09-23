import chalk from "chalk";
import type { SecretChange } from "./diff.js";
import {
  countActions,
  isActiveAction,
  type ActiveAction,
} from "../base-processor.js";

export interface SecretsPlanEntry {
  name: string;
  action: ActiveAction;
}

export interface SecretsPlanResult {
  lines: string[];
  entries: SecretsPlanEntry[];
}

const ACTION_ORDER: ActiveAction[] = ["create", "update", "delete"];

// Names only: this formatter must never receive or print a secret value.
function formatEntry(entry: SecretsPlanEntry): string {
  switch (entry.action) {
    case "create":
      return chalk.green(`    + secret "${entry.name}"`);
    case "update":
      return chalk.yellow(
        `    ~ secret "${entry.name}" (update, value write-only)`
      );
    case "delete":
      return chalk.red(`    - secret "${entry.name}"`);
  }
}

export function formatSecretsPlan(changes: SecretChange[]): SecretsPlanResult {
  const entries: SecretsPlanEntry[] = ACTION_ORDER.flatMap((action) =>
    changes
      .filter(isActiveAction)
      .filter((c) => c.action === action)
      .map((c) => ({ name: c.name, action: c.action }))
  );

  if (entries.length === 0) {
    return { lines: [], entries };
  }

  const counts = countActions(entries);
  const parts: string[] = [];
  if (counts.create > 0) parts.push(`${counts.create} to create`);
  if (counts.update > 0) parts.push(`${counts.update} to update`);
  if (counts.delete > 0) parts.push(`${counts.delete} to delete`);
  const noun = entries.length === 1 ? "secret" : "secrets";

  return {
    lines: [
      ...entries.map(formatEntry),
      `  Plan: ${entries.length} ${noun} (${parts.join(", ")})`,
    ],
    entries,
  };
}
