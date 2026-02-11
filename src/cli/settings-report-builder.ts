import type {
  SettingsReport,
  RepoChanges,
  SettingChange,
  RulesetChange,
} from "../output/settings-report.js";
import type { RepoSettingsPlanEntry } from "../settings/repo-settings/formatter.js";
import type { RulesetPlanEntry } from "../settings/rulesets/formatter.js";

/**
 * Result from processing a repository's settings and rulesets.
 * Used to collect results during settings command execution.
 */
export interface ProcessorResults {
  repoName: string;
  settingsResult?: {
    planOutput?: {
      entries?: RepoSettingsPlanEntry[];
    };
  };
  rulesetResult?: {
    planOutput?: {
      entries?: RulesetPlanEntry[];
    };
  };
  error?: string;
}

export function buildSettingsReport(
  results: ProcessorResults[]
): SettingsReport {
  const repos: RepoChanges[] = [];
  const totals = {
    settings: { add: 0, change: 0 },
    rulesets: { create: 0, update: 0, delete: 0 },
  };

  for (const result of results) {
    const repoChanges: RepoChanges = {
      repoName: result.repoName,
      settings: [],
      rulesets: [],
    };

    // Convert settings processor output
    if (result.settingsResult?.planOutput?.entries) {
      for (const entry of result.settingsResult.planOutput.entries) {
        // Skip settings where both values are undefined (no actual change)
        if (entry.oldValue === undefined && entry.newValue === undefined) {
          continue;
        }
        const settingChange: SettingChange = {
          name: entry.property,
          action: entry.action,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
        };
        repoChanges.settings.push(settingChange);

        if (entry.action === "add") {
          totals.settings.add++;
        } else {
          totals.settings.change++;
        }
      }
    }

    // Convert ruleset processor output
    if (result.rulesetResult?.planOutput?.entries) {
      for (const entry of result.rulesetResult.planOutput.entries) {
        if (entry.action === "unchanged") continue;

        const rulesetChange: RulesetChange = {
          name: entry.name,
          action: entry.action as "create" | "update" | "delete",
          propertyDiffs: entry.propertyDiffs,
          config: entry.config,
        };
        repoChanges.rulesets.push(rulesetChange);

        if (entry.action === "create") {
          totals.rulesets.create++;
        } else if (entry.action === "update") {
          totals.rulesets.update++;
        } else if (entry.action === "delete") {
          totals.rulesets.delete++;
        }
      }
    }

    if (result.error) {
      repoChanges.error = result.error;
    }

    repos.push(repoChanges);
  }

  return { repos, totals };
}
