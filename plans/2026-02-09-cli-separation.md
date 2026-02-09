# CLI Separation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate CLI concerns from business logic in index.ts by extracting sync and settings commands into dedicated files.

**Architecture:** Extract `runSync` and `runSettings` into `cli/sync-command.ts` and `cli/settings-command.ts`, leaving index.ts as a thin CLI entry point with Commander.js setup, shared options, and re-exports.

**Tech Stack:** TypeScript, Commander.js, Node.js test runner

---

## Task 1: Create sync-command.ts with runSync and helpers

**Files:**

- Create: `src/cli/sync-command.ts`
- Modify: `src/index.ts` (remove moved code, add imports)

**Step 1: Write the failing test**

Run existing tests to establish baseline - they should pass before refactoring:

```bash
npm test -- --test-name-pattern "runSync"
```

**Step 2: Run test to verify baseline passes**

Run: `npm test -- --test-name-pattern "runSync"`
Expected: PASS (all runSync tests pass)

**Step 3: Create sync-command.ts**

Create `src/cli/sync-command.ts` with the following content extracted from index.ts:

```typescript
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import {
  loadRawConfig,
  normalizeConfig,
  MergeMode,
  MergeStrategy,
  RepoConfig,
} from "../config.js";
import { validateForSync } from "../config-validator.js";
import { parseGitUrl, getRepoDisplayName } from "../repo-detector.js";
import { sanitizeBranchName, validateBranchName } from "../git-ops.js";
import { logger } from "../logger.js";
import { generateWorkspaceName } from "../workspace-utils.js";
import { ProcessorResult } from "../repository-processor.js";
import { RepoInfo } from "../repo-detector.js";
import { ProcessorOptions } from "../repository-processor.js";
import { RepoResult } from "../github-summary.js";
import { buildRepoResult, buildErrorResult } from "../summary-utils.js";
import { Plan, printPlan } from "../plan-formatter.js";
import { writePlanSummary } from "../plan-summary.js";
import { syncResultToResources } from "../resource-converters.js";
import {
  IRepositoryProcessor,
  ProcessorFactory,
  defaultProcessorFactory,
} from "./types.js";

/**
 * Shared options common to all commands.
 */
export interface SharedOptions {
  config: string;
  dryRun?: boolean;
  workDir?: string;
  retries?: number;
  noDelete?: boolean;
}

/**
 * Options specific to the sync command.
 */
export interface SyncOptions extends SharedOptions {
  branch?: string;
  merge?: MergeMode;
  mergeStrategy?: MergeStrategy;
  deleteBranch?: boolean;
}

/**
 * Get unique file names from all repos in the config
 */
function getUniqueFileNames(config: { repos: RepoConfig[] }): string[] {
  const fileNames = new Set<string>();
  for (const repo of config.repos) {
    for (const file of repo.files) {
      fileNames.add(file.fileName);
    }
  }
  return Array.from(fileNames);
}

/**
 * Generate default branch name based on files being synced
 */
function generateBranchName(fileNames: string[]): string {
  if (fileNames.length === 1) {
    return `chore/sync-${sanitizeBranchName(fileNames[0])}`;
  }
  return "chore/sync-config";
}

/**
 * Format file names for display
 */
function formatFileNames(fileNames: string[]): string {
  if (fileNames.length === 1) {
    return fileNames[0];
  }
  if (fileNames.length <= 3) {
    return fileNames.join(", ");
  }
  return `${fileNames.length} files`;
}

/**
 * Run the sync command - synchronizes files across repositories.
 */
export async function runSync(
  options: SyncOptions,
  processorFactory: ProcessorFactory = defaultProcessorFactory
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
  const fileNames = getUniqueFileNames(config);

  let branchName: string;
  if (options.branch) {
    validateBranchName(options.branch);
    branchName = options.branch;
  } else {
    branchName = generateBranchName(fileNames);
  }

  logger.setTotal(config.repos.length);
  console.log(`Found ${config.repos.length} repositories to process`);
  console.log(`Target files: ${formatFileNames(fileNames)}`);
  console.log(`Branch: ${branchName}\n`);

  const processor = processorFactory();
  const results: RepoResult[] = [];
  const plan: Plan = { resources: [], errors: [] };

  for (let i = 0; i < config.repos.length; i++) {
    const repoConfig = config.repos[i];

    if (options.merge || options.mergeStrategy || options.deleteBranch) {
      repoConfig.prOptions = {
        ...repoConfig.prOptions,
        merge: options.merge ?? repoConfig.prOptions?.merge,
        mergeStrategy:
          options.mergeStrategy ?? repoConfig.prOptions?.mergeStrategy,
        deleteBranch:
          options.deleteBranch ?? repoConfig.prOptions?.deleteBranch,
      };
    }

    const current = i + 1;

    let repoInfo: RepoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch (error) {
      logger.error(current, repoConfig.git, String(error));
      results.push(buildErrorResult(repoConfig.git, error));
      plan.errors!.push({
        repo: repoConfig.git,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);
    const workDir = resolve(
      join(options.workDir ?? "./tmp", generateWorkspaceName(i))
    );

    try {
      logger.progress(current, repoName, "Processing...");

      const result = await processor.process(repoConfig, repoInfo, {
        branchName,
        workDir,
        configId: config.id,
        dryRun: options.dryRun,
        retries: options.retries,
        prTemplate: config.prTemplate,
        noDelete: options.noDelete,
      });

      const repoResult = buildRepoResult(repoName, repoConfig, result);
      results.push(repoResult);

      if (result.skipped) {
        logger.skip(current, repoName, result.message);
      } else if (result.success) {
        logger.success(current, repoName, repoResult.message);
      } else {
        logger.error(current, repoName, result.message);
      }

      plan.resources.push(
        ...syncResultToResources(repoName, repoConfig, result)
      );
    } catch (error) {
      logger.error(current, repoName, String(error));
      results.push(buildErrorResult(repoName, error));
      plan.errors!.push({
        repo: repoName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log("");
  printPlan(plan);

  writePlanSummary(plan, {
    title: "Config Sync Summary",
    dryRun: options.dryRun ?? false,
  });

  if (plan.errors && plan.errors.length > 0) {
    process.exit(1);
  }
}
```

