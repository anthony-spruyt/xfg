import type { GitHubSecret } from "./types.js";
import type { SettingsAction } from "../base-processor.js";

export type SecretAction = SettingsAction;

export interface SecretChange {
  action: SecretAction;
  name: string;
}

export function diffSecrets(
  current: GitHubSecret[],
  desired: string[],
  deleteOrphaned: boolean
): SecretChange[] {
  const changes: SecretChange[] = [];

  const currentByName = new Set<string>();
  for (const s of current) {
    currentByName.add(s.name.toUpperCase());
  }

  const desiredUpper = new Set(desired.map((n) => n.toUpperCase()));

  for (const name of desired) {
    if (currentByName.has(name.toUpperCase())) {
      // Secret values are encrypted, so we can't compare — always treat as update
      changes.push({ action: "update", name });
    } else {
      changes.push({ action: "create", name });
    }
  }

  if (deleteOrphaned) {
    for (const s of current) {
      if (!desiredUpper.has(s.name.toUpperCase())) {
        changes.push({ action: "delete", name: s.name });
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
