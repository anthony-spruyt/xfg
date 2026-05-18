import {
  loadRawConfig,
  normalizeConfig,
  validateRawConfig,
  validateSecretsConfig,
  validateVariableSecretOverlaps,
} from "../config/index.js";
import {
  SecretsProcessor,
  GitHubSecretsStrategy,
  SodiumEncryptor,
  type ISecretsProcessor,
  type SecretsProcessorResult,
} from "../secrets/index.js";
import { EnvResolver } from "../shared/env-resolver.js";
import { ProcessExecutor } from "../shared/command-executor.js";
import {
  parseGitUrl,
  isGitHubRepo,
  type GitHubRepoInfo,
} from "../repo/index.js";
import { Logger } from "../shared/logger.js";
import { toErrorMessage } from "../shared/type-guards.js";
import { resolveGitHubToken } from "../shared/gh-token-utils.js";
import type { Config, RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../repo/index.js";

export interface ISecretsProcessorAdapter {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: { dryRun?: boolean; token?: string; noDelete?: boolean }
  ): Promise<SecretsProcessorResult>;
}

export interface SecretsSyncDependencies {
  processorFactory?: (
    config: Config,
    cwd: string,
    retries: number
  ) => ISecretsProcessorAdapter;
}

export interface SecretsSyncOptions {
  config: string;
  dryRun?: boolean;
  noDelete?: boolean;
  workDir?: string;
  retries?: number;
}

function createDefaultProcessor(
  config: Config,
  cwd: string,
  retries: number
): ISecretsProcessor {
  const executor = new ProcessExecutor(process.env);
  const encryptor = new SodiumEncryptor();
  const envResolver = new EnvResolver(process.env);
  const strategy = new GitHubSecretsStrategy(executor, {
    cwd,
    retries,
  });
  return new SecretsProcessor(
    strategy,
    encryptor,
    envResolver,
    config.secrets!
  );
}

export async function runSecretsSync(
  options: SecretsSyncOptions,
  deps: SecretsSyncDependencies = {}
): Promise<void> {
  const logger = new Logger(!!(process.env.DEBUG || process.env.XFG_DEBUG));
  const { config: configPath, dryRun, workDir, retries, noDelete } = options;
  const cwd = workDir ?? "./tmp";

  const rawConfig = loadRawConfig(configPath);
  validateRawConfig(rawConfig);
  validateSecretsConfig(rawConfig);
  validateVariableSecretOverlaps(rawConfig);
  const config = normalizeConfig(rawConfig, process.env);

  if (!config.secrets) {
    logger.info("No secrets configured. Nothing to do.");
    return;
  }

  const { deleteOrphaned, ...secretEntries } = config.secrets;
  const secretNames = Object.keys(secretEntries).filter(
    (k) => typeof secretEntries[k] !== "boolean"
  );

  if (secretNames.length === 0 && !deleteOrphaned) {
    logger.info("No secrets configured. Nothing to do.");
    return;
  }

  const processorFactory = deps.processorFactory ?? createDefaultProcessor;
  const processor = processorFactory(config, cwd, retries ?? 3);

  let hasErrors = false;
  logger.setTotal(config.repos.length);

  for (let i = 0; i < config.repos.length; i++) {
    const repoConfig = config.repos[i];
    const repoName = repoConfig.git;

    try {
      const repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });

      const token = isGitHubRepo(repoInfo)
        ? (
            await resolveGitHubToken({
              repoInfo: repoInfo as GitHubRepoInfo,
              tokenManager: null,
              context: repoName,
              log: logger,
              envToken: process.env.GH_TOKEN,
            })
          ).token
        : undefined;

      const result = await processor.process(repoConfig, repoInfo, {
        dryRun,
        token,
        noDelete,
      });

      if (result.skipped) {
        logger.skip(i + 1, repoName, result.message);
      } else if (result.success) {
        logger.success(i + 1, repoName, `Secrets: ${result.message}`);
      } else {
        logger.error(i + 1, repoName, `Secrets: ${result.message}`);
        hasErrors = true;
      }
    } catch (error) {
      logger.error(i + 1, repoName, `Secrets: ${toErrorMessage(error)}`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    throw new Error("One or more repositories failed secrets sync.");
  }
}
