import type { RepoConfig } from "../config/index.js";
import type { RepoInfo, GitHubRepoInfo } from "../shared/repo-detector.js";
import { isGitHubRepo, getRepoDisplayName } from "../shared/repo-detector.js";
import { createTokenManager } from "../vcs/index.js";
import { GitHubAppTokenManager } from "../vcs/github-app-token-manager.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { logger } from "../shared/logger.js";

export interface BaseProcessorOptions {
  dryRun?: boolean;
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
 * Shared base class for GitHub settings processors (labels, rulesets, repo settings).
 * Handles common boilerplate: GitHub-only gating, empty settings check,
 * token resolution, and error wrapping.
 */
export abstract class BaseSettingsProcessor<
  TOptions extends BaseProcessorOptions,
  TResult extends BaseProcessorResult,
> {
  protected readonly tokenManager: GitHubAppTokenManager | null;

  constructor(tokenManager?: GitHubAppTokenManager | null) {
    this.tokenManager = tokenManager ?? createTokenManager();
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: TOptions
  ): Promise<TResult> {
    const repoName = getRepoDisplayName(repoInfo);

    // GitHub-only gating
    if (!isGitHubRepo(repoInfo)) {
      return this.createSkipResult(
        repoName,
        `Skipped: ${repoName} is not a GitHub repository`
      );
    }

    const githubRepo = repoInfo as GitHubRepoInfo;

    // Empty settings check
    if (!this.hasDesiredSettings(repoConfig)) {
      return this.createSkipResult(repoName, this.getEmptySettingsMessage());
    }

    try {
      // Resolve App token if available, fall back to provided token
      const effectiveToken =
        options.token ?? (await this.getInstallationToken(githubRepo));

      return await this.processSettings(
        githubRepo,
        repoConfig,
        options,
        effectiveToken,
        repoName
      );
    } catch (error) {
      const message = toErrorMessage(error);
      return this.createErrorResult(repoName, `Failed: ${message}`);
    }
  }

  /**
   * Check whether the repo config contains any settings for this processor.
   */
  protected abstract hasDesiredSettings(repoConfig: RepoConfig): boolean;

  /**
   * Message to return when no settings are configured.
   */
  protected abstract getEmptySettingsMessage(): string;

  /**
   * Execute the processor-specific business logic.
   * Called after GitHub-only gating, empty settings check, and token resolution.
   */
  protected abstract processSettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: TOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<TResult>;

  /**
   * Create a skip result for this processor type.
   */
  protected abstract createSkipResult(
    repoName: string,
    message: string
  ): TResult;

  /**
   * Create an error result for this processor type.
   */
  protected abstract createErrorResult(
    repoName: string,
    message: string
  ): TResult;

  /**
   * Resolves a GitHub App installation token for the given repo.
   */
  protected async getInstallationToken(
    repoInfo: GitHubRepoInfo
  ): Promise<string | undefined> {
    if (!this.tokenManager) {
      return undefined;
    }

    try {
      const token = await this.tokenManager.getTokenForRepo(repoInfo);
      return token ?? undefined;
    } catch (error) {
      // App token resolution is optional — fall back to provided token
      logger.debug(
        `App token resolution failed for ${repoInfo.owner}/${repoInfo.repo}: ${toErrorMessage(error)}`
      );
      return undefined;
    }
  }
}

export interface ChangeCounts {
  create: number;
  update: number;
  delete: number;
  unchanged: number;
}

/**
 * Count actions from a diff result array.
 * Works with any change type that has an `action` field.
 */
export function countActions(
  changes: ReadonlyArray<{ action: string }>
): ChangeCounts {
  return {
    create: changes.filter((c) => c.action === "create").length,
    update: changes.filter((c) => c.action === "update").length,
    delete: changes.filter((c) => c.action === "delete").length,
    unchanged: changes.filter((c) => c.action === "unchanged").length,
  };
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
