import chalk from "chalk";
import type { LifecycleResult } from "./types.js";
import { getRepoDisplayName } from "../shared/repo-detector.js";

export interface FormatOptions {
  upstream?: string;
  source?: string;
  settings?: {
    visibility?: string;
    description?: string;
  };
}

/**
 * Format lifecycle action for output (used in both dry-run and real execution).
 * Returns empty array if action is "existed" (no output needed).
 */
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
  }

  // Add settings details if provided
  if (options?.settings) {
    if (options.settings.visibility) {
      lines.push(`    visibility: ${options.settings.visibility}`);
    }
    if (options.settings.description) {
      lines.push(`    description: "${options.settings.description}"`);
    }
  }

  return lines;
}
