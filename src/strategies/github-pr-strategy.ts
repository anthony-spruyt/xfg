import { execSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { escapeShellArg } from "../shell-utils.js";
import { isGitHubRepo } from "../repo-detector.js";
import { PRResult } from "../pr-creator.js";
import { BasePRStrategy, PRStrategyOptions } from "./pr-strategy.js";
import { logger } from "../logger.js";

export class GitHubPRStrategy extends BasePRStrategy {
  async checkExistingPR(options: PRStrategyOptions): Promise<string | null> {
    const { repoInfo, branchName, workDir } = options;

    if (!isGitHubRepo(repoInfo)) {
      throw new Error("Expected GitHub repository");
    }

    try {
      const existingPR = execSync(
        `gh pr list --head ${escapeShellArg(branchName)} --json url --jq '.[0].url'`,
        { cwd: workDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();

      return existingPR || null;
    } catch (error) {
      // Log unexpected errors for debugging (expected: empty result means no PR)
      if (error instanceof Error) {
        const stderr = (error as { stderr?: string }).stderr ?? "";
        if (stderr && !stderr.includes("no pull requests match")) {
          logger.info(`Debug: GitHub PR check failed - ${stderr.trim()}`);
        }
      }
      return null;
    }
  }

  async create(options: PRStrategyOptions): Promise<PRResult> {
    const { repoInfo, title, body, branchName, baseBranch, workDir } = options;

    if (!isGitHubRepo(repoInfo)) {
      throw new Error("Expected GitHub repository");
    }

    // Write body to temp file to avoid shell escaping issues
    const bodyFile = join(workDir, this.bodyFilePath);
    writeFileSync(bodyFile, body, "utf-8");

    try {
      const result = execSync(
        `gh pr create --title ${escapeShellArg(title)} --body-file ${escapeShellArg(bodyFile)} --base ${escapeShellArg(baseBranch)} --head ${escapeShellArg(branchName)}`,
        { cwd: workDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();

      // Extract URL from output
      const urlMatch = result.match(/https:\/\/github\.com\/[^\s]+/);

      return {
        url: urlMatch?.[0] ?? result,
        success: true,
        message: "PR created successfully",
      };
    } finally {
      // Clean up temp file
      if (existsSync(bodyFile)) {
        unlinkSync(bodyFile);
      }
    }
  }
}
