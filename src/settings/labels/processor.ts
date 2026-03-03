import type { RepoConfig } from "../../config/index.js";
import type { GitHubRepoInfo } from "../../shared/repo-detector.js";
import { GitHubLabelsStrategy } from "./github-labels-strategy.js";
import { diffLabels } from "./diff.js";
import { formatLabelsPlan, type LabelsPlanResult } from "./formatter.js";
import { labelConfigToPayload } from "./converter.js";
import type { ILabelsStrategy } from "./types.js";
import {
  BaseSettingsProcessor,
  type BaseProcessorOptions,
} from "../base-processor.js";

// =============================================================================
// Interfaces
// =============================================================================

export interface ILabelsProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: import("../../shared/repo-detector.js").RepoInfo,
    options: LabelsProcessorOptions
  ): Promise<LabelsProcessorResult>;
}

// =============================================================================
// Types
// =============================================================================

export interface LabelsProcessorOptions extends BaseProcessorOptions {
  noDelete?: boolean;
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
export class LabelsProcessor
  extends BaseSettingsProcessor<LabelsProcessorOptions, LabelsProcessorResult>
  implements ILabelsProcessor
{
  private readonly strategy: ILabelsStrategy;

  constructor(strategy?: ILabelsStrategy) {
    super();
    this.strategy = strategy ?? new GitHubLabelsStrategy();
  }

  protected hasDesiredSettings(repoConfig: RepoConfig): boolean {
    const desiredLabels = repoConfig.settings?.labels ?? {};
    return Object.keys(desiredLabels).length > 0;
  }

  protected getEmptySettingsMessage(): string {
    return "No labels configured";
  }

  protected createSkipResult(
    repoName: string,
    message: string
  ): LabelsProcessorResult {
    return { success: true, repoName, message, skipped: true };
  }

  protected createErrorResult(
    repoName: string,
    message: string
  ): LabelsProcessorResult {
    return { success: false, repoName, message };
  }

  protected async processSettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: LabelsProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<LabelsProcessorResult> {
    const { dryRun, noDelete } = options;
    const settings = repoConfig.settings;
    const desiredLabels = settings?.labels ?? {};
    const deleteOrphaned = settings?.deleteOrphaned ?? false;

    const strategyOptions = { token: effectiveToken, host: githubRepo.host };
    const currentLabels = await this.strategy.list(githubRepo, strategyOptions);

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
  }
}
