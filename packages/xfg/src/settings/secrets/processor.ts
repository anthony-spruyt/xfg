import type {
  GitHubRepoInfo,
  IRepoMetadataProvider,
  RepoInfo,
} from "../../repo/index.js";
import type { RepoConfig, SecretConfig } from "../../config/index.js";
import type { ISecretsStrategy, GitHubPublicKey } from "./types.js";
import type { IEnvironmentSecretsStrategy } from "../environments/types.js";
import type { GhApiOptions } from "../../shared/gh-api-utils.js";
import { quoted } from "../../shared/string-utils.js";
import type { ISecretEncryptor } from "./encryption.js";
import type { IEnvResolver } from "../../shared/env-resolver.js";
import {
  noAppInstallationMessage,
  type IGitHubTokenProvider,
} from "../../shared/gh-token-utils.js";
import { diffSecrets, type SecretChange } from "./diff.js";
import { formatSecretsPlan, type SecretsPlanResult } from "./formatter.js";
import { toErrorMessage } from "../../shared/type-guards.js";
import {
  withGitHubGuards,
  type BaseProcessorOptions,
  type BaseProcessorResult,
  type ISettingsProcessor,
  type ChangeCounts,
  countActions,
  isActiveAction,
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
  warnings?: string[];
}

export interface EnvironmentSecretsDependencies {
  strategy: IEnvironmentSecretsStrategy;
  metadataProvider: IRepoMetadataProvider;
}

interface EnvironmentSecrets {
  /** GitHub's spelling when the environment exists, else the config key */
  environment: string;
  exists: boolean;
  entries: [string, SecretConfig][];
}

interface ScopeKey {
  values: Map<string, string>;
  publicKey: GitHubPublicKey;
}

function secretEntriesOf(
  repoConfig: RepoConfig
): [string, SecretConfig | boolean][] {
  const { deleteOrphaned: _d, ...entries } = (repoConfig.settings?.secrets ??
    {}) as Record<string, SecretConfig | boolean>;
  return Object.entries(entries);
}

function hasRepoSecrets(repoConfig: RepoConfig): boolean {
  const s = repoConfig.settings?.secrets ?? {};
  const { deleteOrphaned, ...entries } = s as Record<string, unknown>;
  return Object.keys(entries).length > 0 || deleteOrphaned === true;
}

function environmentSecretsOf(
  repoConfig: RepoConfig
): [string, [string, SecretConfig][]][] {
  return Object.entries(repoConfig.settings?.environments ?? {})
    .map(([name, env]): [string, [string, SecretConfig][]] => [
      name,
      Object.entries(env.secrets ?? {}),
    ])
    .filter(([, entries]) => entries.length > 0);
}

function missingEnvironmentWarning(repoName: string, env: string): string {
  return `${repoName}: environment ${quoted(env)} does not exist - its secrets were skipped (environments on private repos need a paid GitHub plan; on a paid plan, run 'xfg sync' first)`;
}

export class SecretsProcessor implements ISecretsProcessor {
  constructor(
    private readonly strategy: ISecretsStrategy,
    private readonly encryptor: ISecretEncryptor,
    private readonly envResolver: IEnvResolver,
    private readonly tokenProvider?: IGitHubTokenProvider,
    private readonly environments?: EnvironmentSecretsDependencies
  ) {}

  private hasDesiredSecrets(repoConfig: RepoConfig): boolean {
    return (
      hasRepoSecrets(repoConfig) ||
      (this.environments !== undefined &&
        environmentSecretsOf(repoConfig).length > 0)
    );
  }

