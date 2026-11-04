import type { ActionsSettings, RepoConfig } from "../../config/index.js";
import type { GitHubRepoInfo, RepoInfo } from "../../repo/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";
import { runSequentially } from "../../shared/sequential.js";
import type { IActionsStrategy } from "./types.js";
import {
  ACTIONS_ENDPOINTS,
  buildPayload,
  readEndpoint,
  type ActionsEndpoint,
} from "./endpoints.js";
import { resolveActionsSettings, resolveForCurrentState } from "./resolve.js";
import { diffActions, hasActionsChanges, type ActionsChange } from "./diff.js";
import { formatActionsPlan, type ActionsPlanResult } from "./formatter.js";
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

export type IActionsProcessor = ISettingsProcessor<
  ActionsProcessorOptions,
  ActionsProcessorResult
>;

export type ActionsProcessorOptions = BaseProcessorOptions;

export interface ActionsProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: ActionsPlanResult;
  warnings?: string[];
}

function withWarnings<T extends object>(
  result: T,
  warnings: string[]
): T & { warnings?: string[] } {
  return warnings.length > 0 ? { ...result, warnings } : result;
}

function touches(endpoint: ActionsEndpoint, settings: ActionsSettings) {
  return endpoint.fields.some(({ setting }) => settings[setting] !== undefined);
}

function changed(endpoint: ActionsEndpoint, changes: ActionsChange[]) {
  return changes.some(
    (c) =>
      c.action !== "unchanged" &&
      endpoint.fields.some(({ setting }) => setting === c.property)
  );
}

export class ActionsProcessor implements IActionsProcessor {
  private readonly strategy: IActionsStrategy;

  constructor(strategy: IActionsStrategy) {
    this.strategy = strategy;
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ActionsProcessorOptions
  ): Promise<ActionsProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) => {
        const actions = rc.settings?.actions;
        return !!actions && Object.keys(actions).length > 0;
      },
      emptySettingsMessage: "No Actions settings configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async applySettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: ActionsProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<ActionsProcessorResult> {
    const configured = repoConfig.settings?.actions;
    if (!configured) {
      throw new Error("applySettings called without actions settings");
    }

    const resolved = resolveActionsSettings(configured);
    const strategyOptions: GhApiOptions = {
      token: effectiveToken,
      host: githubRepo.host,
    };
    const current = await this.readCurrent(
      githubRepo,
      resolved.settings,
      strategyOptions
    );

    const settled = resolveForCurrentState(resolved.settings, current);
    const desired = settled.settings;
    const warnings = [...resolved.warnings, ...settled.warnings].map(
      (w) => `${repoName}: ${w}`
    );

    const endpoints = ACTIONS_ENDPOINTS.filter((e) => touches(e, desired));
    if (endpoints.length === 0) {
      return withWarnings(
        {
          success: true,
          repoName,
          message: "No Actions settings to apply",
          skipped: true,
        },
        warnings
      );
    }

    const changes = diffActions(current, desired);
    const changeCounts = countActions(changes);

    if (!hasActionsChanges(changes)) {
      return withWarnings(
        {
          success: true,
          repoName,
          message: "No changes needed",
          changes: changeCounts,
        },
        warnings
      );
    }

    const planOutput = formatActionsPlan(changes);

    if (options.dryRun) {
      return withWarnings(
        buildDryRunResult(repoName, changeCounts, { planOutput }),
        warnings
      );
    }

    // Serial: GitHub asks for serial requests to avoid secondary rate limits
    await runSequentially(
      endpoints.filter((e) => changed(e, changes)),
      (endpoint) =>
        this.strategy.update(
          githubRepo,
          endpoint.name,
          buildPayload(endpoint, desired, current),
          strategyOptions
        )
    );

    const appliedCount = changes.filter((c) => c.action !== "unchanged").length;
    return withWarnings(
      buildApplyResult(repoName, changeCounts, appliedCount, { planOutput }),
      warnings
    );
  }

  private async readCurrent(
    githubRepo: GitHubRepoInfo,
    desired: ActionsSettings,
    strategyOptions: GhApiOptions
  ): Promise<ActionsSettings> {
    let current: ActionsSettings = {};
    // Serial: GitHub asks for serial requests to avoid secondary rate limits
    await runSequentially(
      ACTIONS_ENDPOINTS.filter((e) => touches(e, desired)),
      async (endpoint) => {
        // GitHub answers 409 to a selected-actions GET in any other mode
        if (
          endpoint.name === "selectedActions" &&
          current.allowedActions !== "selected"
        ) {
          return;
        }
        const body = await this.strategy.get(
          githubRepo,
          endpoint.name,
          strategyOptions
        );
        current = { ...current, ...readEndpoint(endpoint, body) };
      }
    );
    return current;
  }
}
