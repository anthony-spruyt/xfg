import { resolve, join } from "node:path";
import { generateWorkspaceName } from "../shared/workspace-utils.js";
import { formatLifecycleAction } from "./lifecycle-formatter.js";
import type { RepoConfig, GitHubRepoSettings } from "../config/types.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type {
  IRepoLifecycleManager,
  CreateRepoSettings,
  LifecycleResult,
} from "./types.js";

export interface LifecycleCheckOptions {
  dryRun: boolean;
  workDir?: string;
  githubHosts?: string[];
}

/**
 * Build CreateRepoSettings from GitHubRepoSettings.
 * Extracts only the fields relevant for repo creation.
 */
export function toCreateRepoSettings(
  repo: GitHubRepoSettings | undefined
): CreateRepoSettings | undefined {
  if (!repo) return undefined;
  return {
    visibility: repo.visibility,
    description: repo.description,
    hasIssues: repo.hasIssues,
    hasWiki: repo.hasWiki,
  };
}

export interface LifecycleCheckResult {
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
  repoIndex: number,
  options: LifecycleCheckOptions,
  lifecycleManager: IRepoLifecycleManager,
  repoSettings?: GitHubRepoSettings
): Promise<LifecycleCheckResult> {
  const workDir = resolve(
    join(options.workDir ?? "./tmp", generateWorkspaceName(repoIndex))
  );

  const createSettings = toCreateRepoSettings(repoSettings);

  const lifecycleResult = await lifecycleManager.ensureRepo(
    repoConfig,
    repoInfo,
    {
      dryRun: options.dryRun,
      workDir,
      githubHosts: options.githubHosts,
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