  async process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: SecretsProcessorOptions
  ): Promise<SecretsProcessorResult> {
    const result = await withGitHubGuards<
      SecretsProcessorOptions,
      SecretsProcessorResult
    >(repoConfig, repoInfo, options, {
      hasDesiredSettings: (rc) => this.hasDesiredSecrets(rc),
      emptySettingsMessage: "No secrets configured",
      applySettings: (githubRepo, rc, opts, token, repoName) =>
        this.applySettings(githubRepo, rc, opts, token, repoName),
    });

    if (result.skipped && !this.hasDesiredSecrets(repoConfig)) {
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
    let token = effectiveToken;
    if (this.tokenProvider) {
      const resolved = await this.tokenProvider.getToken(githubRepo, repoName);
      if (resolved.skipped) {
        // A missed rotation must fail the run, not pass as a skip.
        return {
          success: false,
          repoName,
          message: `Failed: ${noAppInstallationMessage(githubRepo.owner)}`,
        };
      }
      token = resolved.token;
    }

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

    const strategyOptions = { token, host: githubRepo.host };
    const repoChanges =
      secretEntries.length > 0 || deleteOrphaned
        ? diffSecrets(
            await this.strategy.list(githubRepo, strategyOptions),
            secretEntries.map(([name]) => name),
            deleteOrphaned
          )
        : [];
    const envGroups = await this.readEnvironments(
      githubRepo,
      repoConfig,
      strategyOptions
    );
    const envChanges = await this.diffEnvironmentSecrets(
      githubRepo,
      envGroups,
      strategyOptions
    );

    if (dryRun) {
      const planned = [...repoChanges, ...envChanges];
      return buildDryRunResult(repoName, countActions(planned), {
        planOutput: formatSecretsPlan(planned, true),
      });
    }

    const gate = await this.gateMissingEnvironments(
      githubRepo,
      envGroups,
      strategyOptions,
      repoName
    );
    if (gate.error) {
      return { success: false, repoName, message: `Failed: ${gate.error}` };
    }
    const writableGroups = envGroups.filter((g) => g.exists);
    const writable = new Set(writableGroups.map((g) => g.environment));
    const changes = [
      ...repoChanges,
      ...envChanges.filter((c) => writable.has(c.environment!)),
    ];
    const extra = gate.warnings.length > 0 ? { warnings: gate.warnings } : {};

    const repoValues = this.resolve(secretEntries);
    const envValues = writableGroups.map((g) => this.resolve(g.entries));
    const scopes = new Map<string | undefined, ScopeKey>();
    if (secretEntries.length > 0) {
      scopes.set(undefined, {
        values: repoValues,
        publicKey: await this.strategy.getPublicKey(githubRepo, strategyOptions),
      });
    }
    for (const [i, g] of writableGroups.entries()) {
      scopes.set(g.environment, {
        values: envValues[i],
        publicKey: await this.environments!.strategy.getSecretsPublicKey(
          githubRepo,
          g.environment,
          strategyOptions
        ),
      });
    }

    const applied: SecretChange[] = [];
    try {
      for (const change of changes.filter(isActiveAction)) {
        await this.writeChange(githubRepo, change, scopes, strategyOptions);
        applied.push(change);
      }
    } catch (error) {
      // Report what already landed: the writes are not rolled back.
      return {
        success: false,
        repoName,
        message: `Failed: ${toErrorMessage(error)}`,
        changes: countActions(applied),
        planOutput: formatSecretsPlan(applied, false),
        ...extra,
      };
    }

    return buildApplyResult(repoName, countActions(changes), applied.length, {
      planOutput: formatSecretsPlan(changes, false),
      ...extra,
    });
  }

  private async writeChange(
    githubRepo: GitHubRepoInfo,
    change: SecretChange,
    scopes: Map<string | undefined, ScopeKey>,
    strategyOptions: GhApiOptions
  ): Promise<void> {
    if (change.action === "delete") {
      await this.strategy.delete(githubRepo, change.name, strategyOptions);
      return;
    }
    const { values, publicKey } = scopes.get(change.environment)!;
    const encrypted = await this.encryptor.encrypt(
      values.get(change.name)!,
      publicKey.key
    );
    if (change.environment === undefined) {
      await this.strategy.upsert(
        githubRepo,
        change.name,
        encrypted,
        publicKey.key_id,
        strategyOptions
      );
    } else {
      await this.environments!.strategy.upsertSecret(
        githubRepo,
        change.environment,
        change.name,
        encrypted,
        publicKey.key_id,
        strategyOptions
      );
    }
  }

  /** On a public repo a missing environment is an error; elsewhere it may be the plan, so warn and skip. */
  private async gateMissingEnvironments(
    githubRepo: GitHubRepoInfo,
    groups: EnvironmentSecrets[],
    strategyOptions: GhApiOptions,
    repoName: string
  ): Promise<{ error?: string; warnings: string[] }> {
    const missing = groups.filter((g) => !g.exists);
    if (missing.length === 0) return { warnings: [] };
    const { visibility } = await this.environments!.metadataProvider.getMetadata(
      githubRepo,
      strategyOptions
    );
    if (visibility === "public") {
      return {
        error: `environment ${quoted(missing[0].environment)} does not exist. Run 'xfg sync' first to create it.`,
        warnings: [],
      };
    }
    return {
      warnings: missing.map((g) =>
        missingEnvironmentWarning(repoName, g.environment)
      ),
    };
  }

  private resolve(entries: [string, SecretConfig][]): Map<string, string> {
    if (entries.length === 0) return new Map();
    return this.envResolver.resolveAll(
      entries.map(([name, config]) => ({ name, envVar: config.env }))
    );
  }

  private async readEnvironments(
    githubRepo: GitHubRepoInfo,
    repoConfig: RepoConfig,
    strategyOptions: GhApiOptions
  ): Promise<EnvironmentSecrets[]> {
    const configured = this.environments
      ? environmentSecretsOf(repoConfig)
      : [];
    if (configured.length === 0) return [];
    const current = await this.environments!.strategy.list(
      githubRepo,
      strategyOptions
    );
    const existing = new Map(
      current.map((env) => [env.name.toLowerCase(), env.name])
    );
    return configured.map(([name, entries]) => {
      const actual = existing.get(name.toLowerCase());
      return {
        environment: actual ?? name,
        exists: actual !== undefined,
        entries,
      };
    });
  }

  private async diffEnvironmentSecrets(
    githubRepo: GitHubRepoInfo,
    groups: EnvironmentSecrets[],
    strategyOptions: GhApiOptions
  ): Promise<SecretChange[]> {
    const changes: SecretChange[] = [];
    for (const group of groups) {
      const current = group.exists
        ? await this.environments!.strategy.listSecrets(
            githubRepo,
            group.environment,
            strategyOptions
          )
        : [];
      const names = group.entries.map(([name]) => name);
      for (const change of diffSecrets(current, names, false)) {
        changes.push({ ...change, environment: group.environment });
      }
    }
    return changes;
  }
}
