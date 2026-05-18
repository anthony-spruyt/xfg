import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  convertContentToString,
  type FileContent,
  type ContentValue,
} from "../../config/index.js";
import { interpolateXfgContent } from "../../shared/xfg-template.js";
import { formatDiffLine } from "../../shared/diff-format.js";
import {
  createDiffStats,
  incrementDiffStats,
  computeUnifiedDiff,
  isBinaryFile,
  type FileStatus,
  type DiffStats,
} from "../diff/index.js";
import type {
  IFileWriter,
  FileWriteContext,
  FileWriterDeps,
  FileWriteAllResult,
  FileWriteResult,
} from "../types.js";

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
    const fileChanges = new Map<string, FileWriteResult>();
    const diffStats = createDiffStats();
    const modeCache = new Map<string, "100755" | "100644" | null>();

    for (const file of files) {
      await this.processOneFile(
        file,
        ctx,
        deps,
        fileChanges,
        diffStats,
        modeCache
      );
    }

    await this.applyExecutablePermissions(
      files,
      fileChanges,
      modeCache,
      ctx,
      deps
    );

    return { fileChanges, diffStats };
  }

  private async processOneFile(
    file: FileContent,
    ctx: FileWriteContext,
    deps: FileWriterDeps,
    fileChanges: Map<string, FileWriteResult>,
    diffStats: DiffStats,
    modeCache: Map<string, "100755" | "100644" | null>
  ): Promise<void> {
    const { repoInfo, baseBranch, workDir, dryRun } = ctx;
    const { gitOps, log } = deps;

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
        return;
      }
    }

    log.info(`Writing ${file.fileName}...`);

    // --- Phase 1: Compute what changed ---
    const fileContent = this.resolveContent(file, repoInfo);
    const fileExistsLocal = existsSync(join(workDir, file.fileName));
    const action: "create" | "update" = fileExistsLocal ? "update" : "create";
    const existingContent = gitOps.getFileContent(file.fileName);
    const contentChanged = gitOps.wouldChange(file.fileName, fileContent);

    const desiredMode: "100755" | "100644" = shouldBeExecutable(file)
      ? "100755"
      : "100644";
    const currentMode = await gitOps.getFileMode(file.fileName);
    modeCache.set(file.fileName, currentMode);
    const modeChanged = currentMode !== null && currentMode !== desiredMode;

    if (!contentChanged && !modeChanged) {
      return;
    }

    // --- Phase 2: Build the write result ---
    const writeResult = this.buildWriteResult(
      file,
      fileContent,
      existingContent,
      action,
      contentChanged,
      modeChanged,
      desiredMode
    );
    fileChanges.set(file.fileName, writeResult);

    // --- Phase 3: Track stats and apply or report ---
    const status: FileStatus = contentChanged
      ? action === "create"
        ? "NEW"
        : "MODIFIED"
      : "MODIFIED"; // mode-only changes are always MODIFIED
    incrementDiffStats(diffStats, status);

    if (contentChanged) {
      if (dryRun) {
        const formattedDiff = (writeResult.diffLines ?? []).map(formatDiffLine);
        log.fileDiff(file.fileName, status, formattedDiff);
      } else {
        gitOps.writeFile(file.fileName, fileContent);
      }
    } else if (dryRun) {
      log.info(
        `Would change mode: ${file.fileName} ${currentMode} -> ${desiredMode}`
      );
    }
  }

  private buildWriteResult(
    file: FileContent,
    fileContent: string,
    existingContent: string | null,
    action: "create" | "update",
    contentChanged: boolean,
    modeChanged: boolean,
    desiredMode: "100755" | "100644"
  ): FileWriteResult {
    if (!contentChanged) {
      // Mode-only change
      return {
        fileName: file.fileName,
        content: null,
        action: "update",
        mode: desiredMode,
        modeOnly: true,
      };
    }

    const result: FileWriteResult = {
      fileName: file.fileName,
      content: fileContent,
      action,
      ...(desiredMode === "100755" || modeChanged ? { mode: desiredMode } : {}),
    };

    if (!isBinaryFile(file.fileName)) {
      result.diffLines = computeUnifiedDiff(existingContent, fileContent);
    }

    return result;
  }

  private resolveContent(
    file: FileContent,
    repoInfo: FileWriteContext["repoInfo"]
  ): string {
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

    return convertContentToString(contentToWrite, file.fileName, {
      header: file.header,
      schemaUrl: file.schemaUrl,
    });
  }

  private async applyExecutablePermissions(
    files: FileContent[],
    fileChanges: Map<string, FileWriteResult>,
    modeCache: Map<string, "100755" | "100644" | null>,
    ctx: FileWriteContext,
    deps: FileWriterDeps
  ): Promise<void> {
    for (const file of files) {
      const tracked = fileChanges.get(file.fileName);
      if (tracked?.action === "skip") {
        continue;
      }

      const desired = shouldBeExecutable(file);
      const currentMode = modeCache.get(file.fileName) ?? null;

      if (desired && currentMode !== "100755") {
        deps.log.info(
          ctx.dryRun
            ? `Would set executable: ${file.fileName}`
            : `Setting executable: ${file.fileName}`
        );
        await deps.gitOps.setExecutable(file.fileName);
      } else if (!desired && currentMode === "100755") {
        deps.log.info(
          ctx.dryRun
            ? `Would clear executable: ${file.fileName}`
            : `Clearing executable: ${file.fileName}`
        );
        await deps.gitOps.clearExecutable(file.fileName);
      }
    }
  }
}
