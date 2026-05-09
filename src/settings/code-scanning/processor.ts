import type { RepoConfig, CodeScanningSettings } from "../../config/index.js";
import type { GitHubRepoInfo, RepoInfo } from "../../repo/index.js";
import type { ICodeScanningStrategy } from "./types.js";
import type { IRepoMetadataProvider, RepoMetadata } from "../../repo/index.js";
import { diffCodeScanning, hasCodeScanningChanges } from "./diff.js";
import {
  formatCodeScanningPlan,
  type CodeScanningPlanResult,
} from "./formatter.js";
import {
  withGitHubGuards,
  type BaseProcessorOptions,
  type BaseProcessorResult,
  type ISettingsProcessor,
  type ChangeCounts,
  countActions,
  buildDryRunResult,
  buildApplyResult,
} from "../base-processor.js";

export type ICodeScanningProcessor = ISettingsProcessor<
  CodeScanningProcessorOptions,
  CodeScanningProcessorResult
>;

export type CodeScanningProcessorOptions = BaseProcessorOptions;

export interface CodeScanningProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: CodeScanningPlanResult;
}

export class CodeScanningProcessor implements ICodeScanningProcessor {
  private readonly strategy: ICodeScanningStrategy;
  private readonly metadataProvider: IRepoMetadataProvider;

  constructor(
    strategy: ICodeScanningStrategy,
    metadataProvider: IRepoMetadataProvider
  ) {
    this.strategy = strategy;
    this.metadataProvider = metadataProvider;
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: CodeScanningProcessorOptions
  ): Promise<CodeScanningProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) => {
        const cs = rc.settings?.codeScanning;
        return !!cs && typeof cs === "object";
      },
      emptySettingsMessage: "No code scanning settings configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async applySettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: CodeScanningProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<CodeScanningProcessorResult> {
    const { dryRun } = options;
    const desiredSettings = repoConfig.settings?.codeScanning;
    if (!desiredSettings || typeof desiredSettings !== "object") {
      throw new Error("applySettings called without codeScanning settings");
    }

    const strategyOptions = { token: effectiveToken, host: githubRepo.host };

    // Validate GHAS availability for private repos
    const metadata = await this.metadataProvider.getMetadata(
      githubRepo,
      strategyOptions
    );
    const validationError = this.validateGHAS(desiredSettings, metadata);
    if (validationError) {
      return {
        success: false,
        repoName,
        message: `Failed: ${validationError}`,
      };
    }

    // Fetch current settings
    const currentSettings = await this.strategy.get(
      githubRepo,
      strategyOptions
    );

    // Compute diff
    const changes = diffCodeScanning(currentSettings, desiredSettings);
    const changeCounts = countActions(changes);

    if (!hasCodeScanningChanges(changes)) {
      return {
        success: true,
        repoName,
        message: "No changes needed",
        changes: changeCounts,
      };
    }

    // Format plan output
    const planOutput = formatCodeScanningPlan(changes);

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts, { planOutput });
    }

    // Build API payload from desired settings
    const payload: {
      state: string;
      query_suite?: string;
      languages?: string[];
    } = {
      state: desiredSettings.state,
    };
    if (desiredSettings.querySuite !== undefined) {
      payload.query_suite = desiredSettings.querySuite;
    }
    if (desiredSettings.languages !== undefined) {
      payload.languages = desiredSettings.languages;
    }

    await this.strategy.update(githubRepo, payload, strategyOptions);

    const appliedCount = changes.filter((c) => c.action !== "unchanged").length;
    return buildApplyResult(repoName, changeCounts, appliedCount, {
      planOutput,
    });
  }

  private validateGHAS(
    desired: CodeScanningSettings,
    metadata: RepoMetadata
  ): string | undefined {
    if (desired.state !== "configured") return undefined;

    const isPublic = metadata.visibility === "public";
    if (isPublic) return undefined;

    if (!metadata.hasGHAS) {
      return "Code scanning default setup requires GitHub Advanced Security (not available for this repository)";
    }

    return undefined;
  }
}
