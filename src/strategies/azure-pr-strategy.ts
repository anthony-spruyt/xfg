import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { escapeShellArg } from "../shell-utils.js";
import { AzureDevOpsRepoInfo, isAzureDevOpsRepo } from "../repo-detector.js";
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
import { ICommandExecutor } from "../command-executor.js";
import { sanitizeCredentials } from "../sanitize-utils.js";

export class AzurePRStrategy extends BasePRStrategy {
  constructor(executor?: ICommandExecutor) {
    super(executor);
    this.bodyFilePath = ".pr-description.md";
  }

  private getOrgUrl(repoInfo: AzureDevOpsRepoInfo): string {
    return `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}`;
  }

  private buildPRUrl(repoInfo: AzureDevOpsRepoInfo, prId: string): string {
    return `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}/${encodeURIComponent(repoInfo.project)}/_git/${encodeURIComponent(repoInfo.repo)}/pullrequest/${prId.trim()}`;
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
        { retries }
      );

      return existingPRId ? this.buildPRUrl(azureRepoInfo, existingPRId) : null;
    } catch (error) {
      if (error instanceof Error) {
        if (isPermanentError(error)) {
          throw error;
        }
        const stderr = (error as { stderr?: string }).stderr ?? "";
        if (stderr && !stderr.includes("does not exist")) {
          logger.info(
            `Debug: Azure PR check failed - ${sanitizeCredentials(stderr).trim()}`
          );
        }
      }
      return null;
    }
  }

  async closeExistingPR(options: CloseExistingPROptions): Promise<boolean> {
    const { repoInfo, branchName, baseBranch, workDir, retries = 3 } = options;

    if (!isAzureDevOpsRepo(repoInfo)) {
      throw new Error("Expected Azure DevOps repository");
    }
    const azureRepoInfo: AzureDevOpsRepoInfo = repoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

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

    // Extract PR ID from URL
    const prInfo = this.parsePRUrl(existingUrl);
    if (!prInfo) {
      logger.info(`Warning: Could not parse PR URL: ${existingUrl}`);
      return false;
    }

    // Abandon the PR (Azure DevOps equivalent of closing)
    const abandonCommand = `az repos pr update --id ${escapeShellArg(prInfo.prId)} --status abandoned --org ${escapeShellArg(orgUrl)}`;

    try {
      await withRetry(() => this.executor.exec(abandonCommand, workDir), {
        retries,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.info(`Warning: Failed to abandon PR #${prInfo.prId}: ${message}`);
      return false;
    }

    // Delete the source branch - need to get object_id first
    try {
      // Get the branch's object_id
      const getRefCommand = `az repos ref list --repository ${escapeShellArg(azureRepoInfo.repo)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --filter heads/${escapeShellArg(branchName)} --query "[0].objectId" -o tsv`;
      const objectId = await withRetry(
        () => this.executor.exec(getRefCommand, workDir),
        { retries }
      );

      if (objectId) {
        const deleteBranchCommand = `az repos ref delete --name refs/heads/${escapeShellArg(branchName)} --repository ${escapeShellArg(azureRepoInfo.repo)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --object-id ${escapeShellArg(objectId)}`;
        await withRetry(
          () => this.executor.exec(deleteBranchCommand, workDir),
          { retries }
        );
      }
    } catch (error) {
      // Branch deletion failure is not critical - PR is already abandoned
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

    if (!isAzureDevOpsRepo(repoInfo)) {
      throw new Error("Expected Azure DevOps repository");
    }
    const azureRepoInfo: AzureDevOpsRepoInfo = repoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

    // Write description to temp file to avoid shell escaping issues
    const descFile = join(workDir, this.bodyFilePath);
    writeFileSync(descFile, body, "utf-8");

    // Azure CLI @file syntax: escape the full @path to handle special chars in workDir
    const command = `az repos pr create --repository ${escapeShellArg(azureRepoInfo.repo)} --source-branch ${escapeShellArg(branchName)} --target-branch ${escapeShellArg(baseBranch)} --title ${escapeShellArg(title)} --description ${escapeShellArg("@" + descFile)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --query "pullRequestId" -o tsv`;

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

  /**
   * Extract PR ID and repo info from Azure DevOps PR URL.
   */
  private parsePRUrl(prUrl: string): {
    prId: string;
    organization: string;
    project: string;
    repo: string;
  } | null {
    // URL format: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{prId}
    const match = prUrl.match(
      /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/
    );
    if (!match) return null;

    return {
      organization: decodeURIComponent(match[1]),
      project: decodeURIComponent(match[2]),
      repo: decodeURIComponent(match[3]),
      prId: match[4],
    };
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

    // Parse PR URL to extract details
    const prInfo = this.parsePRUrl(prUrl);
    if (!prInfo) {
      return {
        success: false,
        message: `Invalid Azure DevOps PR URL: ${prUrl}`,
        merged: false,
      };
    }

    const orgUrl = `https://dev.azure.com/${encodeURIComponent(prInfo.organization)}`;
    const squashFlag = config.strategy === "squash" ? "--squash true" : "";
    const deleteBranchFlag = config.deleteBranch
      ? "--delete-source-branch true"
      : "";

    if (config.mode === "auto") {
      // Enable auto-complete (no pre-check needed - always available in Azure DevOps)
      const command =
        `az repos pr update --id ${escapeShellArg(prInfo.prId)} --auto-complete true ${squashFlag} ${deleteBranchFlag} --org ${escapeShellArg(orgUrl)}`.trim();

      try {
        await withRetry(() => this.executor.exec(command, workDir), {
          retries,
        });

        return {
          success: true,
          message:
            "Auto-complete enabled. PR will merge when all policies pass.",
          merged: false,
          autoMergeEnabled: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Failed to enable auto-complete: ${message}`,
          merged: false,
        };
      }
    }

    if (config.mode === "force") {
      // Bypass policies and complete the PR
      const bypassReason =
        config.bypassReason ?? "Automated config sync via xfg";

      const command =
        `az repos pr update --id ${escapeShellArg(prInfo.prId)} --bypass-policy true --bypass-policy-reason ${escapeShellArg(bypassReason)} --status completed ${squashFlag} ${deleteBranchFlag} --org ${escapeShellArg(orgUrl)}`.trim();

      try {
        await withRetry(() => this.executor.exec(command, workDir), {
          retries,
        });

        return {
          success: true,
          message: "PR completed by bypassing policies.",
          merged: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Failed to bypass policies and complete PR: ${message}`,
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