**Step 4: Create cli/types.ts for shared interfaces**

Create `src/cli/types.ts` with processor interfaces and factories:

```typescript
import { RepoConfig } from "../config.js";
import { RepoInfo } from "../repo-detector.js";
import {
  ProcessorResult,
  ProcessorOptions,
  RepositoryProcessor,
} from "../repository-processor.js";
import {
  RulesetProcessor,
  RulesetProcessorOptions,
  RulesetProcessorResult,
} from "../ruleset-processor.js";
import {
  RepoSettingsProcessor,
  IRepoSettingsProcessor,
} from "../repo-settings-processor.js";

/**
 * Processor interface for dependency injection in tests.
 */
export interface IRepositoryProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: ProcessorOptions
  ): Promise<ProcessorResult>;
  updateManifestOnly(
    repoInfo: RepoInfo,
    repoConfig: RepoConfig,
    options: ProcessorOptions,
    manifestUpdate: { rulesets: string[] }
  ): Promise<ProcessorResult>;
}

/**
 * Factory function type for creating processors.
 */
export type ProcessorFactory = () => IRepositoryProcessor;

/**
 * Default factory that creates a real RepositoryProcessor.
 */
export const defaultProcessorFactory: ProcessorFactory = () =>
  new RepositoryProcessor();

/**
 * Ruleset processor interface for dependency injection in tests.
 */
export interface IRulesetProcessor {
  process(
    repoConfig: RepoConfig,
    repoInfo: RepoInfo,
    options: RulesetProcessorOptions
  ): Promise<RulesetProcessorResult>;
}

/**
 * Factory function type for creating ruleset processors.
 */
export type RulesetProcessorFactory = () => IRulesetProcessor;

/**
 * Default factory that creates a real RulesetProcessor.
 */
export const defaultRulesetProcessorFactory: RulesetProcessorFactory = () =>
  new RulesetProcessor();

/**
 * Repo settings processor factory function type.
 */
export type RepoSettingsProcessorFactory = () => IRepoSettingsProcessor;

/**
 * Default factory that creates a real RepoSettingsProcessor.
 */
export const defaultRepoSettingsProcessorFactory: RepoSettingsProcessorFactory =
  () => new RepoSettingsProcessor();

// Re-export IRepoSettingsProcessor for convenience
export type { IRepoSettingsProcessor };
```

