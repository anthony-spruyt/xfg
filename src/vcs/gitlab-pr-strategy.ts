import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { escapeShellArg } from "../shared/shell-utils.js";
import { assertGitLabRepo, GitLabRepoInfo } from "../shared/repo-detector.js";
import type { PRResult } from "./types.js";
import { BasePRStrategy } from "./pr-strategy.js";
import type { IPRStrategyLogger } from "./pr-strategy.js";
import type {
  PRStrategyOptions,
  CloseExistingPROptions,
  MergeOptions,
  MergeResult,
} from "./types.js";
import { withRetry } from "../shared/retry-utils.js";
import { ICommandExecutor, getStderr } from "../shared/command-executor.js";
import { parseApiJson } from "../shared/gh-api-utils.js";
import { sanitizeCredentials } from "../shared/sanitize-utils.js";
import { toErrorMessage, safeCleanup } from "../shared/type-guards.js";
import type { MergeStrategy } from "../config/index.js";

export class GitLabPRStrategy extends BasePRStrategy {
  constructor(executor?: ICommandExecutor, log?: IPRStrategyLogger) {
    super(executor, log);
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

  async checkExistingPR(
    options: CloseExistingPROptions
  ): Promise<string | null> {
    const { repoInfo, branchName, workDir, retries = 3 } = options;

    assertGitLabRepo(repoInfo, "GitLab PR strategy");

    const repoFlag = this.getRepoFlag(repoInfo);
    // Use glab mr list with JSON output for reliable parsing
    // Note: glab mr list returns open MRs by default (use -c for closed, -M for merged)
    const command = `glab mr list --source-branch ${escapeShellArg(branchName)} -R ${escapeShellArg(repoFlag)} -F json`;

    try {
      const result = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries, log: this.log }
      );

      if (!result || result.trim() === "" || result.trim() === "[]") {
        return null;
      }

      const mrs = parseApiJson<Array<{ iid?: number }>>(result, "glab mr list");
      if (Array.isArray(mrs) && mrs.length > 0 && mrs[0].iid) {
        return this.buildMRUrl(repoInfo, String(mrs[0].iid));
      }
      return null;
    } catch (error) {
      const stderr = getStderr(error);
      if (stderr && !stderr.includes("no merge requests")) {
        this.log?.debug(
          `GitLab MR check failed - ${sanitizeCredentials(stderr).trim()}`
        );
      }
      return null;
    }
  }

  async closeExistingPR(options: CloseExistingPROptions): Promise<boolean> {
    const { repoInfo, branchName, baseBranch, workDir, retries = 3 } = options;

    assertGitLabRepo(repoInfo, "GitLab PR strategy");

    // First check if there's an existing MR
    const existingUrl = await this.checkExistingPR({
      repoInfo,
      branchName,
      baseBranch,
      workDir,
      retries,
    });

    if (!existingUrl) {
      return false;
    }

    // Extract MR IID from URL
    const mrInfo = this.parseMRUrl(existingUrl);
    if (!mrInfo) {
      this.log?.warn(`Could not extract MR IID from URL: ${existingUrl}`);
      return false;
    }

    const repoFlag = this.getRepoFlag(repoInfo);

    // Close the MR
    const closeCommand = `glab mr close ${escapeShellArg(mrInfo.mrIid)} -R ${escapeShellArg(repoFlag)}`;

    try {
      await withRetry(() => this.executor.exec(closeCommand, workDir), {
        retries,
        log: this.log,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      this.log?.warn(
        `Failed to close existing MR !${mrInfo.mrIid}: ${message}`
      );
      return false;
    }

    const deleteBranchCommand = `git push origin --delete ${escapeShellArg(branchName)}`;

    try {
      await withRetry(() => this.executor.exec(deleteBranchCommand, workDir), {
        retries,
        log: this.log,
      });
    } catch (error) {
      // Branch deletion failure is not critical
      const message = toErrorMessage(error);
      this.log?.warn(`Failed to delete branch ${branchName}: ${message}`);
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

    assertGitLabRepo(repoInfo, "GitLab PR strategy");

    const repoFlag = this.getRepoFlag(repoInfo);

    const descFile = join(workDir, this.bodyFilePath);
    writeFileSync(descFile, body, "utf-8");

    // glab mr create with description from file
    const command = `glab mr create --source-branch ${escapeShellArg(branchName)} --target-branch ${escapeShellArg(baseBranch)} --title ${escapeShellArg(title)} --description "$(cat ${escapeShellArg(descFile)})" --yes -R ${escapeShellArg(repoFlag)}`;

    try {
      const result = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries, log: this.log }
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
      safeCleanup(
        () => {
          if (existsSync(descFile)) unlinkSync(descFile);
        },
        `failed to remove ${descFile}`,
        this.log ?? { debug() {} }
      );
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
      const autoFlagParts = [
        "--when-pipeline-succeeds",
        strategyFlag,
        deleteBranchFlag,
      ].filter(Boolean);
      const autoCommand = `glab mr merge ${escapeShellArg(mrInfo.mrIid)} ${autoFlagParts.join(" ")} -R ${escapeShellArg(repoFlag)} -y`;

      return this.executeMergeCommand(
        () => this.executor.exec(autoCommand.trim(), workDir),
        retries,
        {
          success: true,
          message: "Auto-merge enabled. MR will merge when pipeline succeeds.",
          merged: false,
          autoMergeEnabled: true,
        },
        "Failed to enable auto-merge"
      );
    }

    if (config.mode === "force") {
      // Force merge immediately
      const forceFlagParts = [strategyFlag, deleteBranchFlag].filter(Boolean);
      const forceCommand = `glab mr merge ${escapeShellArg(mrInfo.mrIid)} ${forceFlagParts.join(" ")} -R ${escapeShellArg(repoFlag)} -y`;

      return this.executeMergeCommand(
        () => this.executor.exec(forceCommand.trim(), workDir),
        retries,
        {
          success: true,
          message: "MR merged successfully.",
          merged: true,
        },
        "Failed to force merge"
      );
    }

    return {
      success: false,
      message: `Unknown merge mode: ${config.mode}`,
      merged: false,
    };
  }
}
