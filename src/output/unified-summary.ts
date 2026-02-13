// src/output/unified-summary.ts
import { appendFileSync } from "node:fs";
import type { LifecycleReport, LifecycleAction } from "./lifecycle-report.js";
import { hasLifecycleChanges } from "./lifecycle-report.js";
import type { SyncReport, RepoFileChanges } from "./sync-report.js";
import type { SettingsReport, RepoChanges } from "./settings-report.js";
import {
  formatValuePlain,
  formatRulesetConfigPlain,
} from "./settings-report.js";

// =============================================================================
// Types
// =============================================================================

export interface UnifiedSummaryInput {
  lifecycle?: LifecycleReport;
  sync?: SyncReport;
  settings?: SettingsReport;
  dryRun: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

function formatCombinedSummary(input: UnifiedSummaryInput): string {
  const parts: string[] = [];
  const dry = input.dryRun;

  // Lifecycle totals
  if (input.lifecycle) {
    const t = input.lifecycle.totals;
    const repoTotal = t.created + t.forked + t.migrated;
    if (repoTotal > 0) {
      const repoParts: string[] = [];
      if (t.created > 0)
        repoParts.push(`${t.created} ${dry ? "to create" : "created"}`);
      if (t.forked > 0)
        repoParts.push(`${t.forked} ${dry ? "to fork" : "forked"}`);
      if (t.migrated > 0)
        repoParts.push(`${t.migrated} ${dry ? "to migrate" : "migrated"}`);
      const repoWord = repoTotal === 1 ? "repo" : "repos";
      parts.push(`${repoTotal} ${repoWord} (${repoParts.join(", ")})`);
    }
  }

  // Sync totals
  if (input.sync) {
    const t = input.sync.totals;
    const fileTotal = t.files.create + t.files.update + t.files.delete;
    if (fileTotal > 0) {
      const fileParts: string[] = [];
      if (t.files.create > 0)
        fileParts.push(`${t.files.create} ${dry ? "to create" : "created"}`);
      if (t.files.update > 0)
        fileParts.push(`${t.files.update} ${dry ? "to update" : "updated"}`);
      if (t.files.delete > 0)
        fileParts.push(`${t.files.delete} ${dry ? "to delete" : "deleted"}`);
      const fileWord = fileTotal === 1 ? "file" : "files";
      parts.push(`${fileTotal} ${fileWord} (${fileParts.join(", ")})`);
    }
  }

  // Settings totals
  if (input.settings) {
    const t = input.settings.totals;
    const settingsTotal = t.settings.add + t.settings.change;
    if (settingsTotal > 0) {
      const settingWord = settingsTotal === 1 ? "setting" : "settings";
      const actions: string[] = [];
      if (t.settings.add > 0)
        actions.push(`${t.settings.add} ${dry ? "to add" : "added"}`);
      if (t.settings.change > 0)
        actions.push(`${t.settings.change} ${dry ? "to change" : "changed"}`);
      parts.push(`${settingsTotal} ${settingWord} (${actions.join(", ")})`);
    }

    const rulesetsTotal =
      t.rulesets.create + t.rulesets.update + t.rulesets.delete;
    if (rulesetsTotal > 0) {
      const rulesetWord = rulesetsTotal === 1 ? "ruleset" : "rulesets";
      const actions: string[] = [];
      if (t.rulesets.create > 0)
        actions.push(`${t.rulesets.create} ${dry ? "to create" : "created"}`);
      if (t.rulesets.update > 0)
        actions.push(`${t.rulesets.update} ${dry ? "to update" : "updated"}`);
      if (t.rulesets.delete > 0)
        actions.push(`${t.rulesets.delete} ${dry ? "to delete" : "deleted"}`);
      parts.push(`${rulesetsTotal} ${rulesetWord} (${actions.join(", ")})`);
    }
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
      (r) => r.settings.length > 0 || r.rulesets.length > 0 || r.error
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
  for (const setting of settingsRepo.settings) {
    if (setting.oldValue === undefined && setting.newValue === undefined) {
      continue;
    }
    if (setting.action === "add") {
      diffLines.push(
        `+ ${setting.name}: ${formatValuePlain(setting.newValue)}`
      );
    } else {
      diffLines.push(
        `! ${setting.name}: ${formatValuePlain(setting.oldValue)} → ${formatValuePlain(setting.newValue)}`
      );
    }
  }

  for (const ruleset of settingsRepo.rulesets) {
    if (ruleset.action === "create") {
      diffLines.push(`+ ruleset "${ruleset.name}"`);
      if (ruleset.config) {
        diffLines.push(...formatRulesetConfigPlain(ruleset.config));
      }
    } else if (ruleset.action === "update") {
      diffLines.push(`! ruleset "${ruleset.name}"`);
      if (ruleset.propertyDiffs && ruleset.propertyDiffs.length > 0) {
        for (const diff of ruleset.propertyDiffs) {
          const path = diff.path.join(".");
          if (diff.action === "add") {
            diffLines.push(`+   ${path}: ${formatValuePlain(diff.newValue)}`);
          } else if (diff.action === "change") {
            diffLines.push(
              `!   ${path}: ${formatValuePlain(diff.oldValue)} → ${formatValuePlain(diff.newValue)}`
            );
          } else if (diff.action === "remove") {
            diffLines.push(`-   ${path}`);
          }
        }
      }
    } else if (ruleset.action === "delete") {
      diffLines.push(`- ruleset "${ruleset.name}"`);
    }
  }

  if (settingsRepo.error) {
    diffLines.push(`- Error: ${settingsRepo.error}`);
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
