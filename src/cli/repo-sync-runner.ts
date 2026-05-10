import { resolve, join } from "node:path";
import type { Config, RepoConfig } from "../config/index.js";
import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
  type RepoInfo,
  type GitHubRepoInfo,
} from "../repo/index.js";
import type { createTokenManager } from "../vcs/index.js";
import type { IRepositoryProcessor } from "../sync/index.js";
import type { ProcessExecutor } from "../shared/command-executor.js";
import type { Logger } from "../shared/logger.js";
import { generateWorkspaceName } from "../shared/workspace-utils.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { resolveGitHubToken } from "../shared/gh-token-utils.js";
import {
  runLifecycleCheck,
  type IRepoLifecycleManager,
} from "../lifecycle/index.js";
import type {
  SyncOptions,
  SyncResultEntry,
  SettingsProcessorFactories,
} from "./types.js";
import type { ResultsCollector } from "./results-collector.js";
import { applyRepoSettings } from "./settings-runner.js";
import { determineMergeOutcome } from "./sync-utils.js";
import type { LifecycleAction } from "../output/index.js";

export interface RepoIterationContext {
  config: Config;
  options: SyncOptions;
  branchName: string;
  processor: IRepositoryProcessor;
  lifecycleManager: IRepoLifecycleManager;
  tokenManager: ReturnType<typeof createTokenManager>;
  reportResults: SyncResultEntry[];
  lifecycleReportInputs: LifecycleAction[];
  settingsCollector: ResultsCollector;
  factories: SettingsProcessorFactories;
  logger: Logger;
  executor: ProcessExecutor;
}

interface RepoPhaseParams {
  repoConfig: RepoConfig;
  repoInfo: RepoInfo;
  repoName: string;
  index: number;
  workDir: string;
  token: string | undefined;
}

function pushFailure(
  results: SyncResultEntry[],
  repoName: string,
  error: unknown
): void {
  results.push({
    repoName,
    success: false,
    fileChanges: [],
    error: toErrorMessage(error),
  });
}

async function runLifecyclePhase(
  repo: RepoPhaseParams,
  ctx: RepoIterationContext
): Promise<boolean> {
  const repoNumber = repo.index + 1;

  try {
    const { outputLines, lifecycleResult, reportSettings } =
      await runLifecycleCheck(repo.repoConfig, repo.repoInfo, {
        dryRun: ctx.options.dryRun ?? false,
        resolvedWorkDir: repo.workDir,
        githubHosts: ctx.config.githubHosts,
        token: repo.token,
        repoIndex: repo.index,
        lifecycleManager: ctx.lifecycleManager,
        repoSettings: ctx.config.settings?.repo,
      });

    for (const line of outputLines) {
      ctx.logger.info(line);
    }
    ctx.lifecycleReportInputs.push({
      repoName: repo.repoName,
      action: lifecycleResult.action,
      upstream: repo.repoConfig.upstream,
      source: repo.repoConfig.source,
      settings: reportSettings,
    });

    if (ctx.options.dryRun && lifecycleResult.action !== "existed") {
      ctx.reportResults.push({
        repoName: repo.repoName,
        success: true,
        fileChanges: [],
      });
      return true;
    }

    return false;
  } catch (error) {
    ctx.logger.error(
      repoNumber,
      repo.repoName,
      `Lifecycle error: ${toErrorMessage(error)}`
    );
    pushFailure(ctx.reportResults, repo.repoName, error);
    return true;
  }
}

async function runFileSyncPhase(
  repo: RepoPhaseParams,
  ctx: RepoIterationContext
): Promise<void> {
  const repoNumber = repo.index + 1;
  try {
    ctx.logger.progress(repoNumber, repo.repoName, "Processing...");

    const result = await ctx.processor.process(repo.repoConfig, repo.repoInfo, {
      branchName: ctx.branchName,
      workDir: repo.workDir,
      configId: ctx.config.id,
      dryRun: ctx.options.dryRun,
      retries: ctx.options.retries,
      executor: ctx.executor,
      prTemplate: ctx.config.prTemplate,
      noDelete: ctx.options.noDelete,
      token: repo.token,
      hasAppCredentials:
        isGitHubRepo(repo.repoInfo) && ctx.tokenManager !== null,
    });

    const mergeOutcome = determineMergeOutcome(result);

    ctx.reportResults.push({
      repoName: repo.repoName,
      success: result.success,
      fileChanges: result.fileChanges ?? [],
      prUrl: result.prUrl,
      mergeOutcome,
      error: result.success ? undefined : result.message,
    });

    if (result.skipped) {
      ctx.logger.skip(repoNumber, repo.repoName, result.message);
    } else if (result.success) {
      ctx.logger.success(repoNumber, repo.repoName, result.message);
    } else {
      ctx.logger.error(repoNumber, repo.repoName, result.message);
    }
  } catch (error) {
    ctx.logger.error(repoNumber, repo.repoName, toErrorMessage(error));
    pushFailure(ctx.reportResults, repo.repoName, error);
  }
}

export async function runSingleRepo(
  repoConfig: RepoConfig,
  index: number,
  ctx: RepoIterationContext
): Promise<void> {
  const { config, options, logger } = ctx;
  const repoNumber = index + 1;

  const effectivePrOptions =
    options.merge || options.mergeStrategy || options.deleteBranch
      ? {
          ...repoConfig.prOptions,
          merge: options.merge ?? repoConfig.prOptions?.merge,
          mergeStrategy:
            options.mergeStrategy ?? repoConfig.prOptions?.mergeStrategy,
          deleteBranch:
            options.deleteBranch ?? repoConfig.prOptions?.deleteBranch,
        }
      : repoConfig.prOptions;

  const effectiveRepoConfig = { ...repoConfig, prOptions: effectivePrOptions };

  const mergeMode = effectivePrOptions?.merge ?? "auto";
  if (mergeMode === "direct" && effectivePrOptions?.mergeStrategy) {
    logger.warn(
      `mergeStrategy '${effectivePrOptions.mergeStrategy}' is ignored in direct mode for ${repoConfig.git}`
    );
  }

  let repoInfo: RepoInfo;
  try {
    repoInfo = parseGitUrl(repoConfig.git, {
      githubHosts: config.githubHosts,
    });
  } catch (error) {
    logger.error(repoNumber, repoConfig.git, toErrorMessage(error));
    pushFailure(ctx.reportResults, repoConfig.git, error);
    return;
  }

  const repoName = getRepoDisplayName(repoInfo);
  const workDir = resolve(
    join(options.workDir ?? "./tmp", generateWorkspaceName(index))
  );

  const repoToken = isGitHubRepo(repoInfo)
    ? (
        await resolveGitHubToken({
          repoInfo: repoInfo as GitHubRepoInfo,
          tokenManager: ctx.tokenManager,
          context: repoName,
          log: logger,
          envToken: process.env.GH_TOKEN,
        })
      ).token
    : undefined;

  const repo: RepoPhaseParams = {
    repoConfig: effectiveRepoConfig,
    repoInfo,
    repoName,
    index,
    workDir,
    token: repoToken,
  };

  const skipFileSync = await runLifecyclePhase(repo, ctx);
  if (skipFileSync) return;

  await runFileSyncPhase(repo, ctx);

  await applyRepoSettings({
    repoConfig: effectiveRepoConfig,
    repoInfo,
    repoName,
    repoNumber,
    options,
    token: repoToken,
    settingsCollector: ctx.settingsCollector,
    factories: ctx.factories,
    logger,
  });
}
