import {
  hasLifecycleChanges,
  writeGitHubStepSummary,
  renderSyncLines,
  renderRepoSettingsDiffLines,
  formatCountEntry,
  type LifecycleReport,
  type LifecycleAction,
  type SyncReport,
  type SettingsReport,
} from "../output/index.js";

// =============================================================================
// Types
// =============================================================================

interface UnifiedSummaryInput {
  lifecycle?: LifecycleReport;
  sync?: SyncReport;
  settings?: SettingsReport;
  dryRun: boolean;
  summaryPath?: string | undefined;
}

// =============================================================================
// Helpers
// =============================================================================

function selectLabel(
  dry: boolean,
  pastLabel: string,
  futureLabel: string
): string {
  return dry ? futureLabel : pastLabel;
}

function formatCombinedSummary(input: UnifiedSummaryInput): string {
  const parts: string[] = [];
  const dry = input.dryRun;

  if (input.lifecycle) {
    const t = input.lifecycle.totals;
    const entry = formatCountEntry("repo", "repos", [
      { label: selectLabel(dry, "created", "to create"), value: t.created },
      { label: selectLabel(dry, "forked", "to fork"), value: t.forked },
      { label: selectLabel(dry, "migrated", "to migrate"), value: t.migrated },
    ]);
    if (entry) parts.push(entry);
  }

  if (input.sync) {
    const t = input.sync.totals;
    const entry = formatCountEntry("file", "files", [
      {
        label: selectLabel(dry, "created", "to create"),
        value: t.files.create,
      },
      {
        label: selectLabel(dry, "updated", "to update"),
        value: t.files.update,
      },
      {
        label: selectLabel(dry, "deleted", "to delete"),
        value: t.files.delete,
      },
    ]);
    if (entry) parts.push(entry);
  }

  if (input.settings) {
    const t = input.settings.totals;

    const settingsEntry = formatCountEntry("setting", "settings", [
      {
        label: selectLabel(dry, "created", "to create"),
        value: t.settings.create,
      },
      {
        label: selectLabel(dry, "updated", "to update"),
        value: t.settings.update,
      },
    ]);
    if (settingsEntry) parts.push(settingsEntry);

    const rulesetsEntry = formatCountEntry("ruleset", "rulesets", [
      {
        label: selectLabel(dry, "created", "to create"),
        value: t.rulesets.create,
      },
      {
        label: selectLabel(dry, "updated", "to update"),
        value: t.rulesets.update,
      },
      {
        label: selectLabel(dry, "deleted", "to delete"),
        value: t.rulesets.delete,
      },
    ]);
    if (rulesetsEntry) parts.push(rulesetsEntry);

    const labelsEntry = formatCountEntry("label", "labels", [
      {
        label: selectLabel(dry, "created", "to create"),
        value: t.labels.create,
      },
      {
        label: selectLabel(dry, "updated", "to update"),
        value: t.labels.update,
      },
      {
        label: selectLabel(dry, "deleted", "to delete"),
        value: t.labels.delete,
      },
    ]);
    if (labelsEntry) parts.push(labelsEntry);
  }

  if (parts.length === 0) {
    return "No changes";
  }

  const prefix = dry ? "Plan" : "Applied";
  return `${prefix}: ${parts.join(", ")}`;
}

function hasAnyChanges(input: UnifiedSummaryInput): boolean {
  return (
    (!!input.lifecycle && hasLifecycleChanges(input.lifecycle)) ||
    !!input.sync?.repos.some((r) => r.files.length > 0 || r.error) ||
    !!input.settings?.repos.some(
      (r) =>
        r.settings.length > 0 ||
        r.rulesets.length > 0 ||
        r.labels.length > 0 ||
        r.error
    )
  );
}

// =============================================================================
// Diff line builders
// =============================================================================

