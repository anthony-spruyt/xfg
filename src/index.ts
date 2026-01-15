#!/usr/bin/env node

import { program } from "commander";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig, convertContentToString } from "./config.js";
import { parseGitUrl, getRepoDisplayName } from "./repo-detector.js";
import { GitOps, sanitizeBranchName } from "./git-ops.js";
import { createPR } from "./pr-creator.js";
import { logger } from "./logger.js";
import { generateWorkspaceName } from "./workspace-utils.js";

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

      const gitOps = new GitOps({ workDir, dryRun: options.dryRun });

      // Step 1: Clean workspace
      logger.info("Cleaning workspace...");
      gitOps.cleanWorkspace();

      // Step 2: Clone repo
      logger.info("Cloning repository...");
      gitOps.clone(repoInfo.gitUrl);

      // Step 3: Get default branch for PR base
      const { branch: baseBranch, method: detectionMethod } =
        gitOps.getDefaultBranch();
      logger.info(
        `Default branch: ${baseBranch} (detected via ${detectionMethod})`,
      );

      // Step 4: Create/checkout branch
      logger.info(`Switching to branch: ${branchName}`);
      gitOps.createBranch(branchName);

      // Determine if creating or updating (check BEFORE writing)
      const action: "create" | "update" = existsSync(
        join(workDir, config.fileName),
      )
        ? "update"
        : "create";

      // Step 5: Write config file
      logger.info(`Writing ${config.fileName}...`);
      const fileContent = convertContentToString(
        repoConfig.content,
        config.fileName,
      );

      // Step 6: Check for changes
      // In dry-run mode, compare content directly since we don't write the file
      // In normal mode, write the file first then check git status
      const wouldHaveChanges = options.dryRun
        ? gitOps.wouldChange(config.fileName, fileContent)
        : (() => {
            gitOps.writeFile(config.fileName, fileContent);
            return gitOps.hasChanges();
          })();

      if (!wouldHaveChanges) {
        logger.skip(current, repoName, "No changes detected");
        continue;
      }

      // Step 7: Commit
      logger.info("Committing changes...");
      gitOps.commit(`chore: sync ${config.fileName}`);

      // Step 8: Push
      logger.info("Pushing to remote...");
      gitOps.push(branchName);

      // Step 9: Create PR
      logger.info("Creating pull request...");
      const prResult = await createPR({
        repoInfo,
        branchName,
        baseBranch,
        fileName: config.fileName,
        action,
        workDir,
        dryRun: options.dryRun,
      });

      if (prResult.success) {
        logger.success(
          current,
          repoName,
          prResult.url ? `PR: ${prResult.url}` : prResult.message,
        );
      } else {
        logger.error(current, repoName, prResult.message);
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
