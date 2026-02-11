import type { PropertyDiff } from "../settings/rulesets/formatter.js";
import type { Ruleset } from "../config/index.js";

export interface SettingsReport {
  repos: RepoChanges[];
  totals: {
    settings: { add: number; change: number };
    rulesets: { create: number; update: number; delete: number };
  };
}

export interface RepoChanges {
  repoName: string;
  settings: SettingChange[];
  rulesets: RulesetChange[];
  error?: string;
}

export interface SettingChange {
  name: string;
  action: "add" | "change";
  oldValue?: unknown;
  newValue: unknown;
}

export interface RulesetChange {
  name: string;
  action: "create" | "update" | "delete";
  propertyDiffs?: PropertyDiff[];
  config?: Ruleset;
}
