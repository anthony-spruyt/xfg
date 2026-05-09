import type { ILogger } from "../shared/logger.js";
import {
  createPR,
  mergePR,
  createPRStrategy,
  type PRResult,
  type PRMergeConfig,
} from "../vcs/index.js";
import type {
  ProcessorResult,
  IPRMergeHandler,
  CreateAndMergeInput,
} from "./types.js";

export class PRMergeHandler implements IPRMergeHandler {
  constructor(private readonly log: ILogger) {}

  async createAndMerge(input: CreateAndMergeInput): Promise<ProcessorResult> {
    const {
      repoInfo,
      prOptions,
      options,
      changedFiles,
      repoName,
      diffStats,
      fileChanges,
    } = input;
    this.log.info("Creating pull request...");
    const strategy = options.dryRun
      ? undefined
      : createPRStrategy(repoInfo, options.executor, this.log);
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
      labels: prOptions?.labels,
      log: this.log,
      strategy,
    });

    const mergeMode = prOptions?.merge ?? "auto";
    let mergeResult: ProcessorResult["mergeResult"];

    if (prResult.success && prResult.url && mergeMode !== "manual") {
      this.log.info(`Handling merge (mode: ${mergeMode})...`);

      const mergeConfig: PRMergeConfig = {
        mode: mergeMode,
        strategy: prOptions?.mergeStrategy ?? "squash",
        deleteBranch: prOptions?.deleteBranch ?? true,
        bypassReason: prOptions?.bypassReason,
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
        log: this.log,
        strategy,
      });

      mergeResult = {
        merged: result.merged ?? false,
        autoMergeEnabled: result.autoMergeEnabled,
        message: result.message,
      };

      if (!result.success) {
        this.log.warn(`Merge operation failed - ${result.message}`);
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
