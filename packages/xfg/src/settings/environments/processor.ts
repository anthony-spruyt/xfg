import type {
  DeploymentBranchPattern,
  RepoConfig,
} from "../../config/index.js";
import type {
  GitHubRepoInfo,
  IRepoMetadataProvider,
  RepoInfo,
} from "../../repo/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";
import { quoted } from "../../shared/string-utils.js";
import { toErrorMessage } from "../../shared/type-guards.js";
import {
  diffEnvironments,
  needsPatternLookup,
  toGitHubPolicy,
  type EnvironmentChange,
} from "./diff.js";
import {
  formatEnvironmentsPlan,
  formatPatternLabel,
  type EnvironmentsPlanResult,
} from "./formatter.js";
import type { IEnvironmentsStrategy } from "./types.js";
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

export type IEnvironmentsProcessor = ISettingsProcessor<
  BaseProcessorOptions,
  EnvironmentsProcessorResult
>;

export interface EnvironmentsProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: EnvironmentsPlanResult;
  warnings?: string[];
}

function unmanagedWarnings(
  repoName: string,
  changes: EnvironmentChange[]
): string[] {
  return changes.flatMap((c) =>
    c.unmanagedPatterns.map(
      (p) =>
        `${repoName}: environment ${quoted(c.name)} has ${formatPatternLabel(p)} not in config - left in place`
    )
  );
}

// GitHub's plan-gate replies: 422 for environment protection rules, 403 for other plan-gated features.
function isPaidPlanError(error: unknown): boolean {
  const message = toErrorMessage(error);
  return (
    (message.includes("HTTP 422") && /billing plan/i.test(message)) ||
    (message.includes("HTTP 403") &&
      message.includes("Upgrade to GitHub Pro or make this repository public"))
  );
}

function withWarnings<T extends object>(
  extra: T,
  warnings: string[]
): T & { warnings?: string[] } {
  return warnings.length > 0 ? { ...extra, warnings } : extra;
}

export class EnvironmentsProcessor implements IEnvironmentsProcessor {
  constructor(
    private readonly strategy: IEnvironmentsStrategy,
    private readonly metadataProvider: IRepoMetadataProvider
  ) {}

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: BaseProcessorOptions
  ): Promise<EnvironmentsProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) =>
        Object.keys(rc.settings?.environments ?? {}).length > 0,
      emptySettingsMessage: "No environments configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async readPatterns(
    githubRepo: GitHubRepoInfo,
    names: string[],
    strategyOptions: GhApiOptions
  ): Promise<Map<string, DeploymentBranchPattern[]>> {
    const patterns = new Map<string, DeploymentBranchPattern[]>();
    for (const name of names) {
      patterns.set(
        name.toLowerCase(),
        await this.strategy.listBranchPolicies(githubRepo, name, strategyOptions)
      );
    }
    return patterns;
  }

  private async applySettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: BaseProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<EnvironmentsProcessorResult> {
    const desired = repoConfig.settings?.environments ?? {};
    const strategyOptions = { token: effectiveToken, host: githubRepo.host };

    const current = await this.strategy.list(githubRepo, strategyOptions);
    const patterns = await this.readPatterns(
      githubRepo,
      needsPatternLookup(desired, current),
      strategyOptions
    );
    const changes = diffEnvironments(desired, current, patterns);
    const changeCounts = countActions(changes);
    const warnings = unmanagedWarnings(repoName, changes);

    if (options.dryRun) {
      return buildDryRunResult(
        repoName,
        changeCounts,
        withWarnings(
          { planOutput: formatEnvironmentsPlan(changes, true) },
          warnings
        )
      );
    }

    const progress = { writes: 0 };
    let appliedCount = 0;
    try {
      for (const change of changes) {
        if (change.action === "unchanged") continue;
        await this.applyChange(githubRepo, change, strategyOptions, progress);
        appliedCount++;
      }
    } catch (error) {
      if (progress.writes > 0 || !isPaidPlanError(error)) throw error;
      return this.skipIfNotPublic(githubRepo, strategyOptions, repoName, error);
    }

    return buildApplyResult(
      repoName,
      changeCounts,
      appliedCount,
      withWarnings(
        { planOutput: formatEnvironmentsPlan(changes, false) },
        warnings
      )
    );
  }

  private async applyChange(
    githubRepo: GitHubRepoInfo,
    change: EnvironmentChange,
    strategyOptions: GhApiOptions,
    progress: { writes: number }
  ): Promise<void> {
    if (change.putPolicy) {
      await this.strategy.createOrUpdate(
        githubRepo,
        change.name,
        toGitHubPolicy(change.desiredKind),
        strategyOptions
      );
      progress.writes++;
    }

    let missing = change.missingPatterns;
    if (!change.patternsKnown) {
      const existing = await this.strategy.listBranchPolicies(
        githubRepo,
        change.name,
        strategyOptions
      );
      missing = missing.filter(
        (p) => !existing.some((e) => e.type === p.type && e.name === p.name)
      );
    }

    for (const pattern of missing) {
      await this.strategy.createBranchPolicy(
        githubRepo,
        change.name,
        pattern,
        strategyOptions
      );
      progress.writes++;
    }
  }

  // GitHub can't report the plan up front: listing a free private repo's environments still succeeds.
  private async skipIfNotPublic(
    githubRepo: GitHubRepoInfo,
    strategyOptions: GhApiOptions,
    repoName: string,
    error: unknown
  ): Promise<EnvironmentsProcessorResult> {
    const metadata = await this.metadataProvider.getMetadata(
      githubRepo,
      strategyOptions
    );
    if (metadata.visibility === "public") throw error;
    return {
      success: true,
      repoName,
      message: "Skipped: environments need a paid plan on private repos",
      skipped: true,
      warnings: [
        `${repoName}: environments on private repos need a paid GitHub plan (Pro, Team or Enterprise) - skipped (${toErrorMessage(error)})`,
      ],
    };
  }
}
