import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { escapeShellArg } from "../shared/shell-utils.js";
import { isGitLabRepo, GitLabRepoInfo } from "../shared/repo-detector.js";
import { PRResult } from "./pr-creator.js";
import {
  BasePRStrategy,
  PRStrategyOptions,
  CloseExistingPROptions,
  MergeOptions,
  MergeResult,
} from "./pr-strategy.js";
import { logger } from "../shared/logger.js";
import { withRetry, isPermanentError } from "../shared/retry-utils.js";
import { ICommandExecutor } from "../shared/command-executor.js";
import { sanitizeCredentials } from "../shared/sanitize-utils.js";
import type { MergeStrategy } from "../config/index.js";

export class GitLabPRStrategy extends BasePRStrategy {
  constructor(executor?: ICommandExecutor) {
    super(executor);
    this.bodyFilePath = ".mr-description.md";
  }

  /**
   * Build the repo flag for glab commands.
   * Format: namespace/repo (supports nested groups)
   */
  private getRepoFlag(repoInfo: GitLabRepoInfo): string {
    return `${repoInfo.namespace}/${repoInfo.repo}`;
  }

  /**
   * Build the MR URL from repo info and MR IID.
   */
  private buildMRUrl(repoInfo: GitLabRepoInfo, mrIid: string): string {
    return `https://${repoInfo.host}/${repoInfo.namespace}/${repoInfo.repo}/-/merge_requests/${mrIid}`;
  }

  /**
   * Parse MR URL to extract components.
   */
  private parseMRUrl(
    mrUrl: string
  ): { host: string; namespace: string; repo: string; mrIid: string } | null {
    // URL format: https://gitlab.com/namespace/repo/-/merge_requests/123
    // Nested: https://gitlab.com/org/group/subgroup/repo/-/merge_requests/123
    // Use specific path segment pattern to avoid ReDoS (polynomial regex)
    // Pattern: protocol://host/path-segments/-/merge_requests/id
    const match = mrUrl.match(
      /https?:\/\/([^/]+)\/((?:[^/]+\/)*[^/]+)\/-\/merge_requests\/(\d+)/
    );
    if (!match) return null;

    const host = match[1];
    const fullPath = match[2];
    const mrIid = match[3];

    // Split path to get namespace and repo
    const segments = fullPath.split("/");
    if (segments.length < 2) return null;

    const repo = segments[segments.length - 1];
    const namespace = segments.slice(0, -1).join("/");

    return { host, namespace, repo, mrIid };
  }

  /**
   * Build merge strategy flags for glab mr merge command.
   */
  private getMergeStrategyFlag(strategy?: MergeStrategy): string {
    switch (strategy) {
      case "squash":
        return "--squash";
      case "rebase":
        return "--rebase";
      case "merge":
      default:
        return "";
    }
  }

  async checkExistingPR(options: PRStrategyOptions): Promise<string | null> {
    const { repoInfo, branchName, workDir, retries = 3 } = options;

    if (!isGitLabRepo(repoInfo)) {
      throw new Error("Expected GitLab repository");
    }

    const repoFlag = this.getRepoFlag(repoInfo);
    // Use glab mr list with JSON output for reliable parsing
    // Note: glab mr list returns open MRs by default (use -c for closed, -M for merged)
    const command = `glab mr list --source-branch ${escapeShellArg(branchName)} -R ${escapeShellArg(repoFlag)} -F json`;

    try {
      const result = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries }
      );

      if (!result || result.trim() === "" || result.trim() === "[]") {
        return null;
      }

