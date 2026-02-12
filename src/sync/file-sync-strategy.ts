import type { RepoConfig } from "../config/types.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import { formatCommitMessage } from "./commit-message.js";
import type {
  IWorkStrategy,
  WorkResult,
  SessionContext,
  ProcessorOptions,
  IFileSyncOrchestrator,
} from "./types.js";

/**
 * Strategy that performs full file synchronization.
 * Wraps FileSyncOrchestrator to fit the IWorkStrategy interface.
 */
export class FileSyncStrategy implements IWorkStrategy {
  constructor(private readonly fileSyncOrchestrator: IFileSyncOrchestrator) {}

  async execute(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    session: SessionContext,
    options: ProcessorOptions
  ): Promise<WorkResult | null> {
    const { fileChanges, diffStats, changedFiles, hasChanges } =
      await this.fileSyncOrchestrator.sync(
        repoConfig,
        repoInfo,
        session,
        options
      );

    if (!hasChanges) {
      return null;
    }

    const fileChangeDetails = changedFiles
      .filter((f) => f.action !== "skip")
      .map((f) => ({
        path: f.fileName,
        action: f.action as "create" | "update" | "delete",
      }));

    return {
      fileChanges,
      changedFiles,
      diffStats,
      commitMessage: formatCommitMessage(changedFiles),
      fileChangeDetails,
    };
  }
}
