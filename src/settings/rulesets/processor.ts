import type { RepoConfig, Ruleset } from "../../config/index.js";
import type { GitHubRepoInfo, RepoInfo } from "../../shared/repo-detector.js";
import type { IRulesetStrategy, GitHubRuleset } from "./types.js";
import { diffRulesets } from "./diff.js";
import { formatRulesetPlan, RulesetPlanResult } from "./formatter.js";
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

export type IRulesetProcessor = ISettingsProcessor<
  RulesetProcessorOptions,
  RulesetProcessorResult
>;

export interface RulesetProcessorOptions extends BaseProcessorOptions {
  noDelete?: boolean;
}

export interface RulesetProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: RulesetPlanResult;
}

/**
 * Processes ruleset configuration for a repository.
 * Handles create/update/delete operations via GitHub Rulesets API.
 */
export class RulesetProcessor implements IRulesetProcessor {
  private readonly strategy: IRulesetStrategy;

  constructor(strategy: IRulesetStrategy) {
    this.strategy = strategy;
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RulesetProcessorOptions
  ): Promise<RulesetProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) =>
        Object.keys(rc.settings?.rulesets ?? {}).length > 0,
      emptySettingsMessage: "No rulesets configured",
      processSettings: (githubRepo, rc, opts, token, repoName) =>
        this.processSettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async processSettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: RulesetProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<RulesetProcessorResult> {
    const { dryRun, noDelete } = options;
    const settings = repoConfig.settings;
    const desiredRulesets = settings?.rulesets ?? {};
    const deleteOrphaned = settings?.deleteOrphaned ?? false;

    const strategyOptions = { token: effectiveToken, host: githubRepo.host };
    const currentRulesets = await this.strategy.list(
      githubRepo,
      strategyOptions
    );

    const desiredMap = new Map<string, Ruleset>(
      Object.entries(desiredRulesets)
    );

    // Hydrate rulesets that match desired names with full details from get()
    // The list endpoint only returns summary fields (id, name, target, enforcement)
    // but not rules, conditions, or bypass_actors needed for accurate diffing
    const fullRulesets: GitHubRuleset[] = [];
    for (const summary of currentRulesets) {
      if (desiredMap.has(summary.name)) {
        const full = await this.strategy.get(
          githubRepo,
          summary.id,
          strategyOptions
        );
        fullRulesets.push(full);
      } else {
        fullRulesets.push(summary);
      }
    }

    const changes = diffRulesets(fullRulesets, desiredMap, deleteOrphaned);

    const changeCounts = countActions(changes);

    const planOutput = formatRulesetPlan(changes);

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts, { planOutput });
    }

    // Apply changes
    let appliedCount = 0;

    for (const change of changes) {
      switch (change.action) {
        case "create":
          if (change.desired) {
            await this.strategy.create(
              githubRepo,
              change.name,
              change.desired,
              strategyOptions
            );
            appliedCount++;
          }
          break;

        case "update":
          if (change.rulesetId !== undefined && change.desired) {
            await this.strategy.update(
              githubRepo,
              change.rulesetId,
              change.name,
              change.desired,
              strategyOptions
            );
            appliedCount++;
          }
          break;

        case "delete":
          // Check if deletion is allowed
          if (!noDelete && deleteOrphaned && change.rulesetId !== undefined) {
            await this.strategy.delete(
              githubRepo,
              change.rulesetId,
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
