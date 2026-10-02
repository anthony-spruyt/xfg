import type { RepoConfig } from "../../config/index.js";
import type {
  GitHubRepoInfo,
  IRepoMetadataProvider,
  RepoInfo,
} from "../../repo/index.js";
import { getManagedCollaborators } from "../../sync/manifest.js";
import { diffCollaborators } from "./diff.js";
import {
  formatCollaboratorsPlan,
  type CollaboratorsPlanResult,
} from "./formatter.js";
import type { ICollaboratorsStrategy } from "./types.js";
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

export type ICollaboratorsProcessor = ISettingsProcessor<
  CollaboratorsProcessorOptions,
  CollaboratorsProcessorResult
>;

export interface CollaboratorsProcessorOptions extends BaseProcessorOptions {
  noDelete?: boolean;
  /** Config id that namespaces managed collaborators in .xfg.json */
  configId?: string;
}

export interface CollaboratorsProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: CollaboratorsPlanResult;
  warnings?: string[];
}

export class CollaboratorsProcessor implements ICollaboratorsProcessor {
  constructor(
    private readonly strategy: ICollaboratorsStrategy,
    private readonly metadataProvider: IRepoMetadataProvider
  ) {}

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: CollaboratorsProcessorOptions
  ): Promise<CollaboratorsProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) => {
        const c = rc.settings?.collaborators;
        return (c?.users ?? []).length > 0 || c?.deleteOrphaned === true;
      },
      emptySettingsMessage: "No collaborators configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });
  }

  private async applySettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: CollaboratorsProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<CollaboratorsProcessorResult> {
    const { dryRun, noDelete, configId } = options;
    const desired = repoConfig.settings?.collaborators ?? {};
    const strategyOptions = { token: effectiveToken, host: githubRepo.host };

    const metadata = await this.metadataProvider.getMetadata(
      githubRepo,
      strategyOptions
    );
    if (metadata.ownerType !== "User") {
      return {
        success: true,
        repoName,
        message: "Skipped: collaborators only apply to personal repos",
        skipped: true,
        warnings: [
          `${repoName}: collaborators only apply to personal repos (owner is an organization) - skipped`,
        ],
      };
    }

    const deleteOrphaned = desired.deleteOrphaned === true && !noDelete;
    const [collaborators, invitations, manifest] = await Promise.all([
      this.strategy.listCollaborators(githubRepo, strategyOptions),
      this.strategy.listInvitations(githubRepo, strategyOptions),
      deleteOrphaned && configId
        ? this.strategy.getManifest(githubRepo, strategyOptions)
        : Promise.resolve(null),
    ]);

    const changes = diffCollaborators({
      owner: githubRepo.owner,
      collaborators,
      invitations,
      desired: desired.users ?? [],
      managed: configId ? getManagedCollaborators(manifest, configId) : [],
      deleteOrphaned,
    });
    const changeCounts = countActions(changes);
    const planOutput = formatCollaboratorsPlan(changes);

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts, { planOutput });
    }

    let appliedCount = 0;
    for (const change of changes) {
      if (change.action === "create") {
        await this.strategy.add(githubRepo, change.username, strategyOptions);
        appliedCount++;
      } else if (change.action === "delete") {
        if (change.pending && change.invitationId !== undefined) {
          await this.strategy.cancelInvitation(
            githubRepo,
            change.invitationId,
            strategyOptions
          );
        } else {
          await this.strategy.remove(
            githubRepo,
            change.username,
            strategyOptions
          );
        }
        appliedCount++;
      }
    }

    return buildApplyResult(repoName, changeCounts, appliedCount, {
      planOutput,
    });
  }
}
