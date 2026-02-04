import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { escapeShellArg } from "../shell-utils.js";
import { isGitHubRepo, GitHubRepoInfo } from "../repo-detector.js";
import { PRResult } from "../pr-creator.js";
import {
  BasePRStrategy,
  PRStrategyOptions,
  CloseExistingPROptions,
  MergeOptions,
  MergeResult,
} from "./pr-strategy.js";
import { logger } from "../logger.js";
import { withRetry, isPermanentError } from "../retry-utils.js";
import { sanitizeCredentials } from "../sanitize-utils.js";
import type { MergeStrategy } from "../config.js";

/**
 * Get the repo flag value for gh CLI commands.
 * Returns HOST/OWNER/REPO for GHE, OWNER/REPO for github.com.
 */
function getRepoFlag(repoInfo: GitHubRepoInfo): string {
  if (repoInfo.host && repoInfo.host !== "github.com") {
    return `${repoInfo.host}/${repoInfo.owner}/${repoInfo.repo}`;
  }
  return `${repoInfo.owner}/${repoInfo.repo}`;
}

/**
 * Get the hostname flag for gh api commands.
 * Returns "--hostname HOST" for GHE, empty string for github.com.
 */
function getHostnameFlag(repoInfo: GitHubRepoInfo): string {
  if (repoInfo.host && repoInfo.host !== "github.com") {
    return `--hostname ${escapeShellArg(repoInfo.host)}`;
  }
  return "";
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build regex to match PR URLs for the given host.
 */
function buildPRUrlRegex(host: string): RegExp {
  const escapedHost = escapeRegExp(host);
  return new RegExp(`https://${escapedHost}/[\\w-]+/[\\w.-]+/pull/\\d+`);
}

/**
 * Build the GH_TOKEN environment prefix for commands if a token is provided.
 */
function buildTokenPrefix(token?: string): string {
  return token ? `GH_TOKEN=${token} ` : "";
}

export class GitHubPRStrategy extends BasePRStrategy {
  async checkExistingPR(options: PRStrategyOptions): Promise<string | null> {
    const { repoInfo, branchName, workDir, retries = 3, token } = options;

    if (!isGitHubRepo(repoInfo)) {
      throw new Error("Expected GitHub repository");
    }

    const repoFlag = getRepoFlag(repoInfo);
    const tokenPrefix = buildTokenPrefix(token);
    const command = `${tokenPrefix}gh pr list --repo ${escapeShellArg(repoFlag)} --head ${escapeShellArg(branchName)} --json url --jq '.[0].url'`;

    try {
      const existingPR = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries }
      );

      return existingPR || null;
    } catch (error) {
      if (error instanceof Error) {
        // Throw on permanent errors (auth failures, etc.)
        if (isPermanentError(error)) {
          throw error;
        }
        // Log unexpected errors for debugging (expected: empty result means no PR)
        const stderr = (error as { stderr?: string }).stderr ?? "";
        if (stderr && !stderr.includes("no pull requests match")) {
          logger.info(
            `Debug: GitHub PR check failed - ${sanitizeCredentials(stderr).trim()}`
          );
        }
      }
      return null;
    }
  }

  async closeExistingPR(options: CloseExistingPROptions): Promise<boolean> {
    const {
      repoInfo,
      branchName,
      baseBranch,
      workDir,
      retries = 3,
      token,
    } = options;

    if (!isGitHubRepo(repoInfo)) {
      throw new Error("Expected GitHub repository");
    }

    // First check if there's an existing PR (pass token through)
    const existingUrl = await this.checkExistingPR({
      repoInfo,
      branchName,
      baseBranch,
      workDir,
      retries,
      title: "", // Not used for check
      body: "", // Not used for check
      token,
    });

    if (!existingUrl) {
      return false;
    }

    // Extract PR number from URL
    const prNumber = existingUrl.match(/\/pull\/(\d+)/)?.[1];
    if (!prNumber) {
      throw new Error(`Could not extract PR number from URL: ${existingUrl}`);
    }

    // Close the PR and delete the branch
    // Token is passed via GH_TOKEN env prefix for gh CLI authentication
    const repoFlag = getRepoFlag(repoInfo);
    const tokenPrefix = buildTokenPrefix(token);
    const command = `${tokenPrefix}gh pr close ${escapeShellArg(prNumber)} --repo ${escapeShellArg(repoFlag)} --delete-branch`;

    try {
      await withRetry(() => this.executor.exec(command, workDir), { retries });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.info(
        `Warning: Failed to close existing PR #${prNumber}: ${message}`
      );
      return false;
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
    } = options;

    if (!isGitHubRepo(repoInfo)) {
      throw new Error("Expected GitHub repository");
    }

    // Write body to temp file to avoid shell escaping issues
    const bodyFile = join(workDir, this.bodyFilePath);
    writeFileSync(bodyFile, body, "utf-8");

    // Token is passed via GH_TOKEN env prefix for gh CLI authentication
    const tokenPrefix = buildTokenPrefix(token);
    const command = `${tokenPrefix}gh pr create --title ${escapeShellArg(title)} --body-file ${escapeShellArg(bodyFile)} --base ${escapeShellArg(baseBranch)} --head ${escapeShellArg(branchName)}`;

    try {
      const result = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries }
      );

      // Extract URL from output - use strict regex for valid PR URLs only
      const host = repoInfo.host || "github.com";
      const urlRegex = buildPRUrlRegex(host);
      const urlMatch = result.match(urlRegex);

      if (!urlMatch) {
        throw new Error(`Could not parse PR URL from output: ${result}`);
      }

      return {
        url: urlMatch[0],
        success: true,
        message: "PR created successfully",
      };
    } finally {
      // Clean up temp file - log warning on failure instead of throwing
      try {
        if (existsSync(bodyFile)) {
          unlinkSync(bodyFile);
        }
      } catch (cleanupError) {
        logger.info(
          `Warning: Failed to clean up temp file ${bodyFile}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        );
      }
    }
  }

  /**
   * Check if auto-merge is enabled on the repository.
   */
  async checkAutoMergeEnabled(
    repoInfo: GitHubRepoInfo,
    workDir: string,
    retries: number = 3,
    token?: string
  ): Promise<boolean> {
    const hostnameFlag = getHostnameFlag(repoInfo);
    const hostnamePart = hostnameFlag ? `${hostnameFlag} ` : "";
    // Token is passed via GH_TOKEN env prefix for gh CLI authentication
    const tokenPrefix = buildTokenPrefix(token);
    const command = `${tokenPrefix}gh api ${hostnamePart}repos/${escapeShellArg(repoInfo.owner)}/${escapeShellArg(repoInfo.repo)} --jq '.allow_auto_merge // false'`;

    try {
      const result = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries }
      );
      return result.trim() === "true";
    } catch (error) {
      // If we can't check, assume auto-merge is not enabled
      logger.info(
        `Warning: Could not check auto-merge status: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Build merge strategy flag for gh pr merge command.
   */
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
    const { prUrl, config, workDir, retries = 3, token } = options;

    // Manual mode: do nothing
    if (config.mode === "manual") {
      return {
        success: true,
        message: "PR left open for manual review",
        merged: false,
      };
    }

    const strategyFlag = this.getMergeStrategyFlag(config.strategy);
    const deleteBranchFlag = config.deleteBranch ? "--delete-branch" : "";
    // Token is passed via GH_TOKEN env prefix for gh CLI authentication
    const tokenPrefix = buildTokenPrefix(token);

    if (config.mode === "auto") {
      // Check if auto-merge is enabled on the repo
      // Extract host/owner/repo from PR URL (supports both github.com and GHE)
      const match = prUrl.match(/https:\/\/([^/]+)\/([^/]+)\/([^/]+)/);
      if (match) {
        const repoInfo: GitHubRepoInfo = {
          type: "github",
          gitUrl: prUrl,
          owner: match[2],
          repo: match[3],
          host: match[1],
        };
        const autoMergeEnabled = await this.checkAutoMergeEnabled(
          repoInfo,
          workDir,
          retries,
          token
        );

        if (!autoMergeEnabled) {
          logger.info(
            `Warning: Auto-merge not enabled for '${repoInfo.owner}/${repoInfo.repo}'. PR left open for manual review.`
          );
          logger.info(
            `To enable: gh repo edit ${getRepoFlag(repoInfo)} --enable-auto-merge (requires admin)`
          );
          return {
            success: true,
            message: `Auto-merge not enabled for repository. PR left open for manual review.`,
            merged: false,
            autoMergeEnabled: false,
          };
        }
      }

      // Enable auto-merge
      const command =
        `${tokenPrefix}gh pr merge ${escapeShellArg(prUrl)} --auto ${strategyFlag} ${deleteBranchFlag}`.trim();

      try {
        await withRetry(() => this.executor.exec(command, workDir), {
          retries,
        });

        return {
          success: true,
          message: "Auto-merge enabled. PR will merge when checks pass.",
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
      // Force merge using admin privileges
      const command =
        `${tokenPrefix}gh pr merge ${escapeShellArg(prUrl)} --admin ${strategyFlag} ${deleteBranchFlag}`.trim();

      try {
        await withRetry(() => this.executor.exec(command, workDir), {
          retries,
        });

        return {
          success: true,
          message: "PR merged successfully using admin privileges.",
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
