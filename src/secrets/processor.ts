import {
  isGitHubRepo,
  getRepoDisplayName,
  type GitHubRepoInfo,
  type RepoInfo,
} from "../repo/index.js";
import type { ISecretsStrategy } from "./types.js";
import type { ISecretEncryptor } from "./encryption.js";
import type { IEnvResolver } from "../shared/env-resolver.js";
import type { SecretConfig, SecretsConfig } from "../config/index.js";

export interface SecretsProcessorOptions {
  dryRun?: boolean;
  token?: string;
  noDelete?: boolean;
}

export interface SecretsProcessorResult {
  success: boolean;
  repoName: string;
  message: string;
  skipped?: boolean;
  dryRun?: boolean;
  created: number;
  updated: number;
  deleted: number;
}

export class SecretsProcessor {
  constructor(
    private readonly strategy: ISecretsStrategy,
    private readonly encryptor: ISecretEncryptor,
    private readonly envResolver: IEnvResolver
  ) {}

  async process(
    secretsConfig: SecretsConfig,
    repoInfo: RepoInfo,
    options: SecretsProcessorOptions
  ): Promise<SecretsProcessorResult> {
    const repoName = getRepoDisplayName(repoInfo);

    if (!isGitHubRepo(repoInfo)) {
      return {
        success: true,
        repoName,
        message: "Skipped: not a GitHub repository",
        skipped: true,
        created: 0,
        updated: 0,
        deleted: 0,
      };
    }

    const githubRepo = repoInfo as GitHubRepoInfo;
    const { deleteOrphaned: configDeleteOrphaned = false, ...rawEntries } =
      secretsConfig;
    const { dryRun, token, noDelete } = options;
    const deleteOrphaned = configDeleteOrphaned && !(noDelete ?? false);
    const strategyOptions = { token, host: githubRepo.host };

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

    const parts: string[] = [];
    if (created > 0) parts.push(`${created} created`);
    if (updated > 0) parts.push(`${updated} updated`);
    if (deleted > 0) parts.push(`${deleted} deleted`);
    const summary = parts.length > 0 ? parts.join(", ") : "no changes";

    if (dryRun) {
      return {
        success: true,
        repoName,
        message: `[DRY RUN] ${summary}`,
        dryRun: true,
        created,
        updated,
        deleted,
      };
    }

    return {
      success: true,
      repoName,
      message: summary,
      created,
      updated,
      deleted,
    };
  }
}
