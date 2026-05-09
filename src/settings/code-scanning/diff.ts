import type { CodeScanningSettings } from "../../config/index.js";
import type { CurrentCodeScanningSettings } from "./types.js";
import type { SettingsAction } from "../base-processor.js";

export interface CodeScanningChange {
  property: "state" | "querySuite" | "languages";
  action: SettingsAction;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Compares current code scanning default setup with desired settings.
 * Only compares properties that are explicitly set in desired.
 * Languages are compared as sorted arrays (order doesn't matter).
 */
export function diffCodeScanning(
  current: CurrentCodeScanningSettings,
  desired: CodeScanningSettings
): CodeScanningChange[] {
  const changes: CodeScanningChange[] = [];

  // state is always compared (required field)
  if (current.state !== desired.state) {
    changes.push({
      property: "state",
      action: current.state === undefined ? "create" : "update",
      oldValue: current.state,
      newValue: desired.state,
    });
  } else {
    changes.push({
      property: "state",
      action: "unchanged",
      oldValue: current.state,
      newValue: desired.state,
    });
  }

  // querySuite: only diff if specified in desired
  if (desired.querySuite !== undefined) {
    const currentQS = current.query_suite;
    if (currentQS !== desired.querySuite) {
      changes.push({
        property: "querySuite",
        action: currentQS === undefined ? "create" : "update",
        oldValue: currentQS,
        newValue: desired.querySuite,
      });
    } else {
      changes.push({
        property: "querySuite",
        action: "unchanged",
        oldValue: currentQS,
        newValue: desired.querySuite,
      });
    }
  }

  // languages: only diff if specified in desired (sorted comparison)
  if (desired.languages !== undefined) {
    const currentLangs = [...(current.languages ?? [])].sort((a, b) =>
      a.localeCompare(b)
    );
    const desiredLangs = [...desired.languages].sort((a, b) =>
      a.localeCompare(b)
    );
    const langsMatch =
      currentLangs.length === desiredLangs.length &&
      currentLangs.every((lang, i) => lang === desiredLangs[i]);

    if (!langsMatch) {
      changes.push({
        property: "languages",
        action: current.languages === undefined ? "create" : "update",
        oldValue: current.languages,
        newValue: desired.languages,
      });
    } else {
      changes.push({
        property: "languages",
        action: "unchanged",
        oldValue: current.languages,
        newValue: desired.languages,
      });
    }
  }

  return changes;
}

/**
 * Checks if there are any actual changes to apply.
 */
export function hasCodeScanningChanges(changes: CodeScanningChange[]): boolean {
  return changes.some((c) => c.action !== "unchanged");
}
