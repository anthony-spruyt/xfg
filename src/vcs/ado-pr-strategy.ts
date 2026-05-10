import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  type AzureDevOpsRepoInfo,
  assertAzureDevOpsRepo,
} from "../repo/index.js";
import type { PRResult } from "./types.js";
import { SyncError } from "../shared/errors.js";
import { BasePRStrategy } from "./pr-strategy.js";
import type {
  PRStrategyOptions,
  CloseExistingPROptions,
  ClosePRResult,
  MergeOptions,
  MergeResult,
} from "./types.js";
import { withRetry, isPermanentError } from "../shared/retry-utils.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { safeCleanup } from "../shared/cleanup-utils.js";
import { NO_OP_DEBUG_LOG } from "../shared/logger.js";
import { sanitizeCredentials } from "../shared/sanitize-utils.js";
import { getStderr } from "../shared/command-executor.js";

export class AdoPRStrategy extends BasePRStrategy {
  private readonly bodyFilePath = ".pr-description.md";

  private getOrgUrl(repoInfo: AzureDevOpsRepoInfo): string {
    return `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}`;
  }

  private buildPRUrl(repoInfo: AzureDevOpsRepoInfo, prId: string): string {
    return `https://dev.azure.com/${encodeURIComponent(repoInfo.organization)}/${encodeURIComponent(repoInfo.project)}/_git/${encodeURIComponent(repoInfo.repo)}/pullrequest/${prId.trim()}`;
  }

