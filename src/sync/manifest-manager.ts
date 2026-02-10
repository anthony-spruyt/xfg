import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadManifest,
  saveManifest,
  updateManifest,
  MANIFEST_FILENAME,
  type XfgManifest,
} from "./manifest.js";
import type {
  IManifestManager,
  OrphanProcessResult,
  OrphanDeleteOptions,
  OrphanDeleteDeps,
  FileWriteResult,
} from "./types.js";

/**
 * Handles manifest loading, saving, and orphan detection.
 */
export class ManifestManager implements IManifestManager {
  processOrphans(
    workDir: string,
    configId: string,
    filesWithDeleteOrphaned: Map<string, boolean | undefined>
  ): OrphanProcessResult {
    const existingManifest = loadManifest(workDir);

    const { manifest, filesToDelete } = updateManifest(
      existingManifest,
      configId,
      filesWithDeleteOrphaned
    );

    return { manifest, filesToDelete };
  }

  async deleteOrphans(
    filesToDelete: string[],
    options: OrphanDeleteOptions,
    deps: OrphanDeleteDeps
  ): Promise<void> {
    const { dryRun, noDelete } = options;
    const { gitOps, log, fileChanges } = deps;

    if (filesToDelete.length === 0) {
      return;
    }

    if (noDelete) {
      log.info(
        `Skipping deletion of ${filesToDelete.length} orphaned file(s) (--no-delete flag)`
      );
      return;
    }

    for (const fileName of filesToDelete) {
      // Only delete if file actually exists in the working directory
      if (!gitOps.fileExists(fileName)) {
        continue;
      }

      fileChanges.set(fileName, {
        fileName,
        content: null,
        action: "delete",
      });

      if (dryRun) {
        log.fileDiff(fileName, "DELETED", []);
      } else {
        log.info(`Deleting orphaned file: ${fileName}`);
        gitOps.deleteFile(fileName);
      }
    }
  }

  saveUpdatedManifest(
    workDir: string,
    manifest: XfgManifest,
    existingManifest: XfgManifest | null,
    dryRun: boolean,
    fileChanges: Map<string, FileWriteResult>
  ): void {
    // Check if manifest changed
    const existingConfigs = existingManifest?.configs ?? {};
    const manifestChanged =
      JSON.stringify(existingConfigs) !== JSON.stringify(manifest.configs);

    if (!manifestChanged) {
      return;
    }

    const hasAnyManagedFiles = Object.keys(manifest.configs).length > 0;
    if (!hasAnyManagedFiles && existingManifest === null) {
      return;
    }

    const manifestExisted = existsSync(join(workDir, MANIFEST_FILENAME));
    const manifestContent = JSON.stringify(manifest, null, 2) + "\n";

    fileChanges.set(MANIFEST_FILENAME, {
      fileName: MANIFEST_FILENAME,
      content: manifestContent,
      action: manifestExisted ? "update" : "create",
    });

    if (!dryRun) {
      saveManifest(workDir, manifest);
    }
  }
}