**Step 5: Run build to verify sync-command.ts compiles**

Run: `npm run build`
Expected: PASS (no TypeScript errors)

**Step 6: Commit**

```bash
git add src/cli/sync-command.ts src/cli/types.ts
git commit -m "refactor(cli): extract sync command to dedicated file

Move runSync, SyncOptions, and helper functions to cli/sync-command.ts.
Create cli/types.ts for shared processor interfaces and factories.

Part of #439"
```

---

## Task 2: Create settings-command.ts with runSettings

**Files:**

- Create: `src/cli/settings-command.ts`

**Step 1: Write the failing test**

Run existing tests to establish baseline:

```bash
npm test -- --test-name-pattern "runSettings"
```

**Step 2: Run test to verify baseline passes**

Run: `npm test -- --test-name-pattern "runSettings"`
Expected: PASS

**Step 3: Create settings-command.ts**

Create `src/cli/settings-command.ts` with the following content extracted from index.ts:

```typescript
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import { loadRawConfig, normalizeConfig, RepoConfig } from "../config.js";
import { validateForSettings } from "../config-validator.js";
import {
  parseGitUrl,
  getRepoDisplayName,
  isGitHubRepo,
} from "../repo-detector.js";
import { logger } from "../logger.js";
import { generateWorkspaceName } from "../workspace-utils.js";
import { RepoResult } from "../github-summary.js";
import { buildErrorResult } from "../summary-utils.js";
import { getManagedRulesets } from "../manifest.js";
import { Plan, printPlan } from "../plan-formatter.js";
import { writePlanSummary } from "../plan-summary.js";
import {
  rulesetResultToResources,
  repoSettingsResultToResources,
} from "../resource-converters.js";
import { SharedOptions } from "./sync-command.js";
import {
  ProcessorFactory,
  defaultProcessorFactory,
  RulesetProcessorFactory,
  defaultRulesetProcessorFactory,
  RepoSettingsProcessorFactory,
  defaultRepoSettingsProcessorFactory,
} from "./types.js";

/**
 * Options for the settings command.
 */
export type SettingsOptions = SharedOptions;

/**
 * Run the settings command - manages GitHub Rulesets and repo settings.
 */
export async function runSettings(
  options: SettingsOptions,
  processorFactory: RulesetProcessorFactory = defaultRulesetProcessorFactory,
  repoProcessorFactory: ProcessorFactory = defaultProcessorFactory,
  repoSettingsProcessorFactory: RepoSettingsProcessorFactory = defaultRepoSettingsProcessorFactory
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
    validateForSettings(rawConfig);
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

  if (reposWithRulesets.length === 0 && reposWithRepoSettings.length === 0) {
    console.log(
      "No settings configured. Add settings.rulesets or settings.repo to your config."
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
  console.log("");
  logger.setTotal(reposWithRulesets.length + reposWithRepoSettings.length);

  const processor = processorFactory();
  const repoProcessor = repoProcessorFactory();
  const results: RepoResult[] = [];
  const plan: Plan = { resources: [], errors: [] };

  for (let i = 0; i < reposWithRulesets.length; i++) {
    const repoConfig = reposWithRulesets[i];

    let repoInfo;
    try {
      repoInfo = parseGitUrl(repoConfig.git, {
        githubHosts: config.githubHosts,
      });
    } catch (error) {
      logger.error(i + 1, repoConfig.git, String(error));
      results.push(buildErrorResult(repoConfig.git, error));
      plan.errors!.push({
        repo: repoConfig.git,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const repoName = getRepoDisplayName(repoInfo);

    if (!isGitHubRepo(repoInfo)) {
      logger.skip(
        i + 1,
        repoName,
        "GitHub Rulesets only supported for GitHub repos"
      );
      if (repoConfig.settings?.rulesets) {
        for (const rulesetName of Object.keys(repoConfig.settings.rulesets)) {
          plan.resources.push({
            type: "ruleset",
            repo: repoName,
            name: rulesetName,
            action: "skipped",
            skipReason: "GitHub Rulesets only supported for GitHub repos",
          });
        }
      }
      continue;
    }

    const managedRulesets = getManagedRulesets(null, config.id);

    try {
      logger.progress(i + 1, repoName, "Processing rulesets...");

      const result = await processor.process(repoConfig, repoInfo, {
        configId: config.id,
        dryRun: options.dryRun,
        managedRulesets,
        noDelete: options.noDelete,
      });

      if (result.planOutput && result.planOutput.lines.length > 0) {
        logger.info("");
        logger.info(chalk.bold(`${repoName} - Rulesets:`));
        for (const line of result.planOutput.lines) {
          logger.info(line);
        }
      }

      if (result.skipped) {
        logger.skip(i + 1, repoName, result.message);
      } else if (result.success) {
        logger.success(i + 1, repoName, result.message);

        if (
          result.manifestUpdate &&
          result.manifestUpdate.rulesets.length > 0
        ) {
          const workDir = resolve(
            join(options.workDir ?? "./tmp", generateWorkspaceName(i))
          );
          logger.progress(i + 1, repoName, "Updating manifest...");
          const manifestResult = await repoProcessor.updateManifestOnly(
            repoInfo,
            repoConfig,
            {
              branchName: "chore/sync-rulesets",
              workDir,
              configId: config.id,
              dryRun: options.dryRun,
              retries: options.retries,
            },
            result.manifestUpdate
          );
          if (!manifestResult.success && !manifestResult.skipped) {
            logger.info(
              `Warning: Failed to update manifest for ${repoName}: ${manifestResult.message}`
            );
          }
        }
      } else {
        logger.error(i + 1, repoName, result.message);
      }

      results.push({
        repoName,
        status: result.skipped
          ? "skipped"
          : result.success
            ? "succeeded"
            : "failed",
        message: result.message,
        rulesetPlanDetails: result.planOutput?.entries,
      });

      plan.resources.push(...rulesetResultToResources(repoName, result));
    } catch (error) {
      logger.error(i + 1, repoName, String(error));
      results.push(buildErrorResult(repoName, error));
      plan.errors!.push({
        repo: repoName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (reposWithRepoSettings.length > 0) {
    const repoSettingsProcessor = repoSettingsProcessorFactory();

    console.log(
      `\nProcessing repo settings for ${reposWithRepoSettings.length} repositories\n`
    );

    for (let i = 0; i < reposWithRepoSettings.length; i++) {
      const repoConfig = reposWithRepoSettings[i];
      let repoInfo;
      try {
        repoInfo = parseGitUrl(repoConfig.git, {
          githubHosts: config.githubHosts,
        });
      } catch (error) {
        console.error(`Failed to parse ${repoConfig.git}: ${error}`);
        plan.errors!.push({
          repo: repoConfig.git,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const repoName = getRepoDisplayName(repoInfo);

      try {
        const result = await repoSettingsProcessor.process(
          repoConfig,
          repoInfo,
          {
            dryRun: options.dryRun,
          }
        );

        if (result.planOutput && result.planOutput.lines.length > 0) {
          console.log(`\n  ${chalk.bold(repoName)}:`);
          console.log("  Repo Settings:");
          for (const line of result.planOutput.lines) {
            console.log(line);
          }
          if (result.warnings && result.warnings.length > 0) {
            for (const warning of result.warnings) {
              console.log(chalk.yellow(`  ⚠️  Warning: ${warning}`));
            }
          }
        }

        if (result.skipped) {
          // Silent skip
        } else if (result.success) {
          console.log(chalk.green(`  ✓ ${repoName}: ${result.message}`));
        } else {
          console.log(chalk.red(`  ✗ ${repoName}: ${result.message}`));
        }

        if (!result.skipped) {
          const existing = results.find((r) => r.repoName === repoName);
          if (existing) {
            existing.repoSettingsPlanDetails = result.planOutput?.entries;
          } else {
            results.push({
              repoName,
              status: result.success ? "succeeded" : "failed",
              message: result.message,
              repoSettingsPlanDetails: result.planOutput?.entries,
            });
          }
        }

        plan.resources.push(...repoSettingsResultToResources(repoName, result));
      } catch (error) {
        console.error(`  ✗ ${repoName}: ${error}`);
        plan.errors!.push({
          repo: repoName,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.log("");
  printPlan(plan);

  writePlanSummary(plan, {
    title: "Repository Settings Summary",
    dryRun: options.dryRun ?? false,
  });

  if (plan.errors && plan.errors.length > 0) {
    process.exit(1);
  }
}
```

