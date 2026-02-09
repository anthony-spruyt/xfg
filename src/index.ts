#!/usr/bin/env node

import { program, Command } from "commander";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MergeMode, MergeStrategy } from "./config.js";
import { runSync } from "./cli/sync-command.js";
import { runSettings } from "./cli/settings-command.js";
import type { SyncOptions } from "./cli/sync-command.js";
import type { SettingsOptions } from "./cli/settings-command.js";

// Re-export for backwards compatibility with tests and external consumers
export { runSync, runSettings } from "./cli/index.js";

export type {
  SyncOptions,
  SettingsOptions,
  SharedOptions,
} from "./cli/index.js";

export {
  type IRepositoryProcessor,
  type ProcessorFactory,
  defaultProcessorFactory,
  type IRulesetProcessor,
  type RulesetProcessorFactory,
  defaultRulesetProcessorFactory,
  type RepoSettingsProcessorFactory,
  defaultRepoSettingsProcessorFactory,
} from "./cli/index.js";

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
) as { version: string };

// =============================================================================
// Shared CLI Options
// =============================================================================

/**
 * Adds shared options to a command.
 */
function addSharedOptions(cmd: Command): Command {
  return cmd
    .requiredOption("-c, --config <path>", "Path to YAML config file")
    .option("-d, --dry-run", "Show what would be done without making changes")
    .option("-w, --work-dir <path>", "Temporary directory for cloning", "./tmp")
    .option(
      "-r, --retries <number>",
      "Number of retries for network operations (0 to disable)",
      (v) => parseInt(v, 10),
      3
    )
    .option(
      "--no-delete",
      "Skip deletion of orphaned resources even if deleteOrphaned is configured"
    );
}

// =============================================================================
// CLI Program
// =============================================================================

program
  .name("xfg")
  .description("Sync files and manage settings across repositories")
  .version(packageJson.version);

// Sync command (file synchronization)
const syncCommand = new Command("sync")
  .description("Sync configuration files across repositories (default command)")
  .option(
    "-b, --branch <name>",
    "Override the branch name (default: chore/sync-{filename} or chore/sync-config)"
  )
  .option(
    "-m, --merge <mode>",
    "PR merge mode: manual, auto (default, merge when checks pass), force (bypass requirements), direct (push to default branch, no PR)",
    (value: string): MergeMode => {
      const valid: MergeMode[] = ["manual", "auto", "force", "direct"];
      if (!valid.includes(value as MergeMode)) {
        throw new Error(
          `Invalid merge mode: ${value}. Valid: ${valid.join(", ")}`
        );
      }
      return value as MergeMode;
    }
  )
  .option(
    "--merge-strategy <strategy>",
    "Merge strategy: merge, squash (default), rebase",
    (value: string): MergeStrategy => {
      const valid: MergeStrategy[] = ["merge", "squash", "rebase"];
      if (!valid.includes(value as MergeStrategy)) {
        throw new Error(
          `Invalid merge strategy: ${value}. Valid: ${valid.join(", ")}`
        );
      }
      return value as MergeStrategy;
    }
  )
  .option("--delete-branch", "Delete source branch after merge")
  .action((opts) => {
    runSync(opts as SyncOptions).catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
  });

addSharedOptions(syncCommand);
program.addCommand(syncCommand);

// Settings command (ruleset management)
const settingsCommand = new Command("settings")
  .description("Manage GitHub Rulesets for repositories")
  .action((opts) => {
    runSettings(opts as SettingsOptions).catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
  });

addSharedOptions(settingsCommand);
program.addCommand(settingsCommand);

// Export program for CLI entry point
export { program };
