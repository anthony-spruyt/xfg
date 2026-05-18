import type { GitHubRepoInfo, RepoInfo } from "../../repo/index.js";
import type { ISecretsStrategy } from "./types.js";
import type { ISecretEncryptor } from "./encryption.js";
import type { IEnvResolver } from "../../shared/env-resolver.js";
import type {
  SecretConfig,
  SecretsConfig,
  RepoConfig,
} from "../../config/index.js";
import {
  withGitHubGuards,
  countActions,
  type BaseProcessorOptions,
  type BaseProcessorResult,
  type ISettingsProcessor,
  type ChangeCounts,
  buildDryRunResult,
  buildApplyResult,
} from "../base-processor.js";
import { diffSecrets } from "./diff.js";

export type ISecretsProcessor = ISettingsProcessor<
  SecretsProcessorOptions,
  SecretsProcessorResult
>;

export interface SecretsProcessorOptions extends BaseProcessorOptions {
  noDelete?: boolean;
}

export interface SecretsProcessorResult extends BaseProcessorResult {
  changes?: ChangeCounts;
}

export class SecretsProcessor implements ISecretsProcessor {
  constructor(
    private readonly strategy: ISecretsStrategy,
    private readonly encryptor: ISecretEncryptor,
    private readonly envResolver: IEnvResolver,
    private readonly secretsConfig: SecretsConfig
  ) {}

  private getSecretEntries(): [string, SecretConfig][] {
    const { deleteOrphaned: _, ...rawEntries } = this.secretsConfig;
    return Object.entries(rawEntries).filter(
      (entry): entry is [string, SecretConfig] => typeof entry[1] !== "boolean"
    );
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: SecretsProcessorOptions
  ): Promise<SecretsProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: () =>
        this.getSecretEntries().length > 0 ||
        this.secretsConfig.deleteOrphaned === true,
      emptySettingsMessage: "No secrets configured",
      applySettings: (githubRepo, _rc, opts, token, repoName) =>
        this.applySettings(githubRepo, opts, token, repoName),
    });
  }

  private async applySettings(
    githubRepo: GitHubRepoInfo,
    options: SecretsProcessorOptions,
    effectiveToken: string | undefined,
    repoName: string
  ): Promise<SecretsProcessorResult> {
    const { dryRun, noDelete } = options;
    const deleteOrphaned =
      (this.secretsConfig.deleteOrphaned ?? false) && !(noDelete ?? false);
    const strategyOptions = { token: effectiveToken, host: githubRepo.host };
    const secretEntries = this.getSecretEntries();

    let resolvedValues: Map<string, string>;
    if (!dryRun && secretEntries.length > 0) {
      resolvedValues = this.envResolver.resolveAll(
        secretEntries.map(([name, config]) => ({
          name,
          envVar: config.env,
        }))
      );
    } else {
      resolvedValues = new Map();
    }

    const currentSecrets = await this.strategy.list(
      githubRepo,
      strategyOptions
    );

    const desiredNames = secretEntries.map(([name]) => name);
    const changes = diffSecrets(currentSecrets, desiredNames, deleteOrphaned);
    const changeCounts = countActions(changes);

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts);
    }

    if (secretEntries.length > 0) {
      const publicKey = await this.strategy.getPublicKey(
        githubRepo,
        strategyOptions
      );

      for (const change of changes) {
        if (change.action === "create" || change.action === "update") {
          const value = resolvedValues.get(change.name)!;
          const encrypted = await this.encryptor.encrypt(value, publicKey.key);
          await this.strategy.upsert({
            repoInfo: githubRepo,
            name: change.name,
            encryptedValue: encrypted,
            keyId: publicKey.key_id,
            options: strategyOptions,
          });
        }
      }
    }

    for (const change of changes) {
      if (change.action === "delete") {
        await this.strategy.delete(githubRepo, change.name, strategyOptions);
      }
    }

    const appliedCount =
      changeCounts.create + changeCounts.update + changeCounts.delete;
    return buildApplyResult(repoName, changeCounts, appliedCount);
  }
}
