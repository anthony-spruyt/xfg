import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FileContent, ContentValue } from "../config/types.js";
import { convertContentToString } from "../config/formatter.js";
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

      if (changed) {
        const writeResult: FileWriteResult = {
          fileName: file.fileName,
          content: fileContent,
          action,
        };

        // Compute raw diff lines for text files (all modes)
        if (!isBinaryFile(file.fileName)) {
          writeResult.diffLines = computeUnifiedDiff(
            existingContent,
            fileContent
          );
        }

        fileChanges.set(file.fileName, writeResult);
      }

      if (dryRun) {
        const status = getFileStatus(existingContent !== null, changed);
        incrementDiffStats(diffStats, status);

        const diffLines = generateDiff(existingContent, fileContent);
        log.fileDiff(file.fileName, status, diffLines);
      } else if (changed) {
        incrementDiffStats(diffStats, action === "create" ? "NEW" : "MODIFIED");
        gitOps.writeFile(file.fileName, fileContent);
      }
    }

    for (const file of files) {
      const tracked = fileChanges.get(file.fileName);
      if (tracked?.action === "skip") {
        continue;
      }

      if (shouldBeExecutable(file)) {
        if (tracked?.action === "create" && ctx.hasAppCredentials) {
          log.warn(
            `${file.fileName}: GitHub App commits cannot set executable mode on new files. ` +
              `The file will be created as non-executable (100644). ` +
              `See: https://anthony-spruyt.github.io/xfg/examples/executable-files/`
          );
        }
        log.info(`Setting executable: ${file.fileName}`);
        await gitOps.setExecutable(file.fileName);
      }
    }

    return { fileChanges, diffStats };
  }
}
