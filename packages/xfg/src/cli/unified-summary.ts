import {
  STEP_SUMMARY_MAX_BYTES,
  summaryBytesLeft,
} from "../output/github-summary.js";
import {
  hasLifecycleChanges,
  writeGitHubStepSummary,
  renderSyncLines,
  renderRepoSettingsDiffLines,
  formatCountEntry,
  formatSettingsCountEntries,
  hasRepoSettingsChanges,
  type LifecycleReport,
  type LifecycleAction,
  type SyncReport,
  type SettingsReport,
  type RepoChanges,
} from "../output/index.js";
import { formatActionCountEntry } from "../shared/count-format.js";
import { appendDiffBlock } from "../shared/markdown-fence.js";
import { quoted } from "../shared/string-utils.js";

interface UnifiedSummaryInput {
  lifecycle?: LifecycleReport;
  sync?: SyncReport;
  settings?: SettingsReport;
  dryRun: boolean;
  summaryPath?: string | undefined;
}

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
    const entry = formatActionCountEntry(
      "file",
      "files",
      input.sync.totals.files,
      dry
    );
    if (entry) parts.push(entry);
  }

  if (input.settings) {
    parts.push(...formatSettingsCountEntries(input.settings.totals, dry));
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
  return input.settings?.repos.some(hasRepoSettingsChanges) ?? false;
}

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
      diffLines.push(
        `+   description: ${quoted(lcAction.settings.description)}`
      );
    }
  }
}

const CUT_NOTE = "... cut to fit GitHub's 1 MiB summary limit";
// Room kept for the "more repos not shown" line.
const NOTE_RESERVE_BYTES = 100;

function lineBytes(line: string): number {
  return Buffer.byteLength(line) + 1;
}

function totalBytes(lines: string[]): number {
  let total = 0;
  for (const line of lines) total += lineBytes(line);
  return total;
}

function cutToFit(diffLines: string[], room: number): string[] {
  const kept: string[] = [];
  let used = lineBytes(CUT_NOTE);
  for (const line of diffLines) {
    used += lineBytes(line);
    if (used > room) break;
    kept.push(line);
  }
  if (kept.length > 0) kept.push(CUT_NOTE);
  return kept;
}

export function formatUnifiedSummaryMarkdown(
  input: UnifiedSummaryInput,
  maxBytes: number = STEP_SUMMARY_MAX_BYTES
): string {
  if (!hasAnyChanges(input)) {
    return "";
  }

  const lines: string[] = [];

  const title = input.dryRun ? "## xfg Plan" : "## xfg Apply";
  lines.push(title);
  lines.push("");

  if (input.dryRun) {
    lines.push("> [!WARNING]");
    lines.push("> This was a dry run — no changes were applied");
    lines.push("");
  }

  const lifecycleByRepo = new Map(
    (input.lifecycle?.actions ?? []).map((a) => [a.repoName, a])
  );
  const syncByRepo = new Map(
    (input.sync?.repos ?? []).map((r) => [r.repoName, r])
  );
  // The same repo can appear more than once (e.g. listed twice in config); keep every entry.
  const settingsByRepo = new Map<string, RepoChanges[]>();
  for (const r of input.settings?.repos ?? []) {
    settingsByRepo.set(r.repoName, [
      ...(settingsByRepo.get(r.repoName) ?? []),
      r,
    ]);
  }

  const allRepos: string[] = [];
  const addRepo = (name: string) => {
    if (!allRepos.includes(name)) allRepos.push(name);
  };
  for (const a of input.lifecycle?.actions ?? []) addRepo(a.repoName);
  for (const r of input.sync?.repos ?? []) addRepo(r.repoName);
  for (const r of input.settings?.repos ?? []) addRepo(r.repoName);

  const footer = `**${formatCombinedSummary(input)}**`;
  let used = totalBytes(lines) + lineBytes(footer) + NOTE_RESERVE_BYTES;
  const blocks: { heading: string[]; diffLines: string[] }[] = [];

  for (const repoName of allRepos) {
    const lcAction = lifecycleByRepo.get(repoName);
    const syncRepo = syncByRepo.get(repoName);
    const settingsRepos = (settingsByRepo.get(repoName) ?? []).filter(
      hasRepoSettingsChanges
    );

    const hasLcChange = lcAction && lcAction.action !== "existed";
    const hasSyncChanges =
      syncRepo && (syncRepo.files.length > 0 || syncRepo.error);
    const repoHasSettingsChanges = settingsRepos.length > 0;

    if (!hasLcChange && !hasSyncChanges && !repoHasSettingsChanges) continue;

    const diffLines: string[] = [];

    if (lcAction) renderLifecycleLines(lcAction, diffLines);

    if (hasLcChange && hasSyncChanges) diffLines.push("");

    if (syncRepo) {
      for (const line of renderSyncLines(syncRepo)) diffLines.push(line);
    }

    if (hasSyncChanges && repoHasSettingsChanges) diffLines.push("");

    settingsRepos.forEach((settingsRepo, i) => {
      if (i > 0) diffLines.push("");
      renderRepoSettingsDiffLines(settingsRepo, diffLines);
    });

    blocks.push({ heading: [`### ${repoName}`, ""], diffLines });
  }

  for (let i = 0; i < blocks.length; i++) {
    const { heading, diffLines } = blocks[i];
    const block = [...heading];
    appendDiffBlock(block, diffLines);
    const blockBytes = totalBytes(block);

    if (used + blockBytes <= maxBytes) {
      for (const line of block) lines.push(line);
      used += blockBytes;
      continue;
    }

    const overhead = blockBytes - totalBytes(diffLines);
    const kept = cutToFit(diffLines, maxBytes - used - overhead);
    if (kept.length > 0) {
      for (const line of heading) lines.push(line);
      appendDiffBlock(lines, kept);
    }
    const hidden = blocks.length - i - (kept.length > 0 ? 1 : 0);
    if (hidden > 0) {
      lines.push(
        `_... ${hidden} more ${hidden === 1 ? "repo" : "repos"} not shown. See the job log._`,
        ""
      );
    }
    break;
  }

  lines.push(footer);

  return lines.join("\n");
}

export function writeUnifiedSummary(input: UnifiedSummaryInput): void {
  if (!input.summaryPath) return;
  const markdown = formatUnifiedSummaryMarkdown(
    input,
    summaryBytesLeft(input.summaryPath)
  );
  if (!markdown) return;
  writeGitHubStepSummary(markdown, input.summaryPath);
}
