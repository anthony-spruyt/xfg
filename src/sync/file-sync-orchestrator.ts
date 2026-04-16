import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../repo/detector.js";
import type { ILogger } from "../shared/logger.js";
import type { FileAction } from "../vcs/index.js";
import { incrementDiffStats } from "./diff-utils.js";

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
    const { workDir, configId } = options;
    const dryRun = options.dryRun ?? false;
    const noDelete = options.noDelete ?? false;

    const { fileChanges, diffStats } = await this.fileWriter.writeFiles(
      repoConfig.files,
      {
        repoInfo,
        baseBranch: session.baseBranch,
        workDir,
        dryRun,
        noDelete,
        configId,
        hasAppCredentials: options.hasAppCredentials,
      },
      { gitOps: session.gitOps, log: this.log }
    );

    const filesWithDeleteOrphaned = new Map<string, boolean | undefined>(
      repoConfig.files.map((f) => [f.fileName, f.deleteOrphaned])
    );

    const {
      manifest: newManifest,
      existingManifest,
      filesToDelete,
    } = this.manifestManager.detectOrphans(
      workDir,
      configId,
      filesWithDeleteOrphaned
    );

    this.manifestManager.deleteOrphans(
      filesToDelete,
      { dryRun: dryRun, noDelete: noDelete },
      { gitOps: session.gitOps, log: this.log, fileChanges }
    );

    // Save manifest (may add to fileChanges)
    this.manifestManager.saveUpdatedManifest(
      workDir,
      newManifest,
      existingManifest,
      dryRun,
      fileChanges
    );

    // Count stats for entries added after writeFiles (orphan deletes + manifest).
    // Invariant: writerFiles and post-write entries are disjoint — orphan deletes
    // only target files NOT in the current config (see updateManifest), and
    // the manifest file is never a config-managed file.
    const writerFiles = new Set(repoConfig.files.map((f) => f.fileName));
    for (const [name, info] of fileChanges) {
      if (writerFiles.has(name)) continue;
      if (info.action === "create") incrementDiffStats(diffStats, "NEW");
      else if (info.action === "update")
        incrementDiffStats(diffStats, "MODIFIED");
      else if (info.action === "delete")
        incrementDiffStats(diffStats, "DELETED");
    }

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

    const hasChanges = changedFiles.some((f) => f.action !== "skip");

    return { fileChanges, diffStats, changedFiles, hasChanges };
  }
}
