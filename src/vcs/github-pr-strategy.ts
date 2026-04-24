import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { escapeShellArg, escapeRegExp } from "../shared/shell-utils.js";
import { assertGitHubRepo, type GitHubRepoInfo } from "../repo/index.js";
import type { PRResult } from "./types.js";
import { BasePRStrategy } from "./pr-strategy.js";
import type {
  PRStrategyOptions,
  CloseExistingPROptions,
  ClosePRResult,
  MergeOptions,
  MergeResult,
} from "./types.js";
import { withRetry, isPermanentError } from "../shared/retry-utils.js";
import { sanitizeCredentials } from "../shared/sanitize-utils.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { safeCleanup } from "../shared/cleanup-utils.js";
import { NO_OP_DEBUG_LOG } from "../shared/logger.js";
import { getStderr } from "../shared/command-executor.js";
import type { MergeStrategy } from "../config/index.js";
import { buildTokenEnv, getHostnameFlag } from "../shared/gh-api-utils.js";
import { SyncError } from "../shared/errors.js";

/**
 * Get the repo flag value for gh CLI commands.
 * Returns HOST/OWNER/REPO for GHE, OWNER/REPO for github.com.
 */
function getRepoFlag(repoInfo: GitHubRepoInfo): string {
  if (repoInfo.host !== "github.com") {
    return `${repoInfo.host}/${repoInfo.owner}/${repoInfo.repo}`;
  }
  return `${repoInfo.owner}/${repoInfo.repo}`;
}

function buildPRUrlRegex(host: string): RegExp {
  const escapedHost = escapeRegExp(host);
  return new RegExp(`https://${escapedHost}/[\\w-]+/[\\w.-]+/pull/\\d+`);
}

export class GitHubPRStrategy extends BasePRStrategy {
  async findExistingPRUrl(
    options: CloseExistingPROptions
  ): Promise<string | null> {
    const { repoInfo, branchName, workDir, retries = 3, token } = options;

    assertGitHubRepo(repoInfo, "GitHub PR strategy");

    const repoFlag = getRepoFlag(repoInfo);
    const tokenEnv = buildTokenEnv(token);
    const command = `gh pr list --repo ${escapeShellArg(repoFlag)} --head ${escapeShellArg(branchName)} --json url --jq '.[0].url'`;

    try {
      const existingPR = await withRetry(
        () => this.executor.exec(command, workDir, { env: tokenEnv }),
        { retries, log: this.log }
      );

      return existingPR || null;
    } catch (error) {
      if (isPermanentError(error)) {
        throw error;
      }
      const stderr = getStderr(error);
      if (stderr && !stderr.includes("no pull requests match")) {
        this.log?.debug(
          `GitHub PR check failed - ${sanitizeCredentials(stderr).trim()}`
        );
      }
      return null;
    }
  }

  async closeExistingPR(
    options: CloseExistingPROptions
  ): Promise<ClosePRResult> {
    const {
      repoInfo,
      branchName,
      baseBranch,
      workDir,
      retries = 3,
      token,
    } = options;

    assertGitHubRepo(repoInfo, "GitHub PR strategy");

    const existingUrl = await this.findExistingPRUrl({
      repoInfo,
      branchName,
      baseBranch,
      workDir,
      retries,
      token,
    });

    if (!existingUrl) {
      return { status: "no_pr" };
    }

    const prNumber = existingUrl.match(/\/pull\/(\d+)/)?.[1];
    if (!prNumber) {
      return {
        status: "close_failed",
        message: `Could not extract PR number from URL: ${existingUrl}`,
      };
    }

    const repoFlag = getRepoFlag(repoInfo);
    const tokenEnv = buildTokenEnv(token);
    const command = `gh pr close ${escapeShellArg(prNumber)} --repo ${escapeShellArg(repoFlag)} --delete-branch`;

    try {
      await withRetry(
        () => this.executor.exec(command, workDir, { env: tokenEnv }),
        { retries, log: this.log }
      );
      return { status: "closed" };
    } catch (error) {
      const message = toErrorMessage(error);
      this.log?.warn(`Failed to close existing PR #${prNumber}: ${message}`);
      return { status: "close_failed", message };
    }
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
      token,
      labels,
    } = options;

    assertGitHubRepo(repoInfo, "GitHub PR strategy");

    const bodyFile = join(workDir, this.bodyFilePath);
    try {
      writeFileSync(bodyFile, body, "utf-8");
    } catch (err) {
      throw new SyncError(
        `Failed to write PR description to ${bodyFile}: ${toErrorMessage(err)}`
      );
    }

    const tokenEnv = buildTokenEnv(token);
    let command = `gh pr create --title ${escapeShellArg(title)} --body-file ${escapeShellArg(bodyFile)} --base ${escapeShellArg(baseBranch)} --head ${escapeShellArg(branchName)}`;

