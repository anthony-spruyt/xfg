import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadRawConfig, normalizeConfig } from "../config/index.js";
import { validateForSync } from "../config/validator.js";
import {
  hasGitHubAppCredentials,
  GitHubAppTokenManager,
} from "../vcs/index.js";
import { logger } from "../shared/logger.js";
import type { RepoResult } from "../output/github-summary.js";
import { formatSettingsReportCLI } from "../output/settings-report.js";
import { writeUnifiedSummary } from "../output/unified-summary.js";
import { buildSettingsReport } from "./settings-report-builder.js";
import { SharedOptions } from "./sync-command.js";
import {
  ProcessorFactory,
  defaultProcessorFactory,
  RulesetProcessorFactory,
  defaultRulesetProcessorFactory,
  RepoSettingsProcessorFactory,
  defaultRepoSettingsProcessorFactory,
  LabelsProcessorFactory,
  defaultLabelsProcessorFactory,
} from "./types.js";
import {
  RepoLifecycleManager,
  type IRepoLifecycleManager,
} from "../lifecycle/index.js";
import { ResultsCollector } from "./settings/results-collector.js";
import { runLifecycleChecks } from "./settings/lifecycle-checks.js";
import { processRulesets } from "./settings/process-rulesets.js";
import { processRepoSettings } from "./settings/process-repo-settings.js";
import { processLabels } from "./settings/process-labels.js";

/**
 * Options for the settings command.
 */
export type SettingsOptions = SharedOptions;

/**
 * Run the settings command - manages GitHub Rulesets, repo settings, and labels.
 */
export async function runSettings(
  options: SettingsOptions,
  processorFactory: RulesetProcessorFactory = defaultRulesetProcessorFactory,
  repoProcessorFactory: ProcessorFactory = defaultProcessorFactory,
  repoSettingsProcessorFactory: RepoSettingsProcessorFactory = defaultRepoSettingsProcessorFactory,
  lifecycleManager?: IRepoLifecycleManager,
  labelsProcessorFactory: LabelsProcessorFactory = defaultLabelsProcessorFactory
): Promise<void> {
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  console.log(`Loading config from: ${configPath}`);
  if (options.dryRun) {
    console.log("Running in DRY RUN mode - no changes will be made\n");
  }

  const rawConfig = loadRawConfig(configPath);

  try {
    validateForSync(rawConfig);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const config = normalizeConfig(rawConfig);

  const reposWithRulesets = config.repos.filter(
    (r) => r.settings?.rulesets && Object.keys(r.settings.rulesets).length > 0
  );

  const reposWithRepoSettings = config.repos.filter(
    (r) => r.settings?.repo && Object.keys(r.settings.repo).length > 0
  );

  const reposWithLabels = config.repos.filter(
    (r) => r.settings?.labels && Object.keys(r.settings.labels).length > 0
  );

  if (
    reposWithRulesets.length === 0 &&
    reposWithRepoSettings.length === 0 &&
    reposWithLabels.length === 0
  ) {
    console.log(
      "No settings configured. Add settings.rulesets, settings.repo, or settings.labels to your config."
    );
    return;
  }

  if (reposWithRulesets.length > 0) {
    console.log(`Found ${reposWithRulesets.length} repositories with rulesets`);
  }
  if (reposWithRepoSettings.length > 0) {
    console.log(
      `Found ${reposWithRepoSettings.length} repositories with repo settings`
    );
  }
  if (reposWithLabels.length > 0) {
    console.log(`Found ${reposWithLabels.length} repositories with labels`);
  }
  console.log("");
  logger.setTotal(
    reposWithRulesets.length +
      reposWithRepoSettings.length +
      reposWithLabels.length
  );

  const processor = processorFactory();
  const lm =
    lifecycleManager ?? new RepoLifecycleManager(undefined, options.retries);
  const tokenManager = hasGitHubAppCredentials()
    ? new GitHubAppTokenManager(
        process.env.XFG_GITHUB_APP_ID!,
        process.env.XFG_GITHUB_APP_PRIVATE_KEY!
      )
    : null;
  const results: RepoResult[] = [];
  const collector = new ResultsCollector();

  // Pre-check lifecycle for all unique repos before processing
  const allRepos = [
    ...reposWithRulesets,
    ...reposWithRepoSettings,
    ...reposWithLabels,
  ];
  const lifecycleSkipped = await runLifecycleChecks(
    allRepos,
    config,
    options,
    lm,
    results,
    collector,
    tokenManager
  );

  await processRulesets(
    reposWithRulesets,
    config,
    options,
    processor,
    results,
    collector,
    lifecycleSkipped
  );

  await processRepoSettings(
    reposWithRepoSettings,
    config,
    options,
    repoSettingsProcessorFactory,
    results,
    collector,
    lifecycleSkipped,
    reposWithRulesets.length
  );

  await processLabels(
    reposWithLabels,
    config,
    options,
    labelsProcessorFactory(),
    results,
    collector,
    lifecycleSkipped,
    reposWithRulesets.length + reposWithRepoSettings.length
  );

  console.log("");
  const report = buildSettingsReport(collector.getAll());
  const lines = formatSettingsReportCLI(report);
  for (const line of lines) {
    console.log(line);
  }
  writeUnifiedSummary({ settings: report, dryRun: options.dryRun ?? false });

  const hasErrors = report.repos.some((r) => r.error);
  if (hasErrors) {
    process.exit(1);
  }
}