**Step 4: Run build to verify settings-command.ts compiles**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/settings-command.ts
git commit -m "refactor(cli): extract settings command to dedicated file

Move runSettings and SettingsOptions to cli/settings-command.ts.

Part of #439"
```

---

## Task 3: Create cli/index.ts barrel export

**Files:**

- Create: `src/cli/index.ts`
- Remove: `src/cli/.gitkeep`

**Step 1: Create cli/index.ts**

Create `src/cli/index.ts` as barrel export:

```typescript
// CLI command implementations
export { runSync, SyncOptions, SharedOptions } from "./sync-command.js";
export { runSettings, SettingsOptions } from "./settings-command.js";

// Processor interfaces and factories for dependency injection
export {
  IRepositoryProcessor,
  ProcessorFactory,
  defaultProcessorFactory,
  IRulesetProcessor,
  RulesetProcessorFactory,
  defaultRulesetProcessorFactory,
  RepoSettingsProcessorFactory,
  defaultRepoSettingsProcessorFactory,
  IRepoSettingsProcessor,
} from "./types.js";
```

**Step 2: Remove .gitkeep**

```bash
rm src/cli/.gitkeep
```

**Step 3: Run build to verify**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cli/index.ts
git rm src/cli/.gitkeep
git commit -m "refactor(cli): add barrel export for cli module

Create cli/index.ts to re-export all CLI components.
Remove .gitkeep placeholder.

Part of #439"
```