    // Append label flags
    if (labels && labels.length > 0) {
      for (const label of labels) {
        command += ` --label ${escapeShellArg(label)}`;
      }
    }

    try {
      const result = await withRetry(
        () => this.executor.exec(command, workDir, { env: tokenEnv }),
        { retries, log: this.log }
      );

      // Extract URL from output - use strict regex for valid PR URLs only
      const host = repoInfo.host;
      const urlRegex = buildPRUrlRegex(host);
      const urlMatch = result.match(urlRegex);

      if (!urlMatch) {
        throw new SyncError(`Could not parse PR URL from output: ${result}`);
      }

      return {
        url: urlMatch[0],
        success: true,
        message: "PR created successfully",
      };
    } finally {
      safeCleanup(
        () => {
          if (existsSync(bodyFile)) unlinkSync(bodyFile);
        },
        `failed to remove ${bodyFile}`,
        this.log ?? NO_OP_DEBUG_LOG
      );
    }
  }

  /**
   * Check if auto-merge is enabled on the repository.
   */
  private async checkAutoMergeEnabled(
    repoInfo: GitHubRepoInfo,
    workDir: string,
    retries: number = 3,
    token?: string
  ): Promise<boolean> {
    const hostnameFlag = getHostnameFlag(repoInfo);
    const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
    const tokenEnv = buildTokenEnv(token);
    const command = `gh api ${hostnamePart}repos/${escapeShellArg(repoInfo.owner)}/${escapeShellArg(repoInfo.repo)} --jq '.allow_auto_merge // false'`;

    try {
      const result = await withRetry(
        () => this.executor.exec(command, workDir, { env: tokenEnv }),
        { retries, log: this.log }
      );
      return result.trim() === "true";
    } catch (error) {
      if (isPermanentError(error)) {
        throw error;
      }
      // If we can't check due to transient errors, assume auto-merge is not enabled
      this.log?.warn(
        `Could not check auto-merge status: ${toErrorMessage(error)}`
      );
      return false;
    }
  }

  private getMergeStrategyFlag(strategy?: MergeStrategy): string {
    switch (strategy) {
      case "squash":
        return "--squash";
      case "rebase":
        return "--rebase";
      case "merge":
      default:
        return "--merge";
    }
  }

  async merge(options: MergeOptions): Promise<MergeResult> {
    const { prUrl, repoInfo, config, workDir, retries = 3, token } = options;

    if (config.mode === "manual") {
      return {
        success: true,
        message: "PR left open for manual review",
        merged: false,
      };
    }

    const strategyFlag = this.getMergeStrategyFlag(config.strategy);
    const deleteBranchFlag = config.deleteBranch ? "--delete-branch" : "";
    const tokenEnv = buildTokenEnv(token);

    if (config.mode === "auto") {
      // Check if auto-merge is enabled on the repo
      assertGitHubRepo(repoInfo, "GitHub PR strategy");
      const autoMergeEnabled = await this.checkAutoMergeEnabled(
        repoInfo,
        workDir,
        retries,
        token
      );

      if (!autoMergeEnabled) {
        this.log?.warn(
          `Auto-merge not enabled for '${repoInfo.owner}/${repoInfo.repo}'. PR left open for manual review.`
        );
        this.log?.info(
          `To enable: gh repo edit ${getRepoFlag(repoInfo)} --enable-auto-merge (requires admin)`
        );
        return {
          success: true,
          message: `Auto-merge not enabled for repository. PR left open for manual review.`,
          merged: false,
          autoMergeEnabled: false,
        };
      }

      // Enable auto-merge
      const autoCommand =
        `gh pr merge ${escapeShellArg(prUrl)} --auto ${strategyFlag} ${deleteBranchFlag}`.trim();

      return this.executeMergeCommand(
        () => this.executor.exec(autoCommand, workDir, { env: tokenEnv }),
        retries,
        {
          success: true,
          message: "Auto-merge enabled. PR will merge when checks pass.",
          merged: false,
          autoMergeEnabled: true,
        },
        "Failed to enable auto-merge"
      );
    }

    if (config.mode === "force") {
      this.log?.warn(
        `Force-merging PR ${prUrl} using admin privileges (bypasses branch protection)`
      );
      const forceCommand =
        `gh pr merge ${escapeShellArg(prUrl)} --admin ${strategyFlag} ${deleteBranchFlag}`.trim();

      return this.executeMergeCommand(
        () => this.executor.exec(forceCommand, workDir, { env: tokenEnv }),
        retries,
        {
          success: true,
          message: "PR merged successfully using admin privileges.",
          merged: true,
        },
        "Failed to force merge"
      );
    }

    // "direct" mode doesn't create PRs, so merge() should not be called for it.
    // This is a defensive fallback for type safety.
    const _exhaustive: "direct" = config.mode;
    return {
      success: false,
      message: `Merge not applicable for mode: ${_exhaustive}`,
      merged: false,
    };
  }
}
