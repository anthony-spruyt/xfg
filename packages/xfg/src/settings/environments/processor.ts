import type { EnvironmentConfig, RepoConfig } from "../../config/index.js";
import type {
  GitHubRepoInfo,
  IRepoMetadataProvider,
  RepoInfo,
} from "../../repo/index.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";
import { runSequentially } from "../../shared/sequential.js";
import { quoted } from "../../shared/string-utils.js";
import { toErrorMessage } from "../../shared/type-guards.js";
import {
  diffEnvironments,
  needsPatternLookup,
  orphanEnvironments,
  toGitHubPolicy,
  type EnvironmentChange,
  type EnvironmentDeletion,
} from "./diff.js";
import {
  formatEnvironmentsPlan,
  formatPatternLabel,
  type EnvironmentsPlanResult,
} from "./formatter.js";
import type { ExistingBranchPattern, IEnvironmentsStrategy } from "./types.js";
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
  EnvironmentsProcessorOptions,
  EnvironmentsProcessorResult
>;

export interface EnvironmentsProcessorOptions extends BaseProcessorOptions {
  noDelete?: boolean;
}

export interface EnvironmentsProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: EnvironmentsPlanResult;
  warnings?: string[];
}

function environmentsOf(repoConfig: RepoConfig): {
  entries: Record<string, EnvironmentConfig>;
  deleteOrphaned: boolean;
} {
  const { deleteOrphaned, ...entries } = (repoConfig.settings?.environments ??
    {}) as Record<string, unknown>;
  return {
    entries: entries as Record<string, EnvironmentConfig>,
    deleteOrphaned: deleteOrphaned === true,
  };
}

function isPermissionError(error: unknown): boolean {
  return (
    toErrorMessage(error).includes("HTTP 403") && !isPaidPlanError(error)
  );
}

async function deleteAsAdmin(
  what: string,
  run: () => Promise<void>
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!isPermissionError(error)) throw error;
    throw new Error(
      `${what} needs the Administration: Read and write permission (repo admin): ${toErrorMessage(error)}`,
      { cause: error }
    );
  }
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
    options: EnvironmentsProcessorOptions
  ): Promise<EnvironmentsProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) => {
        const { entries, deleteOrphaned } = environmentsOf(rc);
        return Object.keys(entries).length > 0 || deleteOrphaned;
      },
      emptySettingsMessage: "No environments configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async readPatterns(
    githubRepo: GitHubRepoInfo,
    names: string[],
    strategyOptions: GhApiOptions
  ): Promise<Map<string, ExistingBranchPattern[]>> {
    const patterns = new Map<string, ExistingBranchPattern[]>();
    // Serial: GitHub asks for serial requests to avoid secondary rate limits
    await runSequentially(names, async (name) => {
      patterns.set(
        name.toLowerCase(),
        await this.strategy.listBranchPolicies(
          githubRepo,
          name,
          strategyOptions
        )
      );
    });
    return patterns;
  }

  private async applySettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: EnvironmentsProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<EnvironmentsProcessorResult> {
    const { entries: desired, deleteOrphaned } = environmentsOf(repoConfig);
    const noDelete = options.noDelete ?? false;
    const strategyOptions = { token: effectiveToken, host: githubRepo.host };

    const current = await this.strategy.list(githubRepo, strategyOptions);
    const patterns = await this.readPatterns(
      githubRepo,
      needsPatternLookup(desired, current),
      strategyOptions
    );
    const changes = diffEnvironments(desired, current, patterns, { noDelete });
    const deletions =
      deleteOrphaned && !noDelete ? orphanEnvironments(desired, current) : [];
    const changeCounts = countActions([...changes, ...deletions]);
    const warnings = unmanagedWarnings(repoName, changes);

    if (options.dryRun) {
      return buildDryRunResult(
        repoName,
        changeCounts,
        withWarnings(
          { planOutput: formatEnvironmentsPlan(changes, true, deletions) },
          warnings
        )
      );
    }

    const progress = { writes: 0 };
    let appliedCount = 0;
    try {
      // Serial: GitHub asks for serial requests to avoid secondary rate limits
      await runSequentially(
        changes.filter((c) => c.action !== "unchanged"),
        async (change) => {
          await this.applyChange(githubRepo, change, strategyOptions, progress);
          appliedCount++;
        }
      );
      await runSequentially(deletions, async (deletion) => {
        await this.deleteEnvironment(githubRepo, deletion, strategyOptions);
        progress.writes++;
        appliedCount++;
      });
    } catch (error) {
      if (progress.writes > 0 || !isPaidPlanError(error)) throw error;
      return this.skipIfNotPublic(githubRepo, strategyOptions, repoName, error);
    }

    return buildApplyResult(
      repoName,
      changeCounts,
      appliedCount,
      withWarnings(
        { planOutput: formatEnvironmentsPlan(changes, false, deletions) },
        warnings
      )
    );
  }

  private async deleteEnvironment(
    githubRepo: GitHubRepoInfo,
    deletion: EnvironmentDeletion,
    strategyOptions: GhApiOptions
  ): Promise<void> {
    await deleteAsAdmin(`deleting environment ${quoted(deletion.name)}`, () =>
      this.strategy.delete(githubRepo, deletion.name, strategyOptions)
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

    // Serial: GitHub asks for serial requests to avoid secondary rate limits
    await runSequentially(missing, async (pattern) => {
      await this.strategy.createBranchPolicy(
        githubRepo,
        change.name,
        pattern,
        strategyOptions
      );
      progress.writes++;
    });

    // Serial: GitHub asks for serial requests to avoid secondary rate limits
    await runSequentially(change.orphanPatterns, async (pattern) => {
      await deleteAsAdmin(
        `deleting ${formatPatternLabel(pattern)} from environment ${quoted(change.name)}`,
        () =>
          this.strategy.deleteBranchPolicy(
            githubRepo,
            change.name,
            pattern.id,
            strategyOptions
          )
      );
      progress.writes++;
    });
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
