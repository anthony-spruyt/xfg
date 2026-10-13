import type { Label } from "../../config/index.js";
import type { GitHubLabel } from "./types.js";
import { normalizeColor } from "./converter.js";
import { ValidationError } from "../../shared/errors.js";
import type { SettingsAction } from "../base-processor.js";

export type LabelAction = SettingsAction;

export interface LabelChange {
  action: LabelAction;
  name: string;
  newName?: string;
  current?: GitHubLabel;
  desired?: Label;
  propertyChanges?: {
    property: string;
    oldValue?: string;
    newValue?: string;
  }[];
}

/**
 * Compares current labels (from GitHub) with desired labels (from config).
 *
 * Matching is case-insensitive by name (GitHub label names are case-insensitive).
 * Color comparison is case-insensitive bare hex (strip #, lowercase both sides).
 * Description: undefined in config means "do not compare" (leave current value).
 * An explicit empty string "" means "set to empty."
 * GitHub API returns null for labels without descriptions — treat null and
 * undefined as equivalent when comparing (neither triggers an update).
 * A `new_name` entry whose source is missing is treated as an already-applied
 * rename: the target is compared (or created) in its place and never deleted.
 * A rename target that is itself a `new_name` entry (a chain) is rejected, as
 * is a rename onto a label that already exists.
 *
 * @param current - Current labels from GitHub API
 * @param desired - Desired labels from config (name -> label)
 * @param deleteOrphaned - If true, delete current labels not in desired config
 * @param noDelete - If true, skip delete operations
 * @returns Array of changes to apply
 * @throws ValidationError if rename collisions or chains are detected
 */
export function diffLabels(
  current: GitHubLabel[],
  desired: Record<string, Label>,
  deleteOrphaned: boolean,
  noDelete: boolean
): LabelChange[] {
  const changes: LabelChange[] = [];

  const currentByName = new Map<string, GitHubLabel>();
  for (const label of current) {
    currentByName.set(label.name.toLowerCase(), label);
  }

  const renameTargets = new Map<string, string>(); // lowercase target -> source name
  for (const [name, label] of Object.entries(desired)) {
    if (label.new_name) {
      const targetLower = label.new_name.toLowerCase();
      if (renameTargets.has(targetLower)) {
        throw new ValidationError(
          `Rename collision: both '${renameTargets.get(targetLower)}' and '${name}' rename to '${label.new_name}'`
        );
      }
      renameTargets.set(targetLower, name);
    }
  }

  for (const [name, label] of Object.entries(desired)) {
    if (!label.new_name) continue;
    const targetLower = label.new_name.toLowerCase();
    if (targetLower === name.toLowerCase()) continue;
    const chained = Object.entries(desired).find(
      ([n, l]) => n.toLowerCase() === targetLower && l.new_name
    );
    if (chained) {
      throw new ValidationError(
        `Rename chain: '${name}' renames to '${label.new_name}', which is itself renamed to '${chained[1].new_name}'. Chained renames are not supported; run them separately`
      );
    }
  }

  // A rename whose source is gone was already applied: its target is the managed label
  const renamedTargets = new Set<string>();
  for (const [name, label] of Object.entries(desired)) {
    if (label.new_name && !currentByName.has(name.toLowerCase())) {
      renamedTargets.add(label.new_name.toLowerCase());
    }
  }

  const desiredLower = new Set([
    ...Object.keys(desired).map((n) => n.toLowerCase()),
    ...renamedTargets,
  ]);

  for (const [name, label] of Object.entries(desired)) {
    if (!label.new_name) continue;
    const targetLower = label.new_name.toLowerCase();
    const nameLower = name.toLowerCase();
    if (!currentByName.has(nameLower)) continue;

    // Never resolve a collision by deleting the target: deleting a label strips it from every PR
    if (currentByName.has(targetLower) && targetLower !== nameLower) {
      throw new ValidationError(
        `Rename collision: '${name}' would rename to '${label.new_name}', but that label already exists`
      );
    }
  }

  for (const [name, desiredLabel] of Object.entries(desired)) {
    const nameLower = name.toLowerCase();
    let currentLabel = currentByName.get(nameLower);
    let labelName = name;
    let labelConfig = desiredLabel;

    if (!currentLabel && desiredLabel.new_name) {
      const targetLower = desiredLabel.new_name.toLowerCase();
      // The target's own entry, if any, already covers this label
      if (Object.keys(desired).some((n) => n.toLowerCase() === targetLower)) {
        continue;
      }
      const { new_name: targetName, ...config } = desiredLabel;
      labelName = targetName;
      labelConfig = config;
      currentLabel = currentByName.get(targetLower);
    }

    if (!currentLabel) {
      changes.push({
        action: "create",
        name: labelName,
        desired: labelConfig,
      });
    } else {
      const propChanges: LabelChange["propertyChanges"] = [];
      const desiredColor = normalizeColor(labelConfig.color);
      const currentColor = currentLabel.color.toLowerCase();

      if (desiredColor !== currentColor) {
        propChanges.push({
          property: "color",
          oldValue: currentLabel.color,
          newValue: desiredColor,
        });
      }

      if (labelConfig.description !== undefined) {
        const currentDesc = currentLabel.description ?? "";
        if (labelConfig.description !== currentDesc) {
          propChanges.push({
            property: "description",
            oldValue: currentLabel.description ?? undefined,
            newValue: labelConfig.description,
          });
        }
      }

      if (
        labelConfig.new_name &&
        labelConfig.new_name !== currentLabel.name
      ) {
        propChanges.push({
          property: "new_name",
          oldValue: currentLabel.name,
          newValue: labelConfig.new_name,
        });
      }

      if (propChanges.length > 0) {
        changes.push({
          action: "update",
          name: currentLabel.name,
          newName: labelConfig.new_name,
          current: currentLabel,
          desired: labelConfig,
          propertyChanges: propChanges,
        });
      } else {
        changes.push({
          action: "unchanged",
          name: labelName,
          current: currentLabel,
          desired: labelConfig,
        });
      }
    }
  }

  if (deleteOrphaned && !noDelete) {
    for (const [nameLower, currentLabel] of currentByName) {
      if (!desiredLower.has(nameLower)) {
        changes.push({
          action: "delete",
          name: currentLabel.name,
          current: currentLabel,
        });
      }
    }
  }

  const actionOrder: Record<LabelAction, number> = {
    delete: 0,
    update: 1,
    create: 2,
    unchanged: 3,
  };

  return changes.sort((a, b) => actionOrder[a.action] - actionOrder[b.action]);
}
