// src/output/unified-summary.ts
import { appendFileSync } from "node:fs";
import type { LifecycleReport } from "./lifecycle-report.js";
import { hasLifecycleChanges } from "./lifecycle-report.js";
import type { SyncReport } from "./sync-report.js";

// =============================================================================
// Helpers
// =============================================================================

function formatCombinedSummary(
  lifecycleTotals: LifecycleReport["totals"],
  syncTotals: SyncReport["totals"]
): string {
  const parts: string[] = [];

  // Lifecycle totals
  const repoTotal =
    lifecycleTotals.created + lifecycleTotals.forked + lifecycleTotals.migrated;
  if (repoTotal > 0) {
    const repoParts: string[] = [];
    if (lifecycleTotals.created > 0)
      repoParts.push(`${lifecycleTotals.created} to create`);
    if (lifecycleTotals.forked > 0)
      repoParts.push(`${lifecycleTotals.forked} to fork`);
    if (lifecycleTotals.migrated > 0)
      repoParts.push(`${lifecycleTotals.migrated} to migrate`);
    const repoWord = repoTotal === 1 ? "repo" : "repos";
    parts.push(`${repoTotal} ${repoWord} (${repoParts.join(", ")})`);
  }

  // Sync totals
  const fileTotal =
    syncTotals.files.create + syncTotals.files.update + syncTotals.files.delete;
  if (fileTotal > 0) {
    const fileParts: string[] = [];
    if (syncTotals.files.create > 0)
      fileParts.push(`${syncTotals.files.create} to create`);
    if (syncTotals.files.update > 0)
      fileParts.push(`${syncTotals.files.update} to update`);
    if (syncTotals.files.delete > 0)
      fileParts.push(`${syncTotals.files.delete} to delete`);
    const fileWord = fileTotal === 1 ? "file" : "files";
    parts.push(`${fileTotal} ${fileWord} (${fileParts.join(", ")})`);
  }

  if (parts.length === 0) {
    return "No changes";
  }

  return `Plan: ${parts.join(", ")}`;
}

// =============================================================================
// Markdown Formatter
// =============================================================================

export function formatUnifiedSummaryMarkdown(
  lifecycle: LifecycleReport,
  sync: SyncReport,
  dryRun: boolean
): string {
  const hasLifecycle = hasLifecycleChanges(lifecycle);
  const hasSync = sync.repos.some((r) => r.files.length > 0 || r.error);

  if (!hasLifecycle && !hasSync) {
    return "";
  }

  const lines: string[] = [];

  // Title
  const titleSuffix = dryRun ? " (Dry Run)" : "";
  lines.push(`## xfg Sync Summary${titleSuffix}`);
  lines.push("");

  // Dry-run warning
  if (dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  // Build lookup maps by repoName
  const lifecycleByRepo = new Map(
    lifecycle.actions.map((a) => [a.repoName, a])
  );
  const syncByRepo = new Map(sync.repos.map((r) => [r.repoName, r]));

  // Collect all repo names in order (lifecycle first, then sync-only)
  const allRepos: string[] = [];
  for (const action of lifecycle.actions) {
    if (!allRepos.includes(action.repoName)) {
      allRepos.push(action.repoName);
    }
  }
  for (const repo of sync.repos) {
    if (!allRepos.includes(repo.repoName)) {
      allRepos.push(repo.repoName);
    }
  }

  // Diff block
  const diffLines: string[] = [];

  for (const repoName of allRepos) {
    const lcAction = lifecycleByRepo.get(repoName);
    const syncRepo = syncByRepo.get(repoName);

    const hasLcChange = lcAction && lcAction.action !== "existed";
    const hasSyncChanges =
      syncRepo && (syncRepo.files.length > 0 || syncRepo.error);

    if (!hasLcChange && !hasSyncChanges) continue;

    // Repo header
    diffLines.push(`@@ ${repoName} @@`);

    // Lifecycle action
    if (lcAction && lcAction.action !== "existed") {
      switch (lcAction.action) {
        case "created":
          diffLines.push(`+ CREATE`);
          break;
        case "forked":
          diffLines.push(
            `+ FORK ${lcAction.upstream ?? "upstream"} -> ${repoName}`
          );
          break;
        case "migrated":
          diffLines.push(
            `+ MIGRATE ${lcAction.source ?? "source"} -> ${repoName}`
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

    // File changes
    if (syncRepo) {
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
  }

  if (diffLines.length > 0) {
    lines.push("```diff");
    lines.push(...diffLines);
    lines.push("```");
    lines.push("");
  }

  // Combined summary
  lines.push(`**${formatCombinedSummary(lifecycle.totals, sync.totals)}**`);

  return lines.join("\n");
}

// =============================================================================
// File Writer
// =============================================================================

export function writeUnifiedSummary(
  lifecycle: LifecycleReport,
  sync: SyncReport,
  dryRun: boolean
): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const markdown = formatUnifiedSummaryMarkdown(lifecycle, sync, dryRun);
  if (!markdown) return;

  appendFileSync(summaryPath, "\n" + markdown + "\n");
}
