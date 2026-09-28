import chalk from "chalk";
import type { LifecycleResult } from "./types.js";
import { getRepoDisplayName } from "../repo/index.js";
import { SyncError } from "../shared/errors.js";
import type { RepoVisibility } from "../config/index.js";
import { quoted } from "../shared/string-utils.js";

interface FormatOptions {
  upstream?: string;
  source?: string;
  settings?: {
    visibility?: RepoVisibility;
    description?: string;
  };
}

export function formatLifecycleAction(
  result: LifecycleResult,
  options?: FormatOptions
): string[] {
  if (result.action === "existed") {
    return [];
  }

  const lines: string[] = [];
  const repoDisplay = getRepoDisplayName(result.repoInfo);

  switch (result.action) {
    case "created":
      lines.push(chalk.green(`+ CREATE ${repoDisplay}`));
      break;

    case "forked":
      lines.push(
        chalk.green(
          `+ FORK ${options?.upstream ?? "upstream"} -> ${repoDisplay}`
        )
      );
      break;

    case "migrated":
      lines.push(
        chalk.green(
          `+ MIGRATE ${options?.source ?? "source"} -> ${repoDisplay}`
        )
      );
      break;

    default: {
      const _exhaustive: never = result.action;
      throw new SyncError(`Unknown lifecycle action: ${_exhaustive}`);
    }
  }

  if (options?.settings) {
    if (options.settings.visibility) {
      lines.push(`    visibility: ${options.settings.visibility}`);
    }
    if (options.settings.description) {
      lines.push(`    description: ${quoted(options.settings.description)}`);
    }
  }

  return lines;
}
