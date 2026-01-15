import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { escapeShellArg } from "../shell-utils.js";
import { AzureDevOpsRepoInfo, isAzureDevOpsRepo } from "../repo-detector.js";
import { PRResult } from "../pr-creator.js";
import { BasePRStrategy, PRStrategyOptions } from "./pr-strategy.js";
import { logger } from "../logger.js";
import { withRetry, isPermanentError } from "../retry-utils.js";
import { CommandExecutor } from "../command-executor.js";

export class AzurePRStrategy extends BasePRStrategy {
  constructor(executor?: CommandExecutor) {
    super(executor);
    this.bodyFilePath = ".pr-description.md";
  }

  private getOrgUrl(repoInfo: AzureDevOpsRepoInfo): string {
    return `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}`;
  }

  private buildPRUrl(repoInfo: AzureDevOpsRepoInfo, prId: string): string {
    return `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}/${encodeURIComponent(repoInfo.project)}/_git/${encodeURIComponent(repoInfo.repo)}/pullrequest/${prId}`;
  }

  async checkExistingPR(options: PRStrategyOptions): Promise<string | null> {
    const { repoInfo, branchName, baseBranch, workDir, retries = 3 } = options;

    if (!isAzureDevOpsRepo(repoInfo)) {
      throw new Error("Expected Azure DevOps repository");
    }
    const azureRepoInfo: AzureDevOpsRepoInfo = repoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

    const command = `az repos pr list --repository ${escapeShellArg(azureRepoInfo.repo)} --source-branch ${escapeShellArg(branchName)} --target-branch ${escapeShellArg(baseBranch)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --query "[0].pullRequestId" -o tsv`;

    try {
      const existingPRId = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries },
      );

      return existingPRId ? this.buildPRUrl(azureRepoInfo, existingPRId) : null;
    } catch (error) {
      if (error instanceof Error) {
        if (isPermanentError(error)) {
          throw error;
        }
        const stderr = (error as { stderr?: string }).stderr ?? "";
        if (stderr && !stderr.includes("does not exist")) {
          logger.info(`Debug: Azure PR check failed - ${stderr.trim()}`);
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

    if (!isAzureDevOpsRepo(repoInfo)) {
      throw new Error("Expected Azure DevOps repository");
    }
    const azureRepoInfo: AzureDevOpsRepoInfo = repoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

    // Write description to temp file to avoid shell escaping issues
    const descFile = join(workDir, this.bodyFilePath);
    writeFileSync(descFile, body, "utf-8");

    const command = `az repos pr create --repository ${escapeShellArg(azureRepoInfo.repo)} --source-branch ${escapeShellArg(branchName)} --target-branch ${escapeShellArg(baseBranch)} --title ${escapeShellArg(title)} --description @${escapeShellArg(descFile)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --query "pullRequestId" -o tsv`;

    try {
      const prId = await withRetry(() => this.executor.exec(command, workDir), {
        retries,
      });

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
