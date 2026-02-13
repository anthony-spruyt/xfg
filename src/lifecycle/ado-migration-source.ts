import { escapeShellArg } from "../shared/shell-utils.js";
import {
  ICommandExecutor,
  defaultExecutor,
} from "../shared/command-executor.js";
import { withRetry } from "../shared/retry-utils.js";
import {
  isAzureDevOpsRepo,
  type RepoInfo,
  type AzureDevOpsRepoInfo,
} from "../shared/repo-detector.js";
import type { IMigrationSource, LifecyclePlatform } from "./types.js";

/**
 * Azure DevOps implementation of IMigrationSource.
 * Uses git clone --mirror to get all refs for migration.
 */
export class AdoMigrationSource implements IMigrationSource {
  readonly platform: LifecyclePlatform = "azure-devops";

  constructor(
    private readonly executor: ICommandExecutor = defaultExecutor,
    private readonly retries: number = 3
  ) {}

  private assertAdo(
    repoInfo: RepoInfo
  ): asserts repoInfo is AzureDevOpsRepoInfo {
    if (!isAzureDevOpsRepo(repoInfo)) {
      throw new Error(
        `AdoMigrationSource requires Azure DevOps repo, got: ${repoInfo.type}`
      );
    }
  }

  async cloneForMigration(repoInfo: RepoInfo, workDir: string): Promise<void> {
    this.assertAdo(repoInfo);

    const command = `git clone --mirror ${escapeShellArg(repoInfo.gitUrl)} ${escapeShellArg(workDir)}`;

    try {
      await withRetry(() => this.executor.exec(command, process.cwd()), {
        retries: this.retries,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to clone migration source ${repoInfo.gitUrl}: ${msg}. ` +
          `Ensure you have authentication configured for Azure DevOps ` +
          `(e.g., AZURE_DEVOPS_EXT_PAT or git credential helper).`
      );
    }
  }
}
