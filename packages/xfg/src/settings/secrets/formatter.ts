import chalk from "chalk";
import { quoted } from "../../shared/string-utils.js";
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
  /** Set for environment secrets */
  environment?: string;
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

/** `secret "X"` plus its notes, e.g. `secret "X" (environment "release", update, value write-only)`. */
export function formatSecretLabel(entry: SecretsPlanEntry): string {
  const notes: string[] = [];
  if (entry.environment !== undefined) {
    notes.push(`environment ${quoted(entry.environment)}`);
  }
  if (entry.action === "update") notes.push("update", "value write-only");
  const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
  return `secret ${quoted(entry.name)}${suffix}`;
}

// Names only: this formatter must never receive or print a secret value.
function formatEntry(entry: SecretsPlanEntry): string {
  switch (entry.action) {
    case "create":
      return chalk.green(`    + ${formatSecretLabel(entry)}`);
    case "update":
      return chalk.yellow(`    ~ ${formatSecretLabel(entry)}`);
    case "delete":
      return chalk.red(`    - ${formatSecretLabel(entry)}`);
  }
}

export function formatSecretsPlan(
  changes: SecretChange[],
  dryRun: boolean
): SecretsPlanResult {
  const entries: SecretsPlanEntry[] = changes
    .filter(isActiveAction)
    .map((c) =>
      c.environment === undefined
        ? { name: c.name, action: c.action }
        : { name: c.name, action: c.action, environment: c.environment }
    )
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
