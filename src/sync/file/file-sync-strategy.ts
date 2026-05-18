import type { RepoConfig } from "../../config/index.js";
import type { RepoInfo } from "../../repo/index.js";
import type { FileAction } from "../../vcs/index.js";
import type { ActiveAction } from "../../settings/index.js";
import { formatCommitMessage } from "./commit-message.js";
import type {
  FileChangeDetail,
  IWorkStrategy,
  WorkResult,
  SessionContext,
  ProcessorOptions,
  IFileSyncOrchestrator,
} from "../types.js";

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
      .filter(
        (f): f is FileAction & { action: ActiveAction } => f.action !== "skip"
      )
      .map((f) => {
        const detail: FileChangeDetail = {
          path: f.fileName,
          action: f.action,
        };
        const writeResult = fileChanges.get(f.fileName);
        if (writeResult?.diffLines) {
          detail.diffLines = writeResult.diffLines;
        }
        return detail;
      });

    return {
      fileChanges,
      changedFiles,
      diffStats,
      commitMessage: formatCommitMessage(changedFiles),
      fileChangeDetails,
    };
  }
}