---

## Task 4: Refactor index.ts as thin CLI entry point

**Files:**

- Modify: `src/index.ts`

**Step 1: Refactor index.ts**

Replace the entire content of `src/index.ts` with the thin CLI setup:

```typescript
#!/usr/bin/env node

import { program, Command } from "commander";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MergeMode, MergeStrategy } from "./config.js";
import { runSync, SyncOptions } from "./cli/sync-command.js";
import { runSettings, SettingsOptions } from "./cli/settings-command.js";

// Re-export for backwards compatibility with tests and external consumers
export {
  runSync,
  runSettings,
  SyncOptions,
  SettingsOptions,
  SharedOptions,
} from "./cli/index.js";

export {
  IRepositoryProcessor,
  ProcessorFactory,
  defaultProcessorFactory,
  IRulesetProcessor,
  RulesetProcessorFactory,
  defaultRulesetProcessorFactory,
  RepoSettingsProcessorFactory,
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
```

**Step 2: Run build to verify compilation**

Run: `npm run build`
Expected: PASS

**Step 3: Run all tests**

Run: `npm test`
Expected: PASS (all 1654+ tests pass)

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "refactor(cli): slim down index.ts to CLI entry point

- Remove runSync, runSettings implementations (now in cli/)
- Remove processor interfaces (now in cli/types.ts)
- Keep Commander.js setup and shared options
- Re-export all CLI components for backwards compatibility

index.ts: 694 lines → ~110 lines

Closes #439"
```

---

## Task 5: Verify line counts and run lint

**Files:**

- None (verification only)

**Step 1: Verify index.ts line count**

Run: `wc -l src/index.ts`
Expected: < 200 lines

**Step 2: Verify sync-command.ts line count**

Run: `wc -l src/cli/sync-command.ts`
Expected: < 300 lines

**Step 3: Verify settings-command.ts line count**

Run: `wc -l src/cli/settings-command.ts`
Expected: < 300 lines

**Step 4: Run lint**

Run: `./lint.sh`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: PASS (all tests pass)

**Step 6: Final commit if any fixes needed**

If lint or tests revealed issues, fix and commit:

```bash
git add -A
git commit -m "fix(cli): address lint/test issues from refactoring"
```

---

## Acceptance Criteria Checklist

- [ ] All tests pass (`npm test`)
- [ ] `index.ts` < 200 lines
- [ ] `cli/sync-command.ts` < 300 lines
- [ ] `cli/settings-command.ts` < 300 lines
- [ ] CLI concerns separated from business logic
- [ ] Lint passes (`./lint.sh`)
- [ ] Backwards compatibility maintained (all exports preserved)
