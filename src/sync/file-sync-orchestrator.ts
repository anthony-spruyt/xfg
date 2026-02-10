import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../shared/repo-detector.js";
import type { ILogger } from "../shared/logger.js";
import type { FileAction } from "../vcs/pr-creator.js";
import { incrementDiffStats } from "./diff-utils.js";
import { loadManifest } from "./manifest.js";
import type {
  IFileWriter,
  IManifestManager,
  SessionContext,
  ProcessorOptions,
  FileSyncResult,
  IFileSyncOrchestrator,
} from "./types.js";

export class FileSyncOrchestrator implements IFileSyncOrchestrator {
  constructor(
    private readonly fileWriter: IFileWriter,
    private readonly manifestManager: IManifestManager,
    private readonly log: ILogger
  ) {}

  async sync(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    session: SessionContext,
    options: ProcessorOptions
  ): Promise<FileSyncResult> {
    const { workDir, dryRun, noDelete, configId } = options;

    // Write files
    const { fileChanges, diffStats } = await this.fileWriter.writeFiles(
      repoConfig.files,
      {
        repoInfo,
        baseBranch: session.baseBranch,
        workDir,
        dryRun: dryRun ?? false,
        noDelete: noDelete ?? false,
        configId,
      },
      { gitOps: session.gitOps, log: this.log }
    );

    // Handle orphans
    const existingManifest = loadManifest(workDir);
    const filesWithDeleteOrphaned = new Map<string, boolean | undefined>(
      repoConfig.files.map((f) => [f.fileName, f.deleteOrphaned])
    );

    const { manifest: newManifest, filesToDelete } =
      this.manifestManager.processOrphans(
        workDir,
        configId,
        filesWithDeleteOrphaned
      );

    await this.manifestManager.deleteOrphans(
      filesToDelete,
      { dryRun: dryRun ?? false, noDelete: noDelete ?? false },
      { gitOps: session.gitOps, log: this.log, fileChanges }
    );

    // Update diff stats for deletions in dry-run
    if (dryRun && filesToDelete.length > 0 && !noDelete) {
      for (const fileName of filesToDelete) {
        if (session.gitOps.fileExists(fileName)) {
          incrementDiffStats(diffStats, "DELETED");
        }
      }
    }

    // Save manifest
    this.manifestManager.saveUpdatedManifest(
      workDir,
      newManifest,
      existingManifest,
      dryRun ?? false,
      fileChanges
    );

    // Show diff summary in dry-run
    if (dryRun) {
      this.log.diffSummary(
        diffStats.newCount,
        diffStats.modifiedCount,
        diffStats.unchangedCount,
        diffStats.deletedCount
      );
    }

    // Build changed files list
    const changedFiles: FileAction[] = Array.from(fileChanges.entries()).map(
      ([fileName, info]) => ({ fileName, action: info.action })
    );

    // Calculate diff stats for non-dry-run
    if (!dryRun) {
      for (const [, info] of fileChanges) {
        if (info.action === "create") incrementDiffStats(diffStats, "NEW");
        else if (info.action === "update")
          incrementDiffStats(diffStats, "MODIFIED");
        else if (info.action === "delete")
          incrementDiffStats(diffStats, "DELETED");
      }
    }

    const hasChanges = changedFiles.some((f) => f.action !== "skip");

    return { fileChanges, diffStats, changedFiles, hasChanges };
  }
}