      // Parse JSON to get MR IID
      const mrs = JSON.parse(result);
      if (Array.isArray(mrs) && mrs.length > 0 && mrs[0].iid) {
        return this.buildMRUrl(repoInfo, String(mrs[0].iid));
      }
      return null;
    } catch (error) {
      if (error instanceof Error) {
        // Throw on permanent errors (auth failures, etc.)
        if (isPermanentError(error)) {
          throw error;
        }
        // Log unexpected errors for debugging
        const stderr = (error as { stderr?: string }).stderr ?? "";
        if (stderr && !stderr.includes("no merge requests")) {
          logger.info(
            `Debug: GitLab MR check failed - ${sanitizeCredentials(stderr).trim()}`
          );
        }
      }
      return null;
    }
  }

  async closeExistingPR(options: CloseExistingPROptions): Promise<boolean> {
    const { repoInfo, branchName, baseBranch, workDir, retries = 3 } = options;

    if (!isGitLabRepo(repoInfo)) {
      throw new Error("Expected GitLab repository");
    }

    // First check if there's an existing MR
    const existingUrl = await this.checkExistingPR({
      repoInfo,
      branchName,
      baseBranch,
      workDir,
      retries,
      title: "", // Not used for check
      body: "", // Not used for check
    });

    if (!existingUrl) {
      return false;
    }

    // Extract MR IID from URL
    const mrInfo = this.parseMRUrl(existingUrl);
    if (!mrInfo) {
      throw new Error(`Could not extract MR IID from URL: ${existingUrl}`);
    }

    const repoFlag = this.getRepoFlag(repoInfo);

    // Close the MR
    const closeCommand = `glab mr close ${escapeShellArg(mrInfo.mrIid)} -R ${escapeShellArg(repoFlag)}`;

    try {
      await withRetry(() => this.executor.exec(closeCommand, workDir), {
        retries,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.info(
        `Warning: Failed to close existing MR !${mrInfo.mrIid}: ${message}`
      );
      return false;
    }

    // Delete the source branch via git
    const deleteBranchCommand = `git push origin --delete ${escapeShellArg(branchName)}`;

    try {
      await withRetry(() => this.executor.exec(deleteBranchCommand, workDir), {
        retries,
      });
    } catch (error) {
      // Branch deletion failure is not critical
      const message = error instanceof Error ? error.message : String(error);
      logger.info(`Warning: Failed to delete branch ${branchName}: ${message}`);
    }

    return true;
  }

  async create(options: PRStrategyOptions): Promise<PRResult> {
    const {
      repoInfo,
      title,
      body,
      branchName,
      baseBranch,
      workDir,
      retries = 3,
    } = options;

    if (!isGitLabRepo(repoInfo)) {
      throw new Error("Expected GitLab repository");
    }

    const repoFlag = this.getRepoFlag(repoInfo);

    // Write description to temp file to avoid shell escaping issues
    const descFile = join(workDir, this.bodyFilePath);
    writeFileSync(descFile, body, "utf-8");

    // glab mr create with description from file
    const command = `glab mr create --source-branch ${escapeShellArg(branchName)} --target-branch ${escapeShellArg(baseBranch)} --title ${escapeShellArg(title)} --description "$(cat ${escapeShellArg(descFile)})" --yes -R ${escapeShellArg(repoFlag)}`;

    try {
      const result = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries }
      );

      // Extract MR URL from output
      // glab typically outputs the URL directly
      const urlMatch = result.match(/https:\/\/[^\s]+\/-\/merge_requests\/\d+/);
      if (urlMatch) {
        return {
          url: urlMatch[0],
          success: true,
          message: "MR created successfully",
        };
      }

      // Fallback: extract MR number and build URL
      const mrMatch = result.match(/!(\d+)/);
      if (mrMatch) {
        return {
          url: this.buildMRUrl(repoInfo, mrMatch[1]),
          success: true,
          message: "MR created successfully",
        };
      }

      throw new Error(`Could not parse MR URL from output: ${result}`);
    } finally {
      // Clean up temp file - log warning on failure instead of throwing
      try {
        if (existsSync(descFile)) {
          unlinkSync(descFile);
        }
      } catch (cleanupError) {
        logger.info(
          `Warning: Failed to clean up temp file ${descFile}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        );
      }
    }
  }

  async merge(options: MergeOptions): Promise<MergeResult> {
    const { prUrl, config, workDir, retries = 3 } = options;

    // Manual mode: do nothing
    if (config.mode === "manual") {
      return {
        success: true,
        message: "MR left open for manual review",
        merged: false,
      };
    }

    // Parse MR URL to extract details
    const mrInfo = this.parseMRUrl(prUrl);
    if (!mrInfo) {
      return {
        success: false,
        message: `Invalid GitLab MR URL: ${prUrl}`,
        merged: false,
      };
    }

    const repoFlag = `${mrInfo.namespace}/${mrInfo.repo}`;
    const strategyFlag = this.getMergeStrategyFlag(config.strategy);
    const deleteBranchFlag = config.deleteBranch
      ? "--remove-source-branch"
      : "";

    if (config.mode === "auto") {
      // Enable auto-merge when pipeline succeeds
      // glab mr merge <id> --when-pipeline-succeeds [--squash] [--remove-source-branch]
      const flagParts = [
        "--when-pipeline-succeeds",
        strategyFlag,
        deleteBranchFlag,
      ].filter(Boolean);
      const command = `glab mr merge ${escapeShellArg(mrInfo.mrIid)} ${flagParts.join(" ")} -R ${escapeShellArg(repoFlag)} -y`;

      try {
        await withRetry(() => this.executor.exec(command.trim(), workDir), {
          retries,
        });

        return {
          success: true,
          message: "Auto-merge enabled. MR will merge when pipeline succeeds.",
          merged: false,
          autoMergeEnabled: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Failed to enable auto-merge: ${message}`,
          merged: false,
        };
      }
    }

    if (config.mode === "force") {
      // Force merge immediately
      // glab mr merge <id> --yes [--squash] [--remove-source-branch]
      const flagParts = [strategyFlag, deleteBranchFlag].filter(Boolean);
      const command = `glab mr merge ${escapeShellArg(mrInfo.mrIid)} ${flagParts.join(" ")} -R ${escapeShellArg(repoFlag)} -y`;

      try {
        await withRetry(() => this.executor.exec(command.trim(), workDir), {
          retries,
        });

        return {
          success: true,
          message: "MR merged successfully.",
          merged: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Failed to force merge: ${message}`,
          merged: false,
        };
      }
    }

    return {
      success: false,
      message: `Unknown merge mode: ${config.mode}`,
      merged: false,
    };
  }
}
