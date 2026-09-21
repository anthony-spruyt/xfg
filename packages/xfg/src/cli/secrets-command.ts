import {
  loadRawConfig,
  normalizeConfig,
  validateSecretsConfig,
  validateNormalizedConfig,
} from "../config/index.js";
import {
  SecretsProcessor,
  GitHubSecretsStrategy,
  SodiumEncryptor,
} from "../settings/secrets/index.js";
import { EnvResolver } from "../shared/env-resolver.js";
import { ProcessExecutor } from "../shared/command-executor.js";
import { parseGitUrl } from "../repo/index.js";
import { Logger } from "../shared/logger.js";
import { toErrorMessage } from "../shared/type-guards.js";
import type { SecretsProcessorResult } from "../settings/secrets/index.js";
import type { RepoConfig } from "../config/index.js";
import type { RepoInfo } from "../repo/index.js";

export interface ISecretsProcessorAdapter {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: { dryRun?: boolean; token?: string; noDelete?: boolean }
  ): Promise<SecretsProcessorResult>;
}

export interface SecretsSyncDependencies {
  processorFactory?: (cwd: string, retries: number) => ISecretsProcessorAdapter;
}

export interface SecretsSyncOptions {
  config: string;
  dryRun?: boolean;
  noDelete?: boolean;
  workDir?: string;
  retries?: number;
}

function createDefaultProcessor(
  cwd: string,
  retries: number
): ISecretsProcessorAdapter {
  const executor = new ProcessExecutor(process.env);
  const encryptor = new SodiumEncryptor();
  const envResolver = new EnvResolver(process.env);
  const strategy = new GitHubSecretsStrategy(executor, {
    cwd,
    retries,
  });
  return new SecretsProcessor(strategy, encryptor, envResolver);
}

export async function runSecretsSync(
  options: SecretsSyncOptions,
  deps: SecretsSyncDependencies = {}
): Promise<void> {
  const logger = new Logger(!!(process.env.DEBUG || process.env.XFG_DEBUG));
  const { config: configPath, dryRun, workDir, retries, noDelete } = options;
  const cwd = workDir ?? "./tmp";

  const rawConfig = loadRawConfig(configPath);
  validateSecretsConfig(rawConfig);
  const config = normalizeConfig(rawConfig, process.env);
  validateNormalizedConfig(config);

  const processorFactory = deps.processorFactory ?? createDefaultProcessor;
  const processor = processorFactory(cwd, retries ?? 3);

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  let hasErrors = false;
  let anySecretsConfigured = false;
  logger.setTotal(config.repos.length);

  for (let i = 0; i < config.repos.length; i++) {
    const repoConfig = config.repos[i];
    const repoName = repoConfig.git;

    try {
      const repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });

      const result = await processor.process(repoConfig, repoInfo, {
        dryRun,
        token,
        noDelete,
      });

      if (result.noSecretsConfigured) {
        // Silent: with per-repo scoping most repos have no secrets, and a line
        // each would bury the repos that do.
        continue;
      }

      anySecretsConfigured = true;

      if (result.skipped) {
        logger.skip(i + 1, repoName, result.message);
      } else if (result.success) {
        logger.success(i + 1, repoName, `Secrets: ${result.message}`);
      } else {
        logger.error(i + 1, repoName, `Secrets: ${result.message}`);
        hasErrors = true;
      }
    } catch (error) {
      anySecretsConfigured = true;
      logger.error(i + 1, repoName, `Secrets: ${toErrorMessage(error)}`);
      hasErrors = true;
    }
  }

  if (!anySecretsConfigured) {
    logger.info("No secrets configured. Nothing to do.");
  }

  if (hasErrors) {
    throw new Error("One or more repositories failed secrets sync.");
  }
}
