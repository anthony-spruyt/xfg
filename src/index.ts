#!/usr/bin/env node

import { program } from "commander";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { parseGitUrl, getRepoDisplayName } from "./repo-detector.js";
import { sanitizeBranchName } from "./git-ops.js";
import { logger } from "./logger.js";
import { generateWorkspaceName } from "./workspace-utils.js";
import { RepositoryProcessor } from "./repository-processor.js";

interface CLIOptions {
  config: string;
  dryRun?: boolean;
  workDir?: string;
}

program
  .name("json-config-sync")
  .description("Sync JSON configuration files across multiple repositories")
  .version("1.0.0")
  .requiredOption("-c, --config <path>", "Path to YAML config file")
  .option("-d, --dry-run", "Show what would be done without making changes")
  .option("-w, --work-dir <path>", "Temporary directory for cloning", "./tmp")
  .parse();

const options = program.opts<CLIOptions>();

async function main(): Promise<void> {
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  console.log(`Loading config from: ${configPath}`);
  if (options.dryRun) {
    console.log("Running in DRY RUN mode - no changes will be made\n");
  }

  const config = loadConfig(configPath);
  const branchName = `chore/sync-${sanitizeBranchName(config.fileName)}`;

  logger.setTotal(config.repos.length);
  console.log(`Found ${config.repos.length} repositories to process`);
  console.log(`Target file: ${config.fileName}`);
  console.log(`Branch: ${branchName}\n`);

  const processor = new RepositoryProcessor();

  for (let i = 0; i < config.repos.length; i++) {
    const repoConfig = config.repos[i];
    const current = i + 1;

    let repoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(current, repoConfig.git, message);
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);
    const workDir = resolve(
      join(options.workDir ?? "./tmp", generateWorkspaceName(i)),
    );

    try {
      logger.progress(current, repoName, "Processing...");

      const result = await processor.process(repoConfig, repoInfo, {
        fileName: config.fileName,
        branchName,
        workDir,
        dryRun: options.dryRun,
      });

      if (result.skipped) {
        logger.skip(current, repoName, result.message);
      } else if (result.success) {
        logger.success(
          current,
          repoName,
          result.prUrl ? `PR: ${result.prUrl}` : result.message,
        );
      } else {
        logger.error(current, repoName, result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(current, repoName, message);
    }
  }

  logger.summary();

  if (logger.hasFailures()) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
