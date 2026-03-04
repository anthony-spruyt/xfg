// src/output/unified-summary.ts
import { appendFileSync } from "node:fs";
import type { LifecycleReport, LifecycleAction } from "./lifecycle-report.js";
import { hasLifecycleChanges } from "./lifecycle-report.js";
import type { SyncReport, RepoFileChanges } from "./sync-report.js";
import type { SettingsReport, RepoChanges } from "./settings-report.js";
import { renderRepoSettingsDiffLines } from "./settings-report.js";

// =============================================================================
// Types
// =============================================================================

interface UnifiedSummaryInput {
  lifecycle?: LifecycleReport;
  sync?: SyncReport;
  settings?: SettingsReport;
  dryRun: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Formats a summary entry like "3 files (1 to create, 2 to update)".
 * Returns null if total is 0.
 */
function formatCountSummary(
  noun: string,
  pluralNoun: string,
  counts: { label: string; dryLabel: string; value: number }[],
  dryRun: boolean
): string | null {
  const total = counts.reduce((sum, c) => sum + c.value, 0);
  if (total === 0) return null;

  const word = total === 1 ? noun : pluralNoun;
  const actions = counts
    .filter((c) => c.value > 0)
    .map((c) => `${c.value} ${dryRun ? c.dryLabel : c.label}`);
  return `${total} ${word} (${actions.join(", ")})`;
}

function formatCombinedSummary(input: UnifiedSummaryInput): string {
  const parts: string[] = [];
  const dry = input.dryRun;

  if (input.lifecycle) {
    const t = input.lifecycle.totals;
    const entry = formatCountSummary(
      "repo",
      "repos",
      [
        { label: "created", dryLabel: "to create", value: t.created },
        { label: "forked", dryLabel: "to fork", value: t.forked },
        { label: "migrated", dryLabel: "to migrate", value: t.migrated },
      ],
      dry
    );
    if (entry) parts.push(entry);
  }

  if (input.sync) {
    const t = input.sync.totals;
    const entry = formatCountSummary(
      "file",
      "files",
      [
        { label: "created", dryLabel: "to create", value: t.files.create },
        { label: "updated", dryLabel: "to update", value: t.files.update },
        { label: "deleted", dryLabel: "to delete", value: t.files.delete },
      ],
      dry
    );
    if (entry) parts.push(entry);
  }

  if (input.settings) {
    const t = input.settings.totals;

    const settingsEntry = formatCountSummary(
      "setting",
      "settings",
      [
        { label: "added", dryLabel: "to add", value: t.settings.add },
        { label: "changed", dryLabel: "to change", value: t.settings.change },
      ],
      dry
    );
    if (settingsEntry) parts.push(settingsEntry);

    const rulesetsEntry = formatCountSummary(
      "ruleset",
      "rulesets",
      [
        { label: "created", dryLabel: "to create", value: t.rulesets.create },
        { label: "updated", dryLabel: "to update", value: t.rulesets.update },
        { label: "deleted", dryLabel: "to delete", value: t.rulesets.delete },
      ],
      dry
    );
    if (rulesetsEntry) parts.push(rulesetsEntry);

    const labelsEntry = formatCountSummary(
      "label",
      "labels",
      [
        { label: "created", dryLabel: "to create", value: t.labels.create },
        { label: "updated", dryLabel: "to update", value: t.labels.update },
        { label: "deleted", dryLabel: "to delete", value: t.labels.delete },
      ],
      dry
    );
    if (labelsEntry) parts.push(labelsEntry);
  }

  if (parts.length === 0) {
    return "No changes";
  }

  const prefix = dry ? "Plan" : "Applied";
  return `${prefix}: ${parts.join(", ")}`;
}

function hasAnyChanges(input: UnifiedSummaryInput): boolean {
  if (input.lifecycle && hasLifecycleChanges(input.lifecycle)) return true;
  if (input.sync?.repos.some((r) => r.files.length > 0 || r.error)) return true;
  if (
    input.settings?.repos.some(
      (r) =>
        r.settings.length > 0 ||
        r.rulesets.length > 0 ||
        r.labels.length > 0 ||
        r.error
    )
  )
    return true;
  return false;
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

function renderSyncLines(syncRepo: RepoFileChanges, diffLines: string[]): void {
  for (const file of syncRepo.files) {
    if (file.action === "create") {
      diffLines.push(`+ ${file.path}`);
    } else if (file.action === "update") {
      diffLines.push(`! ${file.path}`);
    } else if (file.action === "delete") {
      diffLines.push(`- ${file.path}`);
    }
  }

  if (syncRepo.error) {
    diffLines.push(`- Error: ${syncRepo.error}`);
  }
}

function renderSettingsLines(
  settingsRepo: RepoChanges,
  diffLines: string[]
): void {
  renderRepoSettingsDiffLines(settingsRepo, diffLines);
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

  // Diff block
  const diffLines: string[] = [];

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

    diffLines.push(`@@ ${repoName} @@`);

    if (lcAction) renderLifecycleLines(lcAction, diffLines);
    if (syncRepo) renderSyncLines(syncRepo, diffLines);
    if (settingsRepo) renderSettingsLines(settingsRepo, diffLines);
  }

  if (diffLines.length > 0) {
    lines.push("```diff");
    lines.push(...diffLines);
    lines.push("```");
    lines.push("");
  }

  // Combined summary
  lines.push(`**${formatCombinedSummary(input)}**`);

  return lines.join("\n");
}

// =============================================================================
// File Writer
// =============================================================================

export function writeUnifiedSummary(input: UnifiedSummaryInput): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatUnifiedSummaryMarkdown(input);
  if (!markdown) return;

  appendFileSync(summaryPath, "\n" + markdown + "\n");
}
