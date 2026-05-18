import type { RepoConfig } from "../../config/index.js";
import type { GitHubRepoInfo, RepoInfo } from "../../repo/index.js";
import { diffVariables } from "./diff.js";
import { formatVariablesPlan, type VariablesPlanResult } from "./formatter.js";
import type { IVariablesStrategy } from "./types.js";
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

export type IVariablesProcessor = ISettingsProcessor<
  VariablesProcessorOptions,
  VariablesProcessorResult
>;

export interface VariablesProcessorOptions extends BaseProcessorOptions {
  noDelete?: boolean;
}

export interface VariablesProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: VariablesPlanResult;
}

export class VariablesProcessor implements IVariablesProcessor {
  private readonly strategy: IVariablesStrategy;

  constructor(strategy: IVariablesStrategy) {
    this.strategy = strategy;
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: VariablesProcessorOptions
  ): Promise<VariablesProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) => {
        const vars = rc.settings?.variables ?? {};
        const { deleteOrphaned, ...entries } = vars as Record<string, unknown>;
        return Object.keys(entries).length > 0 || deleteOrphaned === true;
      },
      emptySettingsMessage: "No variables configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async applySettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: VariablesProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<VariablesProcessorResult> {
    const { dryRun, noDelete } = options;
    const settings = repoConfig.settings;
    const { deleteOrphaned: varDeleteOrphaned = false, ...desiredVariables } =
      (settings?.variables ?? {}) as Record<string, string> & {
        deleteOrphaned?: boolean;
      };
    const deleteOrphaned = varDeleteOrphaned && !(noDelete ?? false);

    const strategyOptions = { token: effectiveToken, host: githubRepo.host };
    const currentVariables = await this.strategy.list(
      githubRepo,
      strategyOptions
    );

    const changes = diffVariables(
      currentVariables,
      desiredVariables,
      deleteOrphaned
    );
    const changeCounts = countActions(changes);
    const planOutput = formatVariablesPlan(changes);

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts, { planOutput });
    }

    let appliedCount = 0;

    for (const change of changes) {
      switch (change.action) {
        case "create":
          if (change.newValue !== undefined) {
            await this.strategy.create(
              githubRepo,
              change.name,
              change.newValue,
              strategyOptions
            );
            appliedCount++;
          }
          break;
        case "update":
          if (change.newValue !== undefined) {
            await this.strategy.update(
              githubRepo,
              change.name,
              change.newValue,
              strategyOptions
            );
            appliedCount++;
          }
          break;
        case "delete":
          await this.strategy.delete(githubRepo, change.name, strategyOptions);
          appliedCount++;
          break;
        case "unchanged":
          break;

        default: {
          const _exhaustive: never = change.action;
          throw new Error(`Unexpected variable action: ${String(_exhaustive)}`);
        }
      }
    }

    return buildApplyResult(repoName, changeCounts, appliedCount, {
      planOutput,
    });
  }
}
