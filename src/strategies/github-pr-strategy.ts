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
import type { MergeStrategy } from "../config.js";

export class GitHubPRStrategy extends BasePRStrategy {
  async checkExistingPR(options: PRStrategyOptions): Promise<string | null> {
    const { repoInfo, branchName, workDir, retries = 3 } = options;

    if (!isGitHubRepo(repoInfo)) {
      throw new Error("Expected GitHub repository");
    }

    const command = `gh pr list --head ${escapeShellArg(branchName)} --json url --jq '.[0].url'`;

    try {
      const existingPR = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries },
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
          logger.info(`Debug: GitHub PR check failed - ${stderr.trim()}`);
        }
      }
      return null;
    }
  }

  async closeExistingPR(options: CloseExistingPROptions): Promise<boolean> {
    const { repoInfo, branchName, baseBranch, workDir, retries = 3 } = options;

    if (!isGitHubRepo(repoInfo)) {
      throw new Error("Expected GitHub repository");
    }

    // First check if there's an existing PR
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

    // Extract PR number from URL
    const prNumber = existingUrl.match(/\/pull\/(\d+)/)?.[1];
    if (!prNumber) {
      logger.info(
        `Warning: Could not extract PR number from URL: ${existingUrl}`,
      );
      return false;
    }

    // Close the PR and delete the branch
    const command = `gh pr close ${escapeShellArg(prNumber)} --repo ${escapeShellArg(repoInfo.owner)}/${escapeShellArg(repoInfo.repo)} --delete-branch`;

    try {
      await withRetry(() => this.executor.exec(command, workDir), { retries });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.info(
        `Warning: Failed to close existing PR #${prNumber}: ${message}`,
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
    } = options;

    if (!isGitHubRepo(repoInfo)) {
      throw new Error("Expected GitHub repository");
    }

    // Write body to temp file to avoid shell escaping issues
    const bodyFile = join(workDir, this.bodyFilePath);
    writeFileSync(bodyFile, body, "utf-8");

    const command = `gh pr create --title ${escapeShellArg(title)} --body-file ${escapeShellArg(bodyFile)} --base ${escapeShellArg(baseBranch)} --head ${escapeShellArg(branchName)}`;

    try {
      const result = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries },
      );

      // Extract URL from output - use strict regex for valid PR URLs only
      const urlMatch = result.match(
        /https:\/\/github\.com\/[\w-]+\/[\w.-]+\/pull\/\d+/,
      );

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
          `Warning: Failed to clean up temp file ${bodyFile}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
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
  ): Promise<boolean> {
    const command = `gh api repos/${escapeShellArg(repoInfo.owner)}/${escapeShellArg(repoInfo.repo)} --jq '.allow_auto_merge // false'`;

    try {
      const result = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries },
      );
      return result.trim() === "true";
    } catch (error) {
      // If we can't check, assume auto-merge is not enabled
      logger.info(
        `Warning: Could not check auto-merge status: ${error instanceof Error ? error.message : String(error)}`,
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
    const { prUrl, config, workDir, retries = 3 } = options;

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

    if (config.mode === "auto") {
      // Check if auto-merge is enabled on the repo
      // Extract owner/repo from PR URL
      const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        const repoInfo: GitHubRepoInfo = {
          type: "github",
          gitUrl: prUrl,
          owner: match[1],
          repo: match[2],
        };
        const autoMergeEnabled = await this.checkAutoMergeEnabled(
          repoInfo,
          workDir,
          retries,
        );

        if (!autoMergeEnabled) {
          logger.info(
            `Warning: Auto-merge not enabled for '${repoInfo.owner}/${repoInfo.repo}'. PR left open for manual review.`,
          );
          logger.info(
            `To enable: gh repo edit ${repoInfo.owner}/${repoInfo.repo} --enable-auto-merge (requires admin)`,
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
        `gh pr merge ${escapeShellArg(prUrl)} --auto ${strategyFlag} ${deleteBranchFlag}`.trim();

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
        `gh pr merge ${escapeShellArg(prUrl)} --admin ${strategyFlag} ${deleteBranchFlag}`.trim();

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
