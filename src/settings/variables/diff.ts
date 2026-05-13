import type { GitHubVariable } from "./types.js";
import type { SettingsAction } from "../base-processor.js";

export type VariableAction = SettingsAction;

export interface VariableChange {
  action: VariableAction;
  name: string;
  oldValue?: string;
  newValue?: string;
}

export function diffVariables(
  current: GitHubVariable[],
  desired: Record<string, string>,
  deleteOrphaned: boolean
): VariableChange[] {
  const changes: VariableChange[] = [];

  const currentByName = new Map<string, GitHubVariable>();
  for (const v of current) {
    currentByName.set(v.name.toUpperCase(), v);
  }

  const desiredUpper = new Set(
    Object.keys(desired).map((n) => n.toUpperCase())
  );

  for (const [name, desiredValue] of Object.entries(desired)) {
    const currentVar = currentByName.get(name.toUpperCase());

    if (!currentVar) {
      changes.push({ action: "create", name, newValue: desiredValue });
    } else if (currentVar.value !== desiredValue) {
      changes.push({
        action: "update",
        name,
        oldValue: currentVar.value,
        newValue: desiredValue,
      });
    } else {
      changes.push({ action: "unchanged", name });
    }
  }

  if (deleteOrphaned) {
    for (const [nameUpper, currentVar] of currentByName) {
      if (!desiredUpper.has(nameUpper)) {
        changes.push({ action: "delete", name: currentVar.name });
      }
    }
  }

  const actionOrder: Record<VariableAction, number> = {
    delete: 0,
    update: 1,
    create: 2,
    unchanged: 3,
  };

  return changes.sort((a, b) => actionOrder[a.action] - actionOrder[b.action]);
}
