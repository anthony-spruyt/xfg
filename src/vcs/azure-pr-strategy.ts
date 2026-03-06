import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { escapeShellArg } from "../shared/shell-utils.js";
import {
  AzureDevOpsRepoInfo,
  assertAzureDevOpsRepo,
} from "../shared/repo-detector.js";
import type { PRResult } from "./types.js";
import { BasePRStrategy } from "./pr-strategy.js";
import type { IPRStrategyLogger } from "./pr-strategy.js";
import type {
  PRStrategyOptions,
  CloseExistingPROptions,
  MergeOptions,
  MergeResult,
} from "./types.js";
import { withRetry, isPermanentError } from "../shared/retry-utils.js";
import { ICommandExecutor } from "../shared/command-executor.js";
import { toErrorMessage, safeCleanup } from "../shared/type-guards.js";
import { sanitizeCredentials } from "../shared/sanitize-utils.js";
import { getStderr } from "../shared/command-executor.js";

export class AzurePRStrategy extends BasePRStrategy {
  constructor(executor?: ICommandExecutor, log?: IPRStrategyLogger) {
    super(executor, log);
    this.bodyFilePath = ".pr-description.md";
  }

  private getOrgUrl(repoInfo: AzureDevOpsRepoInfo): string {
    return `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}`;
  }

  private buildPRUrl(repoInfo: AzureDevOpsRepoInfo, prId: string): string {
    return `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}/${encodeURIComponent(repoInfo.project)}/_git/${encodeURIComponent(repoInfo.repo)}/pullrequest/${prId.trim()}`;
  }

  async checkExistingPR(
    options: CloseExistingPROptions
  ): Promise<string | null> {
    const { repoInfo, branchName, baseBranch, workDir, retries = 3 } = options;

    assertAzureDevOpsRepo(repoInfo, "Azure PR strategy");
    const azureRepoInfo: AzureDevOpsRepoInfo = repoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

    const command = `az repos pr list --repository ${escapeShellArg(azureRepoInfo.repo)} --source-branch ${escapeShellArg(branchName)} --target-branch ${escapeShellArg(baseBranch)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --query "[0].pullRequestId" -o tsv`;

    try {
      const existingPRId = await withRetry(
        () => this.executor.exec(command, workDir),
        { retries, log: this.log }
      );

      return existingPRId ? this.buildPRUrl(azureRepoInfo, existingPRId) : null;
    } catch (error) {
      if (isPermanentError(error)) {
        throw error;
      }
      const stderr = getStderr(error);
      if (stderr && !stderr.includes("does not exist")) {
        this.log?.debug(
          `Azure PR check failed - ${sanitizeCredentials(stderr).trim()}`
        );
      }
      return null;
    }
  }

  async closeExistingPR(options: CloseExistingPROptions): Promise<boolean> {
    const { repoInfo, branchName, baseBranch, workDir, retries = 3 } = options;

    assertAzureDevOpsRepo(repoInfo, "Azure PR strategy");
    const azureRepoInfo: AzureDevOpsRepoInfo = repoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

    // First check if there's an existing PR
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

    // Extract PR ID from URL
    const prInfo = this.parsePRUrl(existingUrl);
    if (!prInfo) {
      this.log?.warn(`Could not parse PR URL: ${existingUrl}`);
      return false;
    }

    // Abandon the PR (Azure DevOps equivalent of closing)
    const abandonCommand = `az repos pr update --id ${escapeShellArg(prInfo.prId)} --status abandoned --org ${escapeShellArg(orgUrl)}`;

    try {
      await withRetry(() => this.executor.exec(abandonCommand, workDir), {
        retries,
        log: this.log,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      this.log?.warn(`Failed to abandon PR #${prInfo.prId}: ${message}`);
      return false;
    }

    try {
      const getRefCommand = `az repos ref list --repository ${escapeShellArg(azureRepoInfo.repo)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --filter heads/${escapeShellArg(branchName)} --query "[0].objectId" -o tsv`;
      const objectId = await withRetry(
        () => this.executor.exec(getRefCommand, workDir),
        { retries, log: this.log }
      );

      if (objectId) {
        const deleteBranchCommand = `az repos ref delete --name refs/heads/${escapeShellArg(branchName)} --repository ${escapeShellArg(azureRepoInfo.repo)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --object-id ${escapeShellArg(objectId)}`;
        await withRetry(
          () => this.executor.exec(deleteBranchCommand, workDir),
          { retries, log: this.log }
        );
      }
    } catch (error) {
      // Branch deletion failure is not critical - PR is already abandoned
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

    assertAzureDevOpsRepo(repoInfo, "Azure PR strategy");
    const azureRepoInfo: AzureDevOpsRepoInfo = repoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

    const descFile = join(workDir, this.bodyFilePath);
    writeFileSync(descFile, body, "utf-8");

    // Azure CLI @file syntax: escape the full @path to handle special chars in workDir
    const command = `az repos pr create --repository ${escapeShellArg(azureRepoInfo.repo)} --source-branch ${escapeShellArg(branchName)} --target-branch ${escapeShellArg(baseBranch)} --title ${escapeShellArg(title)} --description ${escapeShellArg("@" + descFile)} --org ${escapeShellArg(orgUrl)} --project ${escapeShellArg(azureRepoInfo.project)} --query "pullRequestId" -o tsv`;

    try {
      const prId = await withRetry(() => this.executor.exec(command, workDir), {
        retries,
        log: this.log,
      });

      return {
        url: this.buildPRUrl(azureRepoInfo, prId),
        success: true,
        message: "PR created successfully",
      };
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
      const autoCommand =
        `az repos pr update --id ${escapeShellArg(prInfo.prId)} --auto-complete true ${squashFlag} ${deleteBranchFlag} --org ${escapeShellArg(orgUrl)}`.trim();

      return this.executeMergeCommand(
        () => this.executor.exec(autoCommand, workDir),
        retries,
        {
          success: true,
          message:
            "Auto-complete enabled. PR will merge when all policies pass.",
          merged: false,
          autoMergeEnabled: true,
        },
        "Failed to enable auto-complete"
      );
    }

    if (config.mode === "force") {
      const bypassReason =
        config.bypassReason ?? "Automated config sync via xfg";
      const forceCommand =
        `az repos pr update --id ${escapeShellArg(prInfo.prId)} --bypass-policy true --bypass-policy-reason ${escapeShellArg(bypassReason)} --status completed ${squashFlag} ${deleteBranchFlag} --org ${escapeShellArg(orgUrl)}`.trim();

      return this.executeMergeCommand(
        () => this.executor.exec(forceCommand, workDir),
        retries,
        {
          success: true,
          message: "PR completed by bypassing policies.",
          merged: true,
        },
        "Failed to bypass policies and complete PR"
      );
    }

    return {
      success: false,
      message: `Unknown merge mode: ${config.mode}`,
      merged: false,
    };
  }
}
