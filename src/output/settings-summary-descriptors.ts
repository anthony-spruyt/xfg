import type { SettingsReport } from "./settings-report.js";

export interface SettingsSummaryDescriptor {
  key: keyof SettingsReport["totals"];
  noun: string;
  plural: string;
  actions: ("create" | "update" | "delete")[];
}

export const settingsSummaryDescriptors: SettingsSummaryDescriptor[] = [
  {
    key: "settings",
    noun: "setting",
    plural: "settings",
    actions: ["create", "update"],
  },
  {
    key: "rulesets",
    noun: "ruleset",
    plural: "rulesets",
    actions: ["create", "update", "delete"],
  },
  {
    key: "labels",
    noun: "label",
    plural: "labels",
    actions: ["create", "update", "delete"],
  },
  {
    key: "variables",
    noun: "variable",
    plural: "variables",
    actions: ["create", "update", "delete"],
  },
];

export const actionLabels: Record<
  "create" | "update" | "delete",
  { past: string; future: string }
> = {
  create: { past: "created", future: "to create" },
  update: { past: "updated", future: "to update" },
  delete: { past: "deleted", future: "to delete" },
};
