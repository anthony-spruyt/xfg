import { assertGitLabRepo, type GitLabRepoInfo } from "../../repo/index.js";
import type { PRResult } from "../types.js";
import { BasePRStrategy } from "./pr-strategy.js";
import type {
  PRStrategyOptions,
  CloseExistingPROptions,
  ClosePRResult,
  MergeOptions,
  MergeResult,
} from "../types.js";
import { withRetry, isPermanentError } from "../../shared/retry-utils.js";
import { getStderr } from "../../shared/command-executor.js";
import { parseApiJson } from "../../shared/json-utils.js";
import { sanitizeCredentials } from "../../shared/sanitize-utils.js";
import { toErrorMessage } from "../../shared/type-guards.js";
import type { MergeStrategy } from "../../config/index.js";
import { SyncError } from "../../shared/errors.js";

const MR_CREATED_MSG = "MR created successfully";

export class GitLabPRStrategy extends BasePRStrategy {
  /**
   * Build the repo flag for glab commands.
   * Format: namespace/repo (supports nested groups)
   */
  private buildRepoFlag(repoInfo: GitLabRepoInfo): string {
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
  private buildMergeStrategyFlag(strategy?: MergeStrategy): string {
    switch (strategy) {
      case "squash":
        return "--squash";
      case "rebase":
        return "--rebase";
      case "merge":
      case undefined:
        return "";
      /* c8 ignore next 4 */
      default: {
        const _exhaustive: never = strategy;
        throw new Error(`Unexpected merge strategy: ${_exhaustive}`);
      }
    }
  }

  async findExistingPRUrl(
    options: CloseExistingPROptions
  ): Promise<string | null> {
    const { repoInfo, branchName, workDir, retries = 3 } = options;

    assertGitLabRepo(repoInfo, "GitLab PR strategy");

    const repoFlag = this.buildRepoFlag(repoInfo);
    try {
      const result = await withRetry(
        () =>
          this.executor.exec(
            "glab",
            [
              "mr",
              "list",
              "--source-branch",
              branchName,
              "-R",
              repoFlag,
              "-F",
              "json",
            ],
            workDir
          ),
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
      if (isPermanentError(error)) {
        throw error;
      }
      const stderr = getStderr(error);
      if (stderr && !stderr.includes("no merge requests")) {
        this.log?.debug(
          `GitLab MR check failed - ${sanitizeCredentials(stderr).trim()}`
        );
      }
      return null;
    }
  }

  async closeExistingPR(
    options: CloseExistingPROptions
  ): Promise<ClosePRResult> {
    const { repoInfo, branchName, baseBranch, workDir, retries = 3 } = options;

    assertGitLabRepo(repoInfo, "GitLab PR strategy");

    const existingUrl = await this.findExistingPRUrl({
      repoInfo,
      branchName,
      baseBranch,
      workDir,
      retries,
    });

    if (!existingUrl) {
      return { status: "no_pr" };
    }

    const mrInfo = this.parseMRUrl(existingUrl);
    if (!mrInfo) {
      return {
        status: "close_failed",
        message: `Could not extract MR IID from URL: ${existingUrl}`,
      };
    }

    const repoFlag = this.buildRepoFlag(repoInfo);

    try {
      await withRetry(
        () =>
          this.executor.exec(
            "glab",
            ["mr", "close", mrInfo.mrIid, "-R", repoFlag],
            workDir
          ),
        { retries, log: this.log }
      );
    } catch (error) {
      const message = toErrorMessage(error);
      this.log?.warn(
        `Failed to close existing MR !${mrInfo.mrIid}: ${message}`
      );
      return { status: "close_failed", message };
    }

    try {
      await withRetry(
        () =>
          this.executor.exec(
            "git",
            ["push", "origin", "--delete", branchName],
            workDir
          ),
        { retries, log: this.log }
      );
    } catch (error) {
      const message = `MR !${mrInfo.mrIid} closed but branch ${branchName} deletion failed: ${toErrorMessage(error)}`;
      this.log?.warn(message);
      return { status: "close_failed", message };
    }

    return { status: "closed" };
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

    const repoFlag = this.buildRepoFlag(repoInfo);

    const args = [
      "mr",
      "create",
      "--source-branch",
      branchName,
      "--target-branch",
      baseBranch,
      "--title",
      title,
      "--description",
      body,
      "--yes",
      "-R",
      repoFlag,
    ];

    const result = await withRetry(
      () => this.executor.exec("glab", args, workDir),
      { retries, log: this.log }
    );

    // Extract MR URL from output
    // glab typically outputs the URL directly
    const urlMatch = result.match(/https:\/\/[^\s]+\/-\/merge_requests\/\d+/);
    if (urlMatch) {
      return {
        url: urlMatch[0],
        success: true,
        message: MR_CREATED_MSG,
      };
    }

    // Fallback: extract MR number and build URL
    const mrMatch = result.match(/!(\d+)/);
    if (mrMatch) {
      return {
        url: this.buildMRUrl(repoInfo, mrMatch[1]),
        success: true,
        message: MR_CREATED_MSG,
      };
    }

    throw new SyncError(`Could not parse MR URL from output: ${result}`);
  }

  async merge(options: MergeOptions): Promise<MergeResult> {
    const { prUrl, config, workDir, retries = 3 } = options;

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
    const strategyFlag = this.buildMergeStrategyFlag(config.strategy);

    if (config.mode === "auto") {
      const args = [
        "mr",
        "merge",
        mrInfo.mrIid,
        "--when-pipeline-succeeds",
        ...(strategyFlag ? [strategyFlag] : []),
        ...(config.deleteBranch ? ["--remove-source-branch"] : []),
        "-R",
        repoFlag,
        "-y",
      ];
      return this.executeMergeCommand(
        () => this.executor.exec("glab", args, workDir),
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
      this.log?.warn(
        `Force-merging MR ${mrInfo.mrIid} immediately (bypasses pipeline requirements)`
      );
      const args = [
        "mr",
        "merge",
        mrInfo.mrIid,
        ...(strategyFlag ? [strategyFlag] : []),
        ...(config.deleteBranch ? ["--remove-source-branch"] : []),
        "-R",
        repoFlag,
        "-y",
      ];
      return this.executeMergeCommand(
        () => this.executor.exec("glab", args, workDir),
        retries,
        {
          success: true,
          message: "MR merged successfully.",
          merged: true,
        },
        "Failed to force merge"
      );
    }

    const _exhaustive: "direct" = config.mode;
    return {
      success: false,
      message: `Merge not applicable for mode: ${_exhaustive}`,
      merged: false,
    };
  }
}
