import { mkdirSync } from "node:fs";
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
import { parseGitUrl, getRepoDisplayName } from "../repo/index.js";
import { Logger } from "../shared/logger.js";
import { toErrorMessage } from "../shared/type-guards.js";
import {
  buildSettingsReport,
  type ProcessorResults,
} from "./settings-report-builder.js";
import { writeUnifiedSummary } from "./unified-summary.js";
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

type ParsedRepo = { repoInfo: RepoInfo } | { error: unknown };

function hostQualifiedName(repoInfo: RepoInfo): string {
  const name = getRepoDisplayName(repoInfo);
  return "host" in repoInfo ? `${repoInfo.host}/${name}` : name;
}

// owner/repo alone is ambiguous when the same path exists on several hosts.
function repoLabels(repos: RepoConfig[], parsed: ParsedRepo[]): string[] {
  const names = parsed.map((p, i) =>
    "repoInfo" in p ? getRepoDisplayName(p.repoInfo) : repos[i].git
  );
  return parsed.map((p, i) => {
    const shared = names.filter((n) => n === names[i]).length > 1;
    return shared && "repoInfo" in p ? hostQualifiedName(p.repoInfo) : names[i];
  });
}

export async function runSecretsSync(
  options: SecretsSyncOptions,
  deps: SecretsSyncDependencies = {}
): Promise<void> {
  const logger = new Logger(!!(process.env.DEBUG || process.env.XFG_DEBUG));
  const { config: configPath, dryRun, workDir, retries, noDelete } = options;
  const cwd = workDir ?? "./tmp";
  // gh is spawned with this as its cwd; a missing dir surfaces as "spawnSync gh ENOENT".
  mkdirSync(cwd, { recursive: true });

  const rawConfig = loadRawConfig(configPath);
  validateSecretsConfig(rawConfig);
  const config = normalizeConfig(rawConfig, process.env);
  validateNormalizedConfig(config);

  const processorFactory = deps.processorFactory ?? createDefaultProcessor;
  const processor = processorFactory(cwd, retries ?? 3);

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  let hasErrors = false;
  let anySecretsConfigured = false;
  const reportResults: ProcessorResults[] = [];
  logger.setTotal(config.repos.length);

  const parsed = config.repos.map((repoConfig): ParsedRepo => {
    try {
      return {
        repoInfo: parseGitUrl(repoConfig.git, {
          githubHosts: config.githubHosts,
        }),
      };
    } catch (error) {
      return { error };
    }
  });
  const labels = repoLabels(config.repos, parsed);

  for (let i = 0; i < config.repos.length; i++) {
    const repoConfig = config.repos[i];
    const displayName = labels[i];
    const parsedRepo = parsed[i];

    try {
      if ("error" in parsedRepo) throw parsedRepo.error;
      const { repoInfo } = parsedRepo;

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
        logger.skip(i + 1, displayName, result.message);
        continue;
      }

      if (result.success) {
        logger.success(i + 1, displayName, `Secrets: ${result.message}`);
      } else {
        logger.error(i + 1, displayName, `Secrets: ${result.message}`);
        hasErrors = true;
      }
      for (const line of result.planOutput?.lines ?? []) {
        logger.info(line);
      }
      reportResults.push({
        repoName: displayName,
        secretsResult: result,
        ...(result.success ? {} : { error: result.message }),
      });
    } catch (error) {
      anySecretsConfigured = true;
      const message = toErrorMessage(error);
      logger.error(i + 1, displayName, `Secrets: ${message}`);
      reportResults.push({ repoName: displayName, error: message });
      hasErrors = true;
    }
  }

  if (!anySecretsConfigured) {
    logger.info("No secrets configured. Nothing to do.");
  }

  writeUnifiedSummary({
    settings: buildSettingsReport(reportResults),
    dryRun: dryRun ?? false,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
  });

  if (hasErrors) {
    throw new Error("One or more repositories failed secrets sync.");
  }
}
