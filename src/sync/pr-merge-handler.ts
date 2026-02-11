import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import {
  createPR,
  mergePR,
  type PRResult,
  type FileAction,
} from "../vcs/pr-creator.js";
import type { PRMergeConfig } from "../vcs/index.js";
import type { DiffStats } from "./diff-utils.js";
import type {
  ProcessorResult,
  PRHandlerOptions,
  IPRMergeHandler,
  FileChangeDetail,
} from "./types.js";

export class PRMergeHandler implements IPRMergeHandler {
  constructor(private readonly log: ILogger) {}

  async createAndMerge(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: PRHandlerOptions,
    changedFiles: FileAction[],
    repoName: string,
    diffStats?: DiffStats,
    fileChanges?: FileChangeDetail[]
  ): Promise<ProcessorResult> {
    this.log.info("Creating pull request...");
    const prResult: PRResult = await createPR({
      repoInfo,
      branchName: options.branchName,
      baseBranch: options.baseBranch,
      files: changedFiles,
      workDir: options.workDir,
      dryRun: options.dryRun,
      retries: options.retries,
      prTemplate: options.prTemplate,
      executor: options.executor,
      token: options.token,
    });

    const mergeMode = repoConfig.prOptions?.merge ?? "auto";
    let mergeResult: ProcessorResult["mergeResult"];

    if (prResult.success && prResult.url && mergeMode !== "manual") {
      this.log.info(`Handling merge (mode: ${mergeMode})...`);

      const mergeConfig: PRMergeConfig = {
        mode: mergeMode,
        strategy: repoConfig.prOptions?.mergeStrategy ?? "squash",
        deleteBranch: repoConfig.prOptions?.deleteBranch ?? true,
        bypassReason: repoConfig.prOptions?.bypassReason,
      };

      const result = await mergePR({
        repoInfo,
        prUrl: prResult.url,
        mergeConfig,
        workDir: options.workDir,
        dryRun: options.dryRun,
        retries: options.retries,
        executor: options.executor,
        token: options.token,
      });

      mergeResult = {
        merged: result.merged ?? false,
        autoMergeEnabled: result.autoMergeEnabled,
        message: result.message,
      };

      if (!result.success) {
        this.log.info(`Warning: Merge operation failed - ${result.message}`);
      } else {
        this.log.info(result.message);
      }
    }

    return {
      success: prResult.success,
      repoName,
      message: prResult.message,
      prUrl: prResult.url,
      mergeResult,
      diffStats,
      fileChanges,
    };
  }
}
