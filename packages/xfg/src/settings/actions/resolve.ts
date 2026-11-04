import {
  ACTIONS_SELECTED_FIELDS,
  type ActionsSettings,
} from "../../config/index.js";

export interface ResolvedActionsSettings {
  settings: ActionsSettings;
  warnings: string[];
}

function drop(
  settings: ActionsSettings,
  fields: ReadonlyArray<keyof ActionsSettings>,
  reason: string,
  warnings: string[]
): void {
  const present = fields.filter((f) => settings[f] !== undefined);
  if (present.length === 0) return;
  for (const field of present) delete settings[field];
  warnings.push(`actions: ${present.join(", ")} ignored: ${reason}`);
}

const FIELDS_NEEDING_ENABLED = [
  "allowedActions",
  "shaPinningRequired",
  ...ACTIONS_SELECTED_FIELDS,
] as const satisfies ReadonlyArray<keyof ActionsSettings>;

/**
 * Drops merged fields GitHub would reject: a repo can override an inherited
 * `selected` mode or disable Actions without restating the rest of the block.
 */
export function resolveActionsSettings(
  actions: ActionsSettings
): ResolvedActionsSettings {
  const settings: ActionsSettings = { ...actions };
  const warnings: string[] = [];

  if (settings.enabled === false) {
    drop(
      settings,
      FIELDS_NEEDING_ENABLED,
      "GitHub Actions is disabled (enabled: false)",
      warnings
    );
  }

  if (
    settings.allowedActions !== undefined &&
    settings.allowedActions !== "selected"
  ) {
    drop(
      settings,
      ACTIONS_SELECTED_FIELDS,
      'they only apply when allowedActions is "selected"',
      warnings
    );
  }

  return { settings, warnings };
}

/**
 * Drops the fields GitHub rejects while Actions is off on the repo, unless the
 * config turns it on, so an inherited block can't fail every run.
 */
export function resolveForCurrentState(
  desired: ActionsSettings,
  current: ActionsSettings
): ResolvedActionsSettings {
  const settings: ActionsSettings = { ...desired };
  const warnings: string[] = [];

  if (desired.enabled === undefined && current.enabled === false) {
    drop(
      settings,
      FIELDS_NEEDING_ENABLED,
      "GitHub Actions is disabled on the repo (set enabled: true to apply them)",
      warnings
    );
  }

  return { settings, warnings };
}
