import type {
  SettingsReport,
  RepoChanges,
  RulesetChange,
  LabelChange,
} from "../output/index.js";
import {
  type RepoSettingsPlanEntry,
  type RulesetPlanEntry,
  type LabelsPlanEntry,
  type CodeScanningPlanEntry,
  type VariablesPlanEntry,
  type SettingsAction,
  type ActiveAction,
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
  variablesResult?: {
    planOutput?: {
      entries?: VariablesPlanEntry[];
    };
  };
  error?: string;
}

/**
 * An entity collector encapsulates the collect-filter-count-accumulate
 * logic for one entity type (rulesets, labels, or variables).
 */
interface EntityCollector {
  collect: (
    result: ProcessorResults,
    repoChanges: RepoChanges,
    totals: SettingsReport["totals"]
  ) => void;
}

/**
 * Creates a type-safe entity collector that filters active entries,
 * maps them to the target array, and accumulates totals.
 */
function makeEntityCollector<
  TEntry extends { action: SettingsAction },
  TChange extends { action: ActiveAction },
>(config: {
  getEntries: (result: ProcessorResults) => TEntry[] | undefined;
  mapEntry: (entry: TEntry & { action: ActiveAction }) => TChange;
  getTarget: (repoChanges: RepoChanges) => TChange[];
  addToTotals: (
    totals: SettingsReport["totals"],
    counts: { create: number; update: number; delete: number }
  ) => void;
}): EntityCollector {
  return {
    collect(result, repoChanges, totals) {
      const entries = config.getEntries(result);
      if (!entries) return;

      const target = config.getTarget(repoChanges);
      for (const entry of entries) {
        if (!isActiveAction(entry)) continue;
        target.push(config.mapEntry(entry));
      }
      const counts = countActions(target);
      config.addToTotals(totals, counts);
    },
  };
}

const entityCollectors: EntityCollector[] = [
  makeEntityCollector<RulesetPlanEntry, RulesetChange>({
    getEntries: (r) => r.rulesetResult?.planOutput?.entries,
    mapEntry: (entry) => ({
      name: entry.name,
      action: entry.action,
      propertyDiffs: entry.propertyDiffs,
      config: entry.config,
    }),
    getTarget: (rc) => rc.rulesets,
    addToTotals: (totals, counts) => {
      totals.rulesets.create += counts.create;
      totals.rulesets.update += counts.update;
      totals.rulesets.delete += counts.delete;
    },
  }),
  makeEntityCollector<LabelsPlanEntry, LabelChange>({
    getEntries: (r) => r.labelsResult?.planOutput?.entries,
    mapEntry: (entry) => ({
      name: entry.name,
      action: entry.action,
      newName: entry.newName,
      propertyChanges: entry.propertyChanges,
      config: entry.config,
    }),
    getTarget: (rc) => rc.labels,
    addToTotals: (totals, counts) => {
      totals.labels.create += counts.create;
      totals.labels.update += counts.update;
      totals.labels.delete += counts.delete;
    },
  }),
  makeEntityCollector<VariablesPlanEntry, RepoChanges["variables"][number]>({
    getEntries: (r) => r.variablesResult?.planOutput?.entries,
    mapEntry: (entry) => ({
      name: entry.name,
      action: entry.action,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
    }),
    getTarget: (rc) => rc.variables,
    addToTotals: (totals, counts) => {
      totals.variables.create += counts.create;
      totals.variables.update += counts.update;
      totals.variables.delete += counts.delete;
    },
  }),
];

export function buildSettingsReport(
  results: ProcessorResults[]
): SettingsReport {
  const repos: RepoChanges[] = [];
  const totals = {
    settings: { create: 0, update: 0 },
    rulesets: { create: 0, update: 0, delete: 0 },
    labels: { create: 0, update: 0, delete: 0 },
    variables: { create: 0, update: 0, delete: 0 },
  };

  for (const result of results) {
    const repoChanges: RepoChanges = {
      repoName: result.repoName,
      settings: [],
      rulesets: [],
      labels: [],
      variables: [],
    };

    // Settings and code scanning both map into repoChanges.settings
    if (result.settingsResult?.planOutput?.entries) {
      for (const entry of result.settingsResult.planOutput.entries) {
        if (!isActiveAction(entry)) continue;
        repoChanges.settings.push({
          name: entry.property,
          action: entry.action,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
        });
      }
    }

    if (result.codeScanningResult?.planOutput?.entries) {
      for (const entry of result.codeScanningResult.planOutput.entries) {
        if (!isActiveAction(entry)) continue;
        repoChanges.settings.push({
          name: `codeScanning.${entry.property}`,
          action: entry.action,
          oldValue: entry.oldValue,
          newValue: entry.newValue ?? null,
        });
      }
    }

    if (repoChanges.settings.length > 0) {
      const counts = countActions(repoChanges.settings);
      totals.settings.create += counts.create;
      totals.settings.update += counts.update;
    }

    // Rulesets, labels, and variables follow the same collect-filter-count pattern
    for (const collector of entityCollectors) {
      collector.collect(result, repoChanges, totals);
    }

    if (result.error) {
      repoChanges.error = result.error;
    }

    repos.push(repoChanges);
  }

  return { repos, totals };
}
