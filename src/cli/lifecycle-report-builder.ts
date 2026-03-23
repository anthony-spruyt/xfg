import type {
  LifecycleReport,
  LifecycleAction,
} from "../output/lifecycle-report.js";

export function buildLifecycleReport(
  results: LifecycleAction[]
): LifecycleReport {
  const actions: LifecycleAction[] = [];
  const totals = { created: 0, forked: 0, migrated: 0, existed: 0 };

  for (const result of results) {
    actions.push({
      repoName: result.repoName,
      action: result.action,
      upstream: result.upstream,
      source: result.source,
      settings: result.settings,
    });

    totals[result.action]++;
  }

  return { actions, totals };
}
