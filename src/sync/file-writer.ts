import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FileContent, ContentValue } from "../config/types.js";
import { convertContentToString } from "../config/formatter.js";
import { interpolateXfgContent } from "./xfg-template.js";
import {
  getFileStatus,
  generateDiff,
  createDiffStats,
  incrementDiffStats,
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
export function shouldBeExecutable(file: FileContent): boolean {
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

    // Step 1: Process each file
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

      // Check if file would change
      const existingContent = gitOps.getFileContent(file.fileName);
      const changed = gitOps.wouldChange(file.fileName, fileContent);

      if (changed) {
        fileChanges.set(file.fileName, {
          fileName: file.fileName,
          content: fileContent,
          action,
        });
      }

      if (dryRun) {
        // In dry-run, show diff but don't write
        const status = getFileStatus(existingContent !== null, changed);
        incrementDiffStats(diffStats, status);

        const diffLines = generateDiff(
          existingContent,
          fileContent,
          file.fileName
        );
        log.fileDiff(file.fileName, status, diffLines);
      } else {
        // Write the file
        gitOps.writeFile(file.fileName, fileContent);
      }
    }

    // Step 2: Set executable permissions (skip skipped files)
    for (const file of files) {
      const tracked = fileChanges.get(file.fileName);
      if (tracked?.action === "skip") {
        continue;
      }

      if (shouldBeExecutable(file)) {
        log.info(`Setting executable: ${file.fileName}`);
        await gitOps.setExecutable(file.fileName);
      }
    }

    return { fileChanges, diffStats };
  }
}
