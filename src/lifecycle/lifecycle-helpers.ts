import { resolve, join } from "node:path";
import { generateWorkspaceName } from "../shared/workspace-utils.js";
import { formatLifecycleAction } from "./lifecycle-formatter.js";
import type { RepoConfig, GitHubRepoSettings } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type {
  IRepoLifecycleManager,
  CreateRepoSettings,
  LifecycleResult,
} from "./types.js";

interface LifecycleCheckOptions {
  dryRun: boolean;
  /** Base work directory (combined with repoIndex to compute full path). */
  workDir?: string;
  githubHosts?: string[];
  /** Pre-resolved work directory. If provided, used directly instead of computing from workDir + repoIndex. */
  resolvedWorkDir?: string;
  /** Auth token (GitHub App installation token or PAT) for gh CLI commands */
  token?: string;
  /** Index used to generate workspace directory name when resolvedWorkDir is not provided. */
  repoIndex: number;
  lifecycleManager: IRepoLifecycleManager;
  repoSettings?: GitHubRepoSettings;
}

/**
 * Build CreateRepoSettings from GitHubRepoSettings.
 * Extracts only the fields relevant for repo creation.
 */
export function toCreateRepoSettings(
  repo: GitHubRepoSettings | undefined
): CreateRepoSettings | undefined {
  if (!repo) return undefined;

  const result: CreateRepoSettings = {};
  if (repo.visibility !== undefined) result.visibility = repo.visibility;
  if (repo.description !== undefined) result.description = repo.description;
  if (repo.hasIssues !== undefined) result.hasIssues = repo.hasIssues;
  if (repo.hasWiki !== undefined) result.hasWiki = repo.hasWiki;
  if (repo.defaultBranch !== undefined)
    result.defaultBranch = repo.defaultBranch;

  return Object.keys(result).length > 0 ? result : undefined;
}

interface LifecycleCheckResult {
  lifecycleResult: LifecycleResult;
  outputLines: string[];
}

/**
 * Run lifecycle check for a single repo.
 * Returns the lifecycle result and formatted output lines.
 */
export async function runLifecycleCheck(
  repoConfig: RepoConfig,
  repoInfo: RepoInfo,
  options: LifecycleCheckOptions
): Promise<LifecycleCheckResult> {
  const workDir =
    options.resolvedWorkDir ??
    resolve(
      join(options.workDir ?? "./tmp", generateWorkspaceName(options.repoIndex))
    );

  const createSettings = toCreateRepoSettings(options.repoSettings);

  const lifecycleResult = await options.lifecycleManager.ensureRepo(
    repoConfig,
    repoInfo,
    {
      dryRun: options.dryRun,
      workDir,
      githubHosts: options.githubHosts,
      token: options.token,
    },
    createSettings
  );

  const outputLines = formatLifecycleAction(lifecycleResult, {
    upstream: repoConfig.upstream,
    source: repoConfig.source,
    settings: createSettings
      ? {
          visibility: createSettings.visibility,
          description: createSettings.description,
        }
      : undefined,
  });

  return { lifecycleResult, outputLines };
}
