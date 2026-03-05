import type { RepoConfig } from "../../config/index.js";
import type { GitHubRepoInfo, RepoInfo } from "../../shared/repo-detector.js";
import { GitHubLabelsStrategy } from "./github-labels-strategy.js";
import { diffLabels } from "./diff.js";
import { formatLabelsPlan, type LabelsPlanResult } from "./formatter.js";
import { labelConfigToPayload } from "./converter.js";
import type { ILabelsStrategy } from "./types.js";
import {
  withGitHubGuards,
  type BaseProcessorOptions,
  type BaseProcessorResult,
  type ISettingsProcessor,
  type ChangeCounts,
  countActions,
  buildDryRunResult,
  buildApplyResult,
} from "../base-processor.js";

export type ILabelsProcessor = ISettingsProcessor<
  LabelsProcessorOptions,
  LabelsProcessorResult
>;

export interface LabelsProcessorOptions extends BaseProcessorOptions {
  noDelete?: boolean;
}

export interface LabelsProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: LabelsPlanResult;
}

/**
 * Processes label configuration for a repository.
 * Handles create/update/delete operations via GitHub Labels API.
 */
export class LabelsProcessor implements ILabelsProcessor {
  private readonly strategy: ILabelsStrategy;

  constructor(strategy?: ILabelsStrategy) {
    this.strategy = strategy ?? new GitHubLabelsStrategy();
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: LabelsProcessorOptions
  ): Promise<LabelsProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) =>
        Object.keys(rc.settings?.labels ?? {}).length > 0,
      emptySettingsMessage: "No labels configured",
      processSettings: (githubRepo, rc, opts, token, repoName) =>
        this.processSettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async processSettings(
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

    const changeCounts = countActions(changes);

    const planOutput = formatLabelsPlan(changes);

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts, { planOutput });
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

    return buildApplyResult(repoName, changeCounts, appliedCount, {
      planOutput,
    });
  }
}
