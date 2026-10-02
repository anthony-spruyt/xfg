import chalk from "chalk";
import { quoted } from "../../shared/string-utils.js";
import type { CollaboratorChange, CollaboratorAction } from "./diff.js";
import { countActions } from "../base-processor.js";

export interface CollaboratorsPlanEntry {
  name: string;
  action: CollaboratorAction;
  pending?: boolean;
}

export interface CollaboratorsPlanResult {
  lines: string[];
  creates: number;
  deletes: number;
  unchanged: number;
  entries: CollaboratorsPlanEntry[];
}

export function formatCollaboratorsPlan(
  changes: CollaboratorChange[]
): CollaboratorsPlanResult {
  const lines: string[] = [];
  const entries: CollaboratorsPlanEntry[] = changes.map((c) =>
    c.pending
      ? { name: c.username, action: c.action, pending: true }
      : { name: c.username, action: c.action }
  );
  const { create: creates, delete: deletes, unchanged } = countActions(changes);

  const creating = changes.filter((c) => c.action === "create");
  const deleting = changes.filter((c) => c.action === "delete");
  const pending = changes.filter((c) => c.action === "unchanged" && c.pending);

  if (creating.length > 0) {
    lines.push(chalk.bold("  Invite:"));
    for (const c of creating) {
      lines.push(
        chalk.green(`    + collaborator ${quoted(c.username)} (invite)`)
      );
    }
    lines.push("");
  }

  if (deleting.length > 0) {
    lines.push(chalk.bold("  Remove:"));
    for (const c of deleting) {
      const suffix = c.pending ? " (cancel invite)" : "";
      lines.push(
        chalk.red(`    - collaborator ${quoted(c.username)}${suffix}`)
      );
    }
    lines.push("");
  }

  for (const c of pending) {
    lines.push(
      chalk.dim(`    collaborator ${quoted(c.username)}: invite pending`)
    );
  }

  const total = creates + deletes;
  if (total > 0) {
    const parts: string[] = [];
    if (creates > 0) parts.push(`${creates} to invite`);
    if (deletes > 0) parts.push(`${deletes} to remove`);
    lines.push(`  Plan: ${total} collaborators (${parts.join(", ")})`);
  }

  return { lines, creates, deletes, unchanged, entries };
}
