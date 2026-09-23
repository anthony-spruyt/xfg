import type { GitHubRepoInfo, RepoInfo } from "../../repo/index.js";
import type { RepoConfig, SecretConfig } from "../../config/index.js";
import type { ISecretsStrategy } from "./types.js";
import type { ISecretEncryptor } from "./encryption.js";
import type { IEnvResolver } from "../../shared/env-resolver.js";
import { diffSecrets } from "./diff.js";
import { formatSecretsPlan, type SecretsPlanResult } from "./formatter.js";
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

export type ISecretsProcessor = ISettingsProcessor<
  SecretsProcessorOptions,
  SecretsProcessorResult
>;

export interface SecretsProcessorOptions extends BaseProcessorOptions {
  noDelete?: boolean;
}

export interface SecretsProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
  planOutput?: SecretsPlanResult;
  /** Set when the skip is "nothing configured here" rather than "not a GitHub repo". */
  noSecretsConfigured?: boolean;
}

function secretEntriesOf(
  repoConfig: RepoConfig
): [string, SecretConfig | boolean][] {
  const { deleteOrphaned: _d, ...entries } = (repoConfig.settings?.secrets ??
    {}) as Record<string, SecretConfig | boolean>;
  return Object.entries(entries);
}

function hasDesiredSecrets(repoConfig: RepoConfig): boolean {
  const s = repoConfig.settings?.secrets ?? {};
  const { deleteOrphaned, ...entries } = s as Record<string, unknown>;
  return Object.keys(entries).length > 0 || deleteOrphaned === true;
}

export class SecretsProcessor implements ISecretsProcessor {
  constructor(
    private readonly strategy: ISecretsStrategy,
    private readonly encryptor: ISecretEncryptor,
    private readonly envResolver: IEnvResolver
  ) {}

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: SecretsProcessorOptions
  ): Promise<SecretsProcessorResult> {
    const result = await withGitHubGuards<
      SecretsProcessorOptions,
      SecretsProcessorResult
    >(repoConfig, repoInfo, options, {
      hasDesiredSettings: hasDesiredSecrets,
      emptySettingsMessage: "No secrets configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });

    if (result.skipped && !hasDesiredSecrets(repoConfig)) {
      return { ...result, noSecretsConfigured: true };
    }
    return result;
  }

  private async applySettings(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    options: SecretsProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<SecretsProcessorResult> {
    const { dryRun, noDelete } = options;
    const secrets = (repoConfig.settings?.secrets ?? {}) as Record<
      string,
      unknown
    >;
    const configDeleteOrphaned = secrets.deleteOrphaned === true;
    const deleteOrphaned = configDeleteOrphaned && !(noDelete ?? false);

    const secretEntries = secretEntriesOf(repoConfig).filter(
      (entry): entry is [string, SecretConfig] => typeof entry[1] !== "boolean"
    );

    const strategyOptions = { token: effectiveToken, host: githubRepo.host };
    const currentSecrets = await this.strategy.list(
      githubRepo,
      strategyOptions
    );

    const changes = diffSecrets(
      currentSecrets,
      secretEntries.map(([name]) => name),
      deleteOrphaned
    );
    const changeCounts = countActions(changes);
    const planOutput = formatSecretsPlan(changes);

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts, { planOutput });
    }

    const resolvedValues =
      secretEntries.length > 0
        ? this.envResolver.resolveAll(
            secretEntries.map(([name, config]) => ({
              name,
              envVar: config.env,
            }))
          )
        : new Map<string, string>();

    let appliedCount = 0;
    const publicKey =
      secretEntries.length > 0
        ? await this.strategy.getPublicKey(githubRepo, strategyOptions)
        : undefined;

    for (const change of changes) {
      switch (change.action) {
        case "create":
        case "update": {
          const encrypted = await this.encryptor.encrypt(
            resolvedValues.get(change.name)!,
            publicKey!.key
          );
          await this.strategy.upsert(
            githubRepo,
            change.name,
            encrypted,
            publicKey!.key_id,
            strategyOptions
          );
          appliedCount++;
          break;
        }
        case "delete":
          await this.strategy.delete(githubRepo, change.name, strategyOptions);
          appliedCount++;
          break;
        case "unchanged":
          break;
      }
    }

    return buildApplyResult(repoName, changeCounts, appliedCount, {
      planOutput,
    });
  }
}
