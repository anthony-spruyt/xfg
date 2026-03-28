import type { SettingsReport, RepoChanges } from "../output/settings-report.js";
import {
  type RepoSettingsPlanEntry,
  type RulesetPlanEntry,
  type LabelsPlanEntry,
  type CodeScanningPlanEntry,
  countActions,
  isActiveAction,
} from "../settings/index.js";

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
  labelsResult?: {
    planOutput?: {
      entries?: LabelsPlanEntry[];
    };
  };
  codeScanningResult?: {
    planOutput?: {
      entries?: CodeScanningPlanEntry[];
    };
  };
  error?: string;
}

export function buildSettingsReport(
  results: ProcessorResults[]
): SettingsReport {
  const repos: RepoChanges[] = [];
  const totals = {
    settings: { create: 0, update: 0 },
    rulesets: { create: 0, update: 0, delete: 0 },
    labels: { create: 0, update: 0, delete: 0 },
  };

  for (const result of results) {
    const repoChanges: RepoChanges = {
      repoName: result.repoName,
      settings: [],
      rulesets: [],
      labels: [],
    };

    // Convert settings processor output
    if (result.settingsResult?.planOutput?.entries) {
      for (const entry of result.settingsResult.planOutput.entries) {
        // Skip settings where both values are undefined (no actual change)
        if (entry.oldValue === undefined && entry.newValue === undefined) {
          continue;
        }
        repoChanges.settings.push({
          name: entry.property,
          action: entry.action,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
        });
      }
      const counts = countActions(repoChanges.settings);
      totals.settings.create += counts.create;
      totals.settings.update += counts.update;
    }

    // Convert ruleset processor output
    if (result.rulesetResult?.planOutput?.entries) {
      for (const entry of result.rulesetResult.planOutput.entries) {
        if (!isActiveAction(entry)) continue;
        repoChanges.rulesets.push({
          name: entry.name,
          action: entry.action,
          propertyDiffs: entry.propertyDiffs,
          config: entry.config,
        });
      }
      const counts = countActions(repoChanges.rulesets);
      totals.rulesets.create += counts.create;
      totals.rulesets.update += counts.update;
      totals.rulesets.delete += counts.delete;
    }

    // Convert labels processor output
    if (result.labelsResult?.planOutput?.entries) {
      for (const entry of result.labelsResult.planOutput.entries) {
        if (!isActiveAction(entry)) continue;
        repoChanges.labels.push({
          name: entry.name,
          action: entry.action,
          newName: entry.newName,
          propertyChanges: entry.propertyChanges,
          config: entry.config,
        });
      }
      const counts = countActions(repoChanges.labels);
      totals.labels.create += counts.create;
      totals.labels.update += counts.update;
      totals.labels.delete += counts.delete;
    }

    // Convert code scanning processor output
    if (result.codeScanningResult?.planOutput?.entries) {
      let csCreates = 0;
      let csUpdates = 0;
      for (const entry of result.codeScanningResult.planOutput.entries) {
        repoChanges.settings.push({
          name: `codeScanning.${entry.property}`,
          action: entry.action,
          oldValue: entry.oldValue,
          newValue: entry.newValue ?? null,
        });
        if (entry.action === "create") csCreates++;
        if (entry.action === "update") csUpdates++;
      }
      totals.settings.create += csCreates;
      totals.settings.update += csUpdates;
    }

    if (result.error) {
      repoChanges.error = result.error;
    }

    repos.push(repoChanges);
  }

  return { repos, totals };
}
