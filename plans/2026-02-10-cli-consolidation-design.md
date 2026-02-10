# CLI Consolidation Design

## Problem

After the recent SOLID refactoring, the separation between `src/index.ts` and `src/cli.ts` no longer serves its original purpose (testability). The actual command logic now lives in `src/cli/sync-command.ts` and `src/cli/settings-command.ts`.

Additionally, `src/cli.ts` contains backwards compatibility logic for implicit `sync` command that is only 9 days old and adds unnecessary complexity.

## Decision

1. Drop backwards compatibility for implicit `sync` command
2. Move Commander definition to `src/cli/program.ts`
3. Simplify `src/cli.ts` to minimal entry point
4. Convert `src/index.ts` to pure re-exports

## Target Structure

```
src/
├── cli.ts                    # Entry point (5 lines)
├── index.ts                  # Public API re-exports only
└── cli/
    ├── program.ts            # Commander definition (NEW)
    ├── sync-command.ts       # Sync implementation (exists)
    ├── settings-command.ts   # Settings implementation (exists)
    ├── types.ts              # Shared types (exists)
    └── index.ts              # Barrel exports (exists)
```

## Implementation Tasks

### Task 1: Create `src/cli/program.ts`

Create new file with Commander definition moved from `src/index.ts`:

```typescript
import { program, Command } from "commander";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MergeMode, MergeStrategy } from "../config/index.js";
import { runSync } from "./sync-command.js";
import { runSettings } from "./settings-command.js";
import type { SyncOptions } from "./sync-command.js";
import type { SettingsOptions } from "./settings-command.js";

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../..", "package.json"), "utf-8")
) as { version: string };

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

program
  .name("xfg")
  .description("Sync files and manage settings across repositories")
  .version(packageJson.version);

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

export { program };
```

Note: `package.json` path changes from `".."` to `"../.."` (one level deeper).

### Task 2: Simplify `src/cli.ts`

Replace entire file with minimal entry point:

```typescript
#!/usr/bin/env node

import { program } from "./cli/program.js";

program.parse();
```

### Task 3: Convert `src/index.ts` to pure re-exports

Replace entire file with:

```typescript
// Public API for library consumers
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
```

### Task 4: Update `src/cli/index.ts` barrel exports

Add export for program:

```typescript
export { program } from "./program.js";
```

### Task 5: Update `codecov.yml`

Add to the ignore section:

```yaml
# Entry point (just calls parse)
- "src/cli.ts"

# Re-export only
- "src/index.ts"

# CLI configuration (declarative, tested via integration)
- "src/cli/program.ts"
```

### Task 6: Verify

1. `npm run build` - TypeScript compiles
2. `npm test` - Unit tests pass
3. `./lint.sh` - Linting passes
4. Manual test: `node dist/cli.js sync --help`
5. Manual test: `node dist/cli.js settings --help`
6. Verify `xfg -c config.yaml` now shows error (backwards compat removed)

## Breaking Change

This removes backwards compatibility for `xfg -c config.yaml`. Users must now use explicit subcommands:

- `xfg sync -c config.yaml`
- `xfg settings -c config.yaml`

Consider noting this in release notes if releasing as minor/major version.
