import type { ICommandExecutor } from "../shared/command-executor.js";
import { withRetry } from "../shared/retry-utils.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { LifecycleError } from "../shared/errors.js";
import {
  isAzureDevOpsRepo,
  type RepoInfo,
  type AzureDevOpsRepoInfo,
} from "../repo/index.js";
import type { IMigrationSource, LifecyclePlatform } from "./types.js";

/**
 * Azure DevOps implementation of IMigrationSource.
 * Uses git clone --mirror to get all refs for migration.
 */
export class AdoMigrationSource implements IMigrationSource {
  readonly platform: LifecyclePlatform = "azure-devops";

  constructor(
    private readonly executor: ICommandExecutor,
    private readonly retries: number = 3,
    private readonly cwd: string
  ) {}

  private assertAdo(
    repoInfo: RepoInfo
  ): asserts repoInfo is AzureDevOpsRepoInfo {
    if (!isAzureDevOpsRepo(repoInfo)) {
      throw new LifecycleError(
        `AdoMigrationSource requires Azure DevOps repo, got: ${repoInfo.type}`
      );
    }
  }

  async cloneForMigration(repoInfo: RepoInfo, workDir: string): Promise<void> {
    this.assertAdo(repoInfo);

    try {
      await withRetry(
        () =>
          this.executor.exec(
            "git",
            ["clone", "--mirror", repoInfo.gitUrl, workDir],
            this.cwd
          ),
        {
          retries: this.retries,
        }
      );
    } catch (error) {
      const msg = toErrorMessage(error);
      throw new LifecycleError(
        `Failed to clone migration source ${repoInfo.gitUrl}: ${msg}. ` +
          `Ensure you have authentication configured for Azure DevOps ` +
          `(e.g., AZURE_DEVOPS_EXT_PAT or git credential helper).`,
        { cause: error }
      );
    }
  }
}