function renderLifecycleLines(
  lcAction: LifecycleAction,
  diffLines: string[]
): void {
  if (lcAction.action === "existed") return;

  switch (lcAction.action) {
    case "created":
      diffLines.push(`+ CREATE`);
      break;
    case "forked":
      diffLines.push(
        `+ FORK ${lcAction.upstream ?? "upstream"} -> ${lcAction.repoName}`
      );
      break;
    case "migrated":
      diffLines.push(
        `+ MIGRATE ${lcAction.source ?? "source"} -> ${lcAction.repoName}`
      );
      break;
    /* c8 ignore next 4 */
    default: {
      const _exhaustive: never = lcAction.action;
      throw new Error(`Unexpected lifecycle action: ${_exhaustive}`);
    }
  }

  if (lcAction.settings) {
    if (lcAction.settings.visibility) {
      diffLines.push(`+   visibility: ${lcAction.settings.visibility}`);
    }
    if (lcAction.settings.description) {
      diffLines.push(`+   description: "${lcAction.settings.description}"`);
    }
  }
}

// =============================================================================
// Markdown Formatter
// =============================================================================

export function formatUnifiedSummaryMarkdown(
  input: UnifiedSummaryInput
): string {
  if (!hasAnyChanges(input)) {
    return "";
  }

  const lines: string[] = [];

  // Title: "xfg Plan" for dry-run, "xfg Apply" otherwise
  const title = input.dryRun ? "## xfg Plan" : "## xfg Apply";
  lines.push(title);
  lines.push("");

  // Dry-run warning
  if (input.dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Build lookup maps
  const lifecycleByRepo = new Map(
    (input.lifecycle?.actions ?? []).map((a) => [a.repoName, a])
  );
  const syncByRepo = new Map(
    (input.sync?.repos ?? []).map((r) => [r.repoName, r])
  );
  const settingsByRepo = new Map(
    (input.settings?.repos ?? []).map((r) => [r.repoName, r])
  );

  // Collect all repo names in order
  const allRepos: string[] = [];
  const addRepo = (name: string) => {
    if (!allRepos.includes(name)) allRepos.push(name);
  };
  for (const a of input.lifecycle?.actions ?? []) addRepo(a.repoName);
  for (const r of input.sync?.repos ?? []) addRepo(r.repoName);
  for (const r of input.settings?.repos ?? []) addRepo(r.repoName);

  // Per-repo sections: heading + diff block
  for (const repoName of allRepos) {
    const lcAction = lifecycleByRepo.get(repoName);
    const syncRepo = syncByRepo.get(repoName);
    const settingsRepo = settingsByRepo.get(repoName);

    const hasLcChange = lcAction && lcAction.action !== "existed";
    const hasSyncChanges =
      syncRepo && (syncRepo.files.length > 0 || syncRepo.error);
    const hasSettingsChanges =
      settingsRepo &&
      (settingsRepo.settings.length > 0 ||
        settingsRepo.rulesets.length > 0 ||
        settingsRepo.labels.length > 0 ||
        settingsRepo.error);

    if (!hasLcChange && !hasSyncChanges && !hasSettingsChanges) continue;

    lines.push(`### ${repoName}`);
    lines.push("");

    const diffLines: string[] = [];

    if (lcAction) renderLifecycleLines(lcAction, diffLines);

    // Blank line between lifecycle and sync sections
    if (hasLcChange && hasSyncChanges) diffLines.push("");

    if (syncRepo) diffLines.push(...renderSyncLines(syncRepo));

    // Blank line between files and settings sections
    if (hasSyncChanges && hasSettingsChanges) diffLines.push("");

    if (settingsRepo) renderRepoSettingsDiffLines(settingsRepo, diffLines);

    if (diffLines.length > 0) {
      lines.push("```diff");
      lines.push(...diffLines);
      lines.push("```");
      lines.push("");
    }
  }

  // Combined summary
  lines.push(`**${formatCombinedSummary(input)}**`);

  return lines.join("\n");
}

// =============================================================================
// File Writer
// =============================================================================

export function writeUnifiedSummary(input: UnifiedSummaryInput): void {
  const markdown = formatUnifiedSummaryMarkdown(input);
  if (!markdown) return;
  writeGitHubStepSummary(markdown, input.summaryPath);
}
