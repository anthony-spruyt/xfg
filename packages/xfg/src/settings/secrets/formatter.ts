import chalk from "chalk";
import type { SecretChange } from "./diff.js";
import {
  countActions,
  isActiveAction,
  type ActiveAction,
} from "../base-processor.js";
import { formatActionCountEntry } from "../../shared/count-format.js";

export interface SecretsPlanEntry {
  name: string;
  action: ActiveAction;
}

export interface SecretsPlanResult {
  lines: string[];
  entries: SecretsPlanEntry[];
}

const ACTION_ORDER: Record<ActiveAction, number> = {
  create: 0,
  update: 1,
  delete: 2,
};

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

export function formatSecretsPlan(
  changes: SecretChange[],
  dryRun: boolean
): SecretsPlanResult {
  const entries: SecretsPlanEntry[] = changes
    .filter(isActiveAction)
    .map((c) => ({ name: c.name, action: c.action }))
    .sort((a, b) => ACTION_ORDER[a.action] - ACTION_ORDER[b.action]);

  const summary = formatActionCountEntry(
    "secret",
    "secrets",
    countActions(entries),
    dryRun
  );
  if (!summary) {
    return { lines: [], entries };
  }

  return {
    lines: [
      ...entries.map(formatEntry),
      `  ${dryRun ? "Plan" : "Applied"}: ${summary}`,
    ],
    entries,
  };
}
