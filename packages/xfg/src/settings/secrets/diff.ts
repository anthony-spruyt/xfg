import type { GitHubSecret } from "./types.js";
import type { SettingsAction } from "../base-processor.js";

export type SecretAction = SettingsAction;

export interface SecretChange {
  action: SecretAction;
  name: string;
}

/**
 * Diffs remote secrets against the desired name set.
 * Existing secrets always report `update`, never `unchanged` — GitHub secret
 * values are write-only, so we cannot tell whether the value actually changed.
 */
export function diffSecrets(
  current: GitHubSecret[],
  desiredNames: string[],
  deleteOrphaned: boolean
): SecretChange[] {
  const changes: SecretChange[] = [];

  const currentByName = new Map<string, GitHubSecret>();
  for (const s of current) {
    currentByName.set(s.name.toUpperCase(), s);
  }

  const desiredUpper = new Set(desiredNames.map((n) => n.toUpperCase()));

  for (const name of desiredNames) {
    const existing = currentByName.get(name.toUpperCase());
    changes.push({ action: existing ? "update" : "create", name });
  }

  if (deleteOrphaned) {
    for (const [nameUpper, currentSecret] of currentByName) {
      if (!desiredUpper.has(nameUpper)) {
        changes.push({ action: "delete", name: currentSecret.name });
      }
    }
  }

  const actionOrder: Record<SecretAction, number> = {
    delete: 0,
    update: 1,
    create: 2,
    unchanged: 3,
  };

  return changes.sort((a, b) => actionOrder[a.action] - actionOrder[b.action]);
}
