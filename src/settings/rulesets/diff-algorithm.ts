// src/settings/rulesets/diff-algorithm.ts

// =============================================================================
// Types
// =============================================================================

export type DiffAction = "add" | "change" | "remove";

export interface PropertyDiff {
  path: string[];
  action: DiffAction;
  oldValue?: unknown;
  newValue?: unknown;
}
