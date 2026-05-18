import chalk from "chalk";
import type { RepoConfig } from "../config/index.js";
import type { RepoInfo, GitHubRepoInfo } from "../repo/index.js";
import { isGitHubRepo, getRepoDisplayName } from "../repo/index.js";
import { toErrorMessage } from "../shared/type-guards.js";

export interface BaseProcessorOptions {
  dryRun?: boolean;
  /** Pre-resolved auth token. Callers (e.g. sync-command) must resolve via resolveGitHubToken before passing. */
  token?: string;
}

export interface BaseProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  skipped?: boolean;
  dryRun?: boolean;
}

/**
 * Generic settings processor interface for dependency injection.
 * All three settings processors (rulesets, labels, repo-settings)
 * share this contract — specific interfaces extend it for type safety.
 */
export interface ISettingsProcessor<
  TOptions extends BaseProcessorOptions = BaseProcessorOptions,
  TResult extends BaseProcessorResult = BaseProcessorResult,
> {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: TOptions
  ): Promise<TResult>;
}

/**
 * Guards for GitHub settings processing — passed to withGitHubGuards.
 */
interface SettingsGuards<
  TOptions extends BaseProcessorOptions,
  TResult extends BaseProcessorResult,
> {
  hasDesiredSettings(repoConfig: RepoConfig): boolean;
  emptySettingsMessage: string;
  applySettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: TOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<TResult>;
}

/**
 * Build a base result that satisfies TResult for guard early-returns.
 * All TResult subtypes only extend BaseProcessorResult with optional fields,
 * so a base-only object is structurally valid. If adding a new processor
 * result type, ensure all extension fields are optional.
 */
function baseResult<TResult extends BaseProcessorResult>(
  result: BaseProcessorResult
): TResult {
  return result as TResult;
}

/**
 * Common boilerplate for GitHub settings processors: GitHub-only gating,
 * empty settings check, token resolution, and error wrapping.
 */
export async function withGitHubGuards<
  TOptions extends BaseProcessorOptions,
  TResult extends BaseProcessorResult,
>(
  repoConfig: RepoConfig,
  repoInfo: RepoInfo,
  options: TOptions,
  guards: SettingsGuards<TOptions, TResult>
): Promise<TResult> {
  const repoName = getRepoDisplayName(repoInfo);

  if (!isGitHubRepo(repoInfo)) {
    return baseResult<TResult>({
      success: true,
      repoName,
      message: `Skipped: ${repoName} is not a GitHub repository`,
      skipped: true,
    });
  }

  if (!guards.hasDesiredSettings(repoConfig)) {
    return baseResult<TResult>({
      success: true,
      repoName,
      message: guards.emptySettingsMessage,
      skipped: true,
    });
  }

  try {
    return await guards.applySettings(
      repoInfo as GitHubRepoInfo,
      repoConfig,
      options,
      options.token,
      repoName
    );
  } catch (error) {
    const message = toErrorMessage(error);
    return baseResult<TResult>({
      success: false,
      repoName,
      message: `Failed: ${message}`,
    });
  }
}

export type SettingsAction = "create" | "update" | "delete" | "unchanged";

export type ActiveAction = Exclude<SettingsAction, "unchanged">;

export function isActiveAction<T extends { action: SettingsAction }>(
  entry: T
): entry is T & { action: ActiveAction } {
  return entry.action !== "unchanged";
}

export interface ChangeCounts {
  create: number;
  update: number;
  delete: number;
  unchanged: number;
}

export function countActions(
  changes: ReadonlyArray<{ action: SettingsAction }>
): ChangeCounts {
  const counts: ChangeCounts = {
    create: 0,
    update: 0,
    delete: 0,
    unchanged: 0,
  };
  for (const c of changes) {
    counts[c.action]++;
  }
  return counts;
}

export function formatChangeSummary(counts: ChangeCounts): string {
  const parts: string[] = [];
  if (counts.create > 0) parts.push(`${counts.create} created`);
  if (counts.update > 0) parts.push(`${counts.update} updated`);
  if (counts.delete > 0) parts.push(`${counts.delete} deleted`);
  if (counts.unchanged > 0) parts.push(`${counts.unchanged} unchanged`);
  return parts.length > 0 ? parts.join(", ") : "no changes";
}

/**
 * Generate a summary line for a settings plan (e.g. "Plan: 3 labels (1 to create, 2 to update)").
 * Returns undefined when there are no actionable changes (total === 0).
 */
export function formatPlanSummary(
  entityName: string,
  creates: number,
  updates: number,
  deletes: number
): string | undefined {
  const total = creates + updates + deletes;
  if (total === 0) return undefined;

  const parts: string[] = [];
  if (creates > 0) parts.push(`${creates} to create`);
  if (updates > 0) parts.push(`${updates} to update`);
  if (deletes > 0) parts.push(`${deletes} to delete`);
  return `  Plan: ${total} ${entityName} (${parts.join(", ")})`;
}

export interface PlanEntry {
  property: string;
  action: "create" | "update";
  oldValue?: unknown;
  newValue?: unknown;
}

export interface FormatChangeResult {
  lines: string[];
  entries: PlanEntry[];
  creates: number;
  updates: number;
}

export function formatChangeLines(
  changes: ReadonlyArray<{
    property: string;
    action: SettingsAction;
    oldValue?: unknown;
    newValue?: unknown;
  }>,
  formatValue: (val: unknown) => string
): FormatChangeResult {
  const lines: string[] = [];
  const entries: PlanEntry[] = [];
  const { create: creates, update: updates } = countActions(changes);

  for (const change of changes) {
    if (change.action === "create") {
      lines.push(
        chalk.green(`    + ${change.property}: ${formatValue(change.newValue)}`)
      );
      entries.push({
        property: change.property,
        action: "create",
        newValue: change.newValue,
      });
    } else if (change.action === "update") {
      lines.push(
        chalk.yellow(
          `    ~ ${change.property}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`
        )
      );
      entries.push({
        property: change.property,
        action: "update",
        oldValue: change.oldValue,
        newValue: change.newValue,
      });
    }
  }

  return { lines, entries, creates, updates };
}

/**
 * Build a standardized dry-run result for settings processors.
 * Returns an intersection of BaseProcessorResult with the extra fields,
 * which is assignable to any result subtype whose extra fields are provided.
 */
export function buildDryRunResult<
  E extends Record<string, unknown> = Record<string, never>,
>(
  repoName: string,
  changeCounts: ChangeCounts,
  extra?: E
): BaseProcessorResult & { changes: ChangeCounts; dryRun: true } & E {
  const summary = formatChangeSummary(changeCounts);
  const base = {
    success: true as const,
    repoName,
    message: `[DRY RUN] ${summary}`,
    dryRun: true as const,
    changes: changeCounts,
  };
  return Object.assign(base, extra) as typeof base & E;
}

/**
 * Build a standardized apply result for settings processors.
 * Returns an intersection of BaseProcessorResult with the extra fields,
 * which is assignable to any result subtype whose extra fields are provided.
 */
export function buildApplyResult<
  E extends Record<string, unknown> = Record<string, never>,
>(
  repoName: string,
  changeCounts: ChangeCounts,
  appliedCount: number,
  extra?: E
): BaseProcessorResult & { changes: ChangeCounts } & E {
  const summary = formatChangeSummary(changeCounts);
  const base = {
    success: true as const,
    repoName,
    message: appliedCount > 0 ? `Applied: ${summary}` : "No changes needed",
    changes: changeCounts,
  };
  return Object.assign(base, extra) as typeof base & E;
}
