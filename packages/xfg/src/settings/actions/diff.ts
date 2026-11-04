import type { ActionsSettings } from "../../config/index.js";
import type { SettingsAction } from "../base-processor.js";
import { ACTIONS_ENDPOINTS } from "./endpoints.js";

export interface ActionsChange {
  property: keyof ActionsSettings;
  action: SettingsAction;
  oldValue?: unknown;
  newValue?: unknown;
}

const FIELD_ORDER: ReadonlyArray<keyof ActionsSettings> =
  ACTIONS_ENDPOINTS.flatMap((e) => e.fields.map((f) => f.setting));

function sameValue(current: unknown, desired: unknown): boolean {
  if (Array.isArray(current) && Array.isArray(desired)) {
    const currentSet = new Set(current);
    const desiredSet = new Set(desired);
    return (
      currentSet.size === desiredSet.size &&
      [...desiredSet].every((v) => currentSet.has(v))
    );
  }
  return current === desired;
}

/** Only fields set in desired are compared; patternsAllowed compares as a set. */
export function diffActions(
  current: ActionsSettings,
  desired: ActionsSettings
): ActionsChange[] {
  const changes: ActionsChange[] = [];

  for (const property of FIELD_ORDER) {
    const newValue = desired[property];
    if (newValue === undefined) continue;

    const oldValue = current[property];
    const action: SettingsAction = sameValue(oldValue, newValue)
      ? "unchanged"
      : oldValue === undefined
        ? "create"
        : "update";
    changes.push({ property, action, oldValue, newValue });
  }

  return changes;
}

export function hasActionsChanges(changes: ActionsChange[]): boolean {
  return changes.some((c) => c.action !== "unchanged");
}
