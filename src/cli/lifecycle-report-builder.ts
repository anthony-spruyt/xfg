import type { LifecycleReport, LifecycleAction } from "../output/index.js";

export function buildLifecycleReport(
  actions: LifecycleAction[]
): LifecycleReport {
  const totals = { created: 0, forked: 0, migrated: 0, existed: 0 };
  for (const action of actions) {
    totals[action.action]++;
  }
  return { actions, totals };
}
