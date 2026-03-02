import type { RepoConfig } from "../../config/index.js";
import type { RepoInfo, GitHubRepoInfo } from "../../shared/repo-detector.js";
import {
  isGitHubRepo,
  getRepoDisplayName,
} from "../../shared/repo-detector.js";
import { GitHubLabelsStrategy } from "./github-labels-strategy.js";
import { diffLabels } from "./diff.js";
import { formatLabelsPlan, type LabelsPlanResult } from "./formatter.js";
import { labelConfigToPayload } from "./converter.js";
import { hasGitHubAppCredentials } from "../../vcs/index.js";
import { GitHubAppTokenManager } from "../../vcs/github-app-token-manager.js";
import type { ILabelsStrategy } from "./types.js";

// =============================================================================
// Interfaces
// =============================================================================

export interface ILabelsProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: LabelsProcessorOptions
  ): Promise<LabelsProcessorResult>;
}

// =============================================================================
// Types
// =============================================================================

export interface LabelsProcessorOptions {
  configId: string;
  dryRun?: boolean;
  noDelete?: boolean;
  token?: string;
}

export interface LabelsProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  skipped?: boolean;
  dryRun?: boolean;
  changes?: {
    create: number;
    update: number;
    delete: number;
    unchanged: number;
  };
  planOutput?: LabelsPlanResult;
}

// =============================================================================
// Processor Implementation
// =============================================================================

/**
 * Processes label configuration for a repository.
 * Handles create/update/delete operations via GitHub Labels API.
 */
export class LabelsProcessor implements ILabelsProcessor {
  private readonly strategy: ILabelsStrategy;
  private readonly tokenManager: GitHubAppTokenManager | null;

  constructor(strategy?: ILabelsStrategy) {
    this.strategy = strategy ?? new GitHubLabelsStrategy();

    if (hasGitHubAppCredentials()) {
      this.tokenManager = new GitHubAppTokenManager(
        process.env.XFG_GITHUB_APP_ID!,
        process.env.XFG_GITHUB_APP_PRIVATE_KEY!
      );
    } else {
      this.tokenManager = null;
    }
  }

  /**
   * Process labels for a single repository.
   */
  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: LabelsProcessorOptions
  ): Promise<LabelsProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);
    const { dryRun, noDelete, token } = options;

    // Check if this is a GitHub repo
    if (!isGitHubRepo(repoInfo)) {
      return {
        success: true,
        repoName,
        message: `Skipped: ${repoName} is not a GitHub repository`,
        skipped: true,
      };
    }

    const githubRepo = repoInfo as GitHubRepoInfo;
    const settings = repoConfig.settings;
    const desiredLabels = settings?.labels ?? {};
    const deleteOrphaned = settings?.deleteOrphaned ?? false;

    // If no labels configured, skip
    if (Object.keys(desiredLabels).length === 0) {
      return {
        success: true,
        repoName,
        message: "No labels configured",
        skipped: true,
      };
    }

    try {
      // Resolve App token if available, fall back to provided token
      const effectiveToken =
        token ?? (await this.getInstallationToken(githubRepo));
      const strategyOptions = { token: effectiveToken, host: githubRepo.host };
      const currentLabels = await this.strategy.list(
        githubRepo,
        strategyOptions
      );

      // Compute diff
      const changes = diffLabels(
        currentLabels,
        desiredLabels,
        deleteOrphaned,
        noDelete ?? false
      );

      // Count changes by type
      const changeCounts = {
        create: changes.filter((c) => c.action === "create").length,
        update: changes.filter((c) => c.action === "update").length,
        delete: changes.filter((c) => c.action === "delete").length,
        unchanged: changes.filter((c) => c.action === "unchanged").length,
      };

      const planOutput = formatLabelsPlan(changes);

      // Dry run mode - report planned changes without applying
      if (dryRun) {
        const summary = this.formatChangeSummary(changeCounts);
        return {
          success: true,
          repoName,
          message: `[DRY RUN] ${summary}`,
          dryRun: true,
          changes: changeCounts,
          planOutput,
        };
      }

      // Apply changes (diff is already sorted: delete, update, create, unchanged)
      let appliedCount = 0;

      for (const change of changes) {
        switch (change.action) {
          case "create":
            if (change.desired) {
              const payload = labelConfigToPayload(change.name, change.desired);
              await this.strategy.create(
                githubRepo,
                {
                  name: payload.name,
                  color: payload.color,
                  ...(payload.description !== undefined
                    ? { description: payload.description }
                    : {}),
                },
                strategyOptions
              );
              appliedCount++;
            }
            break;

          case "update":
            if (change.desired) {
              const updatePayload: {
                new_name?: string;
                color?: string;
                description?: string;
              } = {};
              for (const prop of change.propertyChanges ?? []) {
                if (prop.property === "color") {
                  updatePayload.color = prop.newValue;
                } else if (prop.property === "description") {
                  updatePayload.description = prop.newValue;
                } else if (prop.property === "new_name") {
                  updatePayload.new_name = prop.newValue;
                }
              }
              await this.strategy.update(
                githubRepo,
                change.name,
                updatePayload,
                strategyOptions
              );
              appliedCount++;
            }
            break;

          case "delete":
            if (!noDelete && deleteOrphaned) {
              await this.strategy.delete(
                githubRepo,
                change.name,
                strategyOptions
              );
              appliedCount++;
            }
            break;

          case "unchanged":
            // No action needed
            break;
        }
      }

      const summary = this.formatChangeSummary(changeCounts);
      return {
        success: true,
        repoName,
        message: appliedCount > 0 ? `Applied: ${summary}` : "No changes needed",
        changes: changeCounts,
        planOutput,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        repoName,
        message: `Failed: ${message}`,
      };
    }
  }

  /**
   * Format change counts into a summary string.
   */
  private formatChangeSummary(counts: {
    create: number;
    update: number;
    delete: number;
    unchanged: number;
  }): string {
    const parts: string[] = [];
    if (counts.create > 0) parts.push(`${counts.create} created`);
    if (counts.update > 0) parts.push(`${counts.update} updated`);
    if (counts.delete > 0) parts.push(`${counts.delete} deleted`);
    if (counts.unchanged > 0) parts.push(`${counts.unchanged} unchanged`);
    return parts.length > 0 ? parts.join(", ") : "no changes";
  }

  /**
   * Resolves a GitHub App installation token for the given repo.
   */
  private async getInstallationToken(
    repoInfo: GitHubRepoInfo
  ): Promise<string | undefined> {
    if (!this.tokenManager) {
      return undefined;
    }

    try {
      const token = await this.tokenManager.getTokenForRepo(repoInfo);
      return token ?? undefined;
    } catch {
      return undefined;
    }
  }
}
