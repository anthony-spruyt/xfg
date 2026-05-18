import type { GitHubRepoInfo, RepoInfo } from "../repo/index.js";
import type { ISecretsStrategy } from "./types.js";
import type { ISecretEncryptor } from "./encryption.js";
import type { IEnvResolver } from "../shared/env-resolver.js";
import type {
  SecretConfig,
  SecretsConfig,
  RepoConfig,
} from "../config/index.js";
import {
  withGitHubGuards,
  type BaseProcessorOptions,
  type BaseProcessorResult,
  type ISettingsProcessor,
  type ChangeCounts,
  buildDryRunResult,
  buildApplyResult,
} from "../settings/base-processor.js";

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

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: SecretsProcessorOptions
  ): Promise<SecretsProcessorResult> {
    return withGitHubGuards(repoConfig, repoInfo, options, {
      hasDesiredSettings: () => {
        const { deleteOrphaned, ...rawEntries } = this.secretsConfig;
        const secretEntries = Object.entries(rawEntries).filter(
          (entry): entry is [string, SecretConfig] =>
            typeof entry[1] !== "boolean"
        );
        return secretEntries.length > 0 || deleteOrphaned === true;
      },
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
    const { deleteOrphaned: configDeleteOrphaned = false, ...rawEntries } =
      this.secretsConfig;
    const deleteOrphaned = configDeleteOrphaned && !(noDelete ?? false);
    const strategyOptions = { token: effectiveToken, host: githubRepo.host };

    const secretEntries = Object.entries(rawEntries).filter(
      (entry): entry is [string, SecretConfig] => typeof entry[1] !== "boolean"
    );

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
    const currentByName = new Set(
      currentSecrets.map((s) => s.name.toUpperCase())
    );
    const desiredNames = new Set(
      secretEntries.map(([name]) => name.toUpperCase())
    );

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let unchanged = 0;

    // Count unchanged: secrets that exist and are desired (will be upserted but already exist)
    // For secrets we can't diff values (encrypted), so existing+desired = "updated", not "unchanged"
    // Only truly unchanged are those not in either set — but that's not applicable here.
    // We track unchanged as: current secrets that are desired (they get upserted but logically "exist")
    // Actually: since we always upsert (can't read secret values), existing desired secrets are "update"
    // and missing desired secrets are "create". Unchanged count stays 0.

    if (!dryRun) {
      if (secretEntries.length > 0) {
        const publicKey = await this.strategy.getPublicKey(
          githubRepo,
          strategyOptions
        );

        for (const [name] of secretEntries) {
          const value = resolvedValues.get(name)!;
          const encrypted = await this.encryptor.encrypt(value, publicKey.key);
          await this.strategy.upsert({
            repoInfo: githubRepo,
            name,
            encryptedValue: encrypted,
            keyId: publicKey.key_id,
            options: strategyOptions,
          });
          if (currentByName.has(name.toUpperCase())) {
            updated++;
          } else {
            created++;
          }
        }
      }

      if (deleteOrphaned) {
        for (const current of currentSecrets) {
          if (!desiredNames.has(current.name.toUpperCase())) {
            await this.strategy.delete(
              githubRepo,
              current.name,
              strategyOptions
            );
            deleted++;
          }
        }
      }
    } else {
      for (const [name] of secretEntries) {
        if (currentByName.has(name.toUpperCase())) {
          updated++;
        } else {
          created++;
        }
      }
      if (deleteOrphaned) {
        for (const current of currentSecrets) {
          if (!desiredNames.has(current.name.toUpperCase())) {
            deleted++;
          }
        }
      }
    }

    // Count unchanged: current secrets that are desired and not being deleted
    // (they're upserted, so they count as "updated" above, not "unchanged")
    // For secrets, unchanged is not meaningful since we always upsert.

    const changeCounts: ChangeCounts = {
      create: created,
      update: updated,
      delete: deleted,
      unchanged,
    };

    if (dryRun) {
      return buildDryRunResult(repoName, changeCounts);
    }

    const appliedCount = created + updated + deleted;
    return buildApplyResult(repoName, changeCounts, appliedCount);
  }
}
