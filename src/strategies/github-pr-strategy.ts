import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { escapeShellArg } from "../shell-utils.js";
import { isGitHubRepo } from "../repo-detector.js";
import { PRResult } from "../pr-creator.js";
import { BasePRStrategy, PRStrategyOptions } from "./pr-strategy.js";
import { logger } from "../logger.js";
import { withRetry, isPermanentError } from "../retry-utils.js";

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

      // Extract URL from output
      const urlMatch = result.match(/https:\/\/github\.com\/[^\s]+/);

      return {
        url: urlMatch?.[0] ?? result,
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
}
