import { execSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { escapeShellArg } from "../shell-utils.js";
import { AzureDevOpsRepoInfo } from "../repo-detector.js";
import { PRResult } from "../pr-creator.js";
import { BasePRStrategy, PRStrategyOptions } from "./pr-strategy.js";
import { logger } from "../logger.js";

export class AzurePRStrategy extends BasePRStrategy {
  constructor() {
    super();
    this.bodyFilePath = ".pr-description.md";
  }

  private getOrgUrl(repoInfo: AzureDevOpsRepoInfo): string {
    return `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}`;
  }

  private buildPRUrl(repoInfo: AzureDevOpsRepoInfo, prId: string): string {
    return `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}/${encodeURIComponent(repoInfo.project)}/_git/${encodeURIComponent(repoInfo.repo)}/pullrequest/${prId}`;
  }

  async checkExistingPR(options: PRStrategyOptions): Promise<string | null> {
    const { repoInfo, branchName, baseBranch, workDir } = options;
    const azureRepoInfo = repoInfo as AzureDevOpsRepoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

    try {
      const existingPRId = execSync(
        `az repos pr list --repository ${escapeShellArg(azureRepoInfo.repo)} --source-branch ${escapeShellArg(branchName)} --target-branch ${escapeShellArg(baseBranch)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --query "[0].pullRequestId" -o tsv`,
        { cwd: workDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();

      return existingPRId ? this.buildPRUrl(azureRepoInfo, existingPRId) : null;
    } catch (error) {
      // Log unexpected errors for debugging (expected: empty result means no PR)
      if (error instanceof Error) {
        const stderr = (error as { stderr?: string }).stderr ?? "";
        if (stderr && !stderr.includes("does not exist")) {
          logger.info(`Debug: Azure PR check failed - ${stderr.trim()}`);
        }
      }
      return null;
    }
  }

  async create(options: PRStrategyOptions): Promise<PRResult> {
    const { repoInfo, title, body, branchName, baseBranch, workDir } = options;
    const azureRepoInfo = repoInfo as AzureDevOpsRepoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

    // Write description to temp file to avoid shell escaping issues
    const descFile = join(workDir, this.bodyFilePath);
    writeFileSync(descFile, body, "utf-8");

    try {
      const prId = execSync(
        `az repos pr create --repository ${escapeShellArg(azureRepoInfo.repo)} --source-branch ${escapeShellArg(branchName)} --target-branch ${escapeShellArg(baseBranch)} --title ${escapeShellArg(title)} --description @${escapeShellArg(descFile)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --query "pullRequestId" -o tsv`,
        { cwd: workDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();

      return {
        url: this.buildPRUrl(azureRepoInfo, prId),
        success: true,
        message: "PR created successfully",
      };
    } finally {
      // Clean up temp file
      if (existsSync(descFile)) {
        unlinkSync(descFile);
      }
    }
  }
}
