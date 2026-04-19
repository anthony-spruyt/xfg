import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  convertContentToString,
  type FileContent,
  type ContentValue,
} from "../config/index.js";
import { interpolateXfgContent } from "../shared/xfg-template.js";
import {
  getFileStatus,
  generateDiff,
  createDiffStats,
  incrementDiffStats,
  computeUnifiedDiff,
  isBinaryFile,
} from "./diff-utils.js";
import type {
  IFileWriter,
  FileWriteContext,
  FileWriterDeps,
  FileWriteAllResult,
  FileWriteResult,
} from "./types.js";

/**
 * Determines if a file should be marked as executable.
 * .sh files are auto-executable unless explicit executable: false is set.
 * Non-.sh files are executable only if executable: true is explicitly set.
 */
function shouldBeExecutable(file: FileContent): boolean {
  const isShellScript = file.fileName.endsWith(".sh");

  if (file.executable !== undefined) {
    // Explicit setting takes precedence
    return file.executable;
  }

  // Default: .sh files are executable, others are not
  return isShellScript;
}

/**
 * Handles file writing, template interpolation, and executable permissions.
 */
export class FileWriter implements IFileWriter {
  /**
   * Static method for checking executable status (for external use)
   */
  static shouldBeExecutable = shouldBeExecutable;

  async writeFiles(
    files: FileContent[],
    ctx: FileWriteContext,
    deps: FileWriterDeps
  ): Promise<FileWriteAllResult> {
    const { repoInfo, baseBranch, workDir, dryRun } = ctx;
    const { gitOps, log } = deps;

    const fileChanges = new Map<string, FileWriteResult>();
    const diffStats = createDiffStats();
    const modeCache = new Map<string, "100755" | "100644" | null>();

    for (const file of files) {
      const filePath = join(workDir, file.fileName);
      const fileExistsLocal = existsSync(filePath);

      // Handle createOnly - check against BASE branch
      if (file.createOnly) {
        const existsOnBase = await gitOps.fileExistsOnBranch(
          file.fileName,
          baseBranch
        );
        if (existsOnBase) {
          log.info(
            `Skipping ${file.fileName} (createOnly: exists on ${baseBranch})`
          );
          fileChanges.set(file.fileName, {
            fileName: file.fileName,
            content: null,
            action: "skip",
          });
          continue;
        }
      }

      log.info(`Writing ${file.fileName}...`);

      // Apply xfg templating if enabled
      let contentToWrite: ContentValue | null = file.content;
      if (file.template && contentToWrite !== null) {
        contentToWrite = interpolateXfgContent(
          contentToWrite,
          {
            repoInfo,
            fileName: file.fileName,
            vars: file.vars,
          },
          { strict: true }
        );
      }

      const fileContent = convertContentToString(
        contentToWrite,
        file.fileName,
        {
          header: file.header,
          schemaUrl: file.schemaUrl,
        }
      );

      // Determine action type (create vs update) BEFORE writing
      const action: "create" | "update" = fileExistsLocal ? "update" : "create";

      const existingContent = gitOps.getFileContent(file.fileName);
      const changed = gitOps.wouldChange(file.fileName, fileContent);

      const desiredMode: "100755" | "100644" = shouldBeExecutable(file)
        ? "100755"
        : "100644";
      const currentMode = await gitOps.getFileMode(file.fileName);
      modeCache.set(file.fileName, currentMode);
      const modeDiffers = currentMode !== null && currentMode !== desiredMode;

      if (changed) {
        const writeResult: FileWriteResult = {
          fileName: file.fileName,
          content: fileContent,
          action,
          ...(desiredMode === "100755" || modeDiffers
            ? { mode: desiredMode }
            : {}),
        };

        if (!isBinaryFile(file.fileName)) {
          writeResult.diffLines = computeUnifiedDiff(
            existingContent,
            fileContent
          );
        }

        fileChanges.set(file.fileName, writeResult);
      } else if (modeDiffers) {
        fileChanges.set(file.fileName, {
          fileName: file.fileName,
          content: null,
          action: "update",
          mode: desiredMode,
          modeOnly: true,
        });
      }

      if (dryRun) {
        if (changed) {
          const status = getFileStatus(existingContent !== null, changed);
          incrementDiffStats(diffStats, status);
          const diffLines = generateDiff(existingContent, fileContent);
          log.fileDiff(file.fileName, status, diffLines);
        } else if (modeDiffers) {
          incrementDiffStats(diffStats, "MODIFIED");
          log.info(
            `Would change mode: ${file.fileName} ${currentMode} -> ${desiredMode}`
          );
        }
      } else if (changed) {
        incrementDiffStats(diffStats, action === "create" ? "NEW" : "MODIFIED");
        gitOps.writeFile(file.fileName, fileContent);
      } else if (modeDiffers) {
        incrementDiffStats(diffStats, "MODIFIED");
      }
    }

    // Separate pass for executable permissions: git add must happen after file
    // content is written, and setExecutable needs the file to already be tracked.
    for (const file of files) {
      const tracked = fileChanges.get(file.fileName);
      if (tracked?.action === "skip") {
        continue;
      }

      const desired = shouldBeExecutable(file);
      const currentMode = modeCache.get(file.fileName) ?? null;

      if (desired && currentMode !== "100755") {
        log.info(
          ctx.dryRun
            ? `Would set executable: ${file.fileName}`
            : `Setting executable: ${file.fileName}`
        );
        await gitOps.setExecutable(file.fileName);
      } else if (!desired && currentMode === "100755") {
        log.info(
          ctx.dryRun
            ? `Would clear executable: ${file.fileName}`
            : `Clearing executable: ${file.fileName}`
        );
        await gitOps.clearExecutable(file.fileName);
      }
    }

    return { fileChanges, diffStats };
  }
}