  /**
   * Query Azure DevOps for an existing PR ID matching source/target branches.
   * Returns the raw PR ID string, or null if none found.
   */
  private async findExistingPRId(
    azureRepoInfo: AzureDevOpsRepoInfo,
    branchName: string,
    baseBranch: string,
    workDir: string,
    retries: number
  ): Promise<string | null> {
    const orgUrl = this.getOrgUrl(azureRepoInfo);
    const args = [
      "repos",
      "pr",
      "list",
      "--repository",
      azureRepoInfo.repo,
      "--source-branch",
      branchName,
      "--target-branch",
      baseBranch,
      "--org",
      orgUrl,
      "--project",
      azureRepoInfo.project,
      "--query",
      "[0].pullRequestId",
      "-o",
      "tsv",
    ];

    try {
      const existingPRId = await withRetry(
        () => this.executor.exec("az", args, workDir),
        { retries, log: this.log }
      );

      return existingPRId ? existingPRId.trim() : null;
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

  async findExistingPRUrl(
    options: CloseExistingPROptions
  ): Promise<string | null> {
    const { repoInfo, branchName, baseBranch, workDir, retries = 3 } = options;

    assertAzureDevOpsRepo(repoInfo, "Azure PR strategy");
    const azureRepoInfo: AzureDevOpsRepoInfo = repoInfo;

    const prId = await this.findExistingPRId(
      azureRepoInfo,
      branchName,
      baseBranch,
      workDir,
      retries
    );

    return prId ? this.buildPRUrl(azureRepoInfo, prId) : null;
  }

  async closeExistingPR(
    options: CloseExistingPROptions
  ): Promise<ClosePRResult> {
    const { repoInfo, branchName, baseBranch, workDir, retries = 3 } = options;

    assertAzureDevOpsRepo(repoInfo, "Azure PR strategy");
    const azureRepoInfo: AzureDevOpsRepoInfo = repoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

    const prId = await this.findExistingPRId(
      azureRepoInfo,
      branchName,
      baseBranch,
      workDir,
      retries
    );

    if (!prId) {
      return { status: "no_pr" };
    }

    const abandonArgs = [
      "repos",
      "pr",
      "update",
      "--id",
      prId,
      "--status",
      "abandoned",
      "--org",
      orgUrl,
    ];

    try {
      await withRetry(() => this.executor.exec("az", abandonArgs, workDir), {
        retries,
        log: this.log,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      this.log?.warn(`Failed to abandon PR #${prId}: ${message}`);
      return { status: "close_failed", message };
    }

    try {
      const getRefArgs = [
        "repos",
        "ref",
        "list",
        "--repository",
        azureRepoInfo.repo,
        "--org",
        orgUrl,
        "--project",
        azureRepoInfo.project,
        "--filter",
        `heads/${branchName}`,
        "--query",
        "[0].objectId",
        "-o",
        "tsv",
      ];
      const objectId = await withRetry(
        () => this.executor.exec("az", getRefArgs, workDir),
        { retries, log: this.log }
      );

      if (objectId) {
        const deleteBranchArgs = [
          "repos",
          "ref",
          "delete",
          "--name",
          `refs/heads/${branchName}`,
          "--repository",
          azureRepoInfo.repo,
          "--org",
          orgUrl,
          "--project",
          azureRepoInfo.project,
          "--object-id",
          objectId,
        ];
        await withRetry(
          () => this.executor.exec("az", deleteBranchArgs, workDir),
          { retries, log: this.log }
        );
      }
    } catch (error) {
      const message = `PR #${prId} abandoned but branch ${branchName} deletion failed: ${toErrorMessage(error)}`;
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

    assertAzureDevOpsRepo(repoInfo, "Azure PR strategy");
    const azureRepoInfo: AzureDevOpsRepoInfo = repoInfo;
    const orgUrl = this.getOrgUrl(azureRepoInfo);

    const descFile = join(workDir, this.bodyFilePath);
    try {
      writeFileSync(descFile, body, "utf-8");
    } catch (err) {
      throw new SyncError(
        `Failed to write PR description to ${descFile}: ${toErrorMessage(err)}`,
        { cause: err }
      );
    }

    const args = [
      "repos",
      "pr",
      "create",
      "--repository",
      azureRepoInfo.repo,
      "--source-branch",
      branchName,
      "--target-branch",
      baseBranch,
      "--title",
      title,
      "--description",
      `@${descFile}`,
      "--org",
      orgUrl,
      "--project",
      azureRepoInfo.project,
      "--query",
      "pullRequestId",
      "-o",
      "tsv",
    ];

    try {
      const prId = await withRetry(
        () => this.executor.exec("az", args, workDir),
        {
          retries,
          log: this.log,
        }
      );

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
        this.log ?? NO_OP_DEBUG_LOG
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

    if (config.mode === "manual") {
      return {
        success: true,
        message: "PR left open for manual review",
        merged: false,
      };
    }

    const prInfo = this.parsePRUrl(prUrl);
    if (!prInfo) {
      return {
        success: false,
        message: `Invalid Azure DevOps PR URL: ${prUrl}`,
        merged: false,
      };
    }

    const orgUrl = `https://dev.azure.com/${encodeURIComponent(prInfo.organization)}`;

    if (config.mode === "auto") {
      const autoArgs = [
        "repos",
        "pr",
        "update",
        "--id",
        prInfo.prId,
        "--auto-complete",
        "true",
        ...(config.strategy === "squash" ? ["--squash", "true"] : []),
        ...(config.deleteBranch ? ["--delete-source-branch", "true"] : []),
        "--org",
        orgUrl,
      ];

      return this.executeMergeCommand(
        () => this.executor.exec("az", autoArgs, workDir),
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
      this.log?.warn(
        `Bypassing policies for PR ${prInfo.prId} (reason: ${bypassReason})`
      );
      const forceArgs = [
        "repos",
        "pr",
        "update",
        "--id",
        prInfo.prId,
        "--bypass-policy",
        "true",
        "--bypass-policy-reason",
        bypassReason,
        "--status",
        "completed",
        ...(config.strategy === "squash" ? ["--squash", "true"] : []),
        ...(config.deleteBranch ? ["--delete-source-branch", "true"] : []),
        "--org",
        orgUrl,
      ];

      return this.executeMergeCommand(
        () => this.executor.exec("az", forceArgs, workDir),
        retries,
        {
          success: true,
          message: "PR completed by bypassing policies.",
          merged: true,
        },
        "Failed to bypass policies and complete PR"
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
