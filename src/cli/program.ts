import { program, Command } from "commander";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MergeMode, MergeStrategy } from "../config/index.js";
import { ValidationError } from "../shared/errors.js";
import { runSync } from "./sync-command.js";
import type { SyncOptions } from "./sync-command.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "../..", "package.json"), "utf-8")
    ) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

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
// Validators
// =============================================================================

export function parseMergeMode(value: string): MergeMode {
  const valid: MergeMode[] = ["manual", "auto", "force", "direct"];
  if (!valid.includes(value as MergeMode)) {
    throw new ValidationError(
      `Invalid merge mode: ${value}. Valid: ${valid.join(", ")}`
    );
  }
  return value as MergeMode;
}

export function parseMergeStrategy(value: string): MergeStrategy {
  const valid: MergeStrategy[] = ["merge", "squash", "rebase"];
  if (!valid.includes(value as MergeStrategy)) {
    throw new ValidationError(
      `Invalid merge strategy: ${value}. Valid: ${valid.join(", ")}`
    );
  }
  return value as MergeStrategy;
}

// =============================================================================
// CLI Program
// =============================================================================

program
  .name("xfg")
  .description(
    "Manage files, settings, and repositories across GitHub, Azure DevOps, and GitLab"
  )
  .version(getVersion());

// Sync command (file synchronization)
const syncCommand = new Command("sync")
  .description("Sync configuration files across repositories")
  .option(
    "-b, --branch <name>",
    "Override the branch name (default: chore/sync-{filename} or chore/sync-config)"
  )
  .option(
    "-m, --merge <mode>",
    "PR merge mode: manual, auto (default, merge when checks pass), force (bypass requirements), direct (push to default branch, no PR)",
    parseMergeMode
  )
  .option(
    "--merge-strategy <strategy>",
    "Merge strategy: merge, squash (default), rebase",
    parseMergeStrategy
  )
  .option("--delete-branch", "Delete source branch after merge")
  .action(async (opts) => {
    try {
      await runSync(opts as SyncOptions);
    } catch (error) {
      console.error("Fatal error:", error);
      return process.exit(1);
    }
  });

addSharedOptions(syncCommand);
program.addCommand(syncCommand);

export { program };
