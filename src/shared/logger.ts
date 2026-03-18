import chalk from "chalk";
import { FileStatus, formatStatusBadge } from "./file-status.js";

/** Minimal log interface: debug only. */
export type DebugLog = { debug(msg: string): void };

/** Log interface: debug + warn. */
export type DebugWarnLog = {
  debug(msg: string): void;
  warn(msg: string): void;
};

/** Log interface: debug + info. */
export type DebugInfoLog = {
  debug(msg: string): void;
  info(msg: string): void;
};

/** Log interface: debug + info + warn. */
export type DebugInfoWarnLog = {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
};

export interface ILogger {
  log(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
  fileDiff(fileName: string, status: FileStatus, diffLines: string[]): void;
  diffSummary(
    newCount: number,
    modifiedCount: number,
    unchangedCount: number,
    deletedCount?: number
  ): void;
  setTotal(total: number): void;
  progress(current: number, repoName: string, message: string): void;
  success(current: number, repoName: string, message: string): void;
  skip(current: number, repoName: string, reason: string): void;
  error(current: number, repoName: string, error: string): void;
}

interface LoggerStats {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export class Logger implements ILogger {
  private readonly debugEnabled: boolean;
  private stats: LoggerStats = {
    total: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  constructor(debugEnabled?: boolean) {
    this.debugEnabled = debugEnabled ?? false;
  }

  log(message: string): void {
    console.log(message);
  }

  setTotal(total: number): void {
    this.stats.total = total;
  }

  progress(current: number, repoName: string, message: string): void {
    console.log(
      chalk.blue(`[${current}/${this.stats.total}]`) +
        ` ${repoName}: ${message}`
    );
  }

  info(message: string): void {
    console.log(chalk.gray(`    ${message}`));
  }

  warn(message: string): void {
    console.log(chalk.yellow(`    ⚠ ${message}`));
  }

  debug(message: string): void {
    if (this.debugEnabled) {
      console.log(chalk.dim(`    [debug] ${message}`));
    }
  }

  success(current: number, repoName: string, message: string): void {
    this.stats.succeeded++;
    console.log(
      chalk.green(`[${current}/${this.stats.total}] ✓`) +
        ` ${repoName}: ${message}`
    );
  }

  skip(current: number, repoName: string, reason: string): void {
    this.stats.skipped++;
    console.log(
      chalk.yellow(`[${current}/${this.stats.total}] ⊘`) +
        ` ${repoName}: Skipped - ${reason}`
    );
  }

  error(current: number, repoName: string, error: string): void {
    this.stats.failed++;
    console.log(
      chalk.red(`[${current}/${this.stats.total}] ✗`) + ` ${repoName}: ${error}`
    );
  }

  /**
   * Display a file diff with status badge.
   * Used in dry-run mode to show what would change.
   */
  fileDiff(fileName: string, status: FileStatus, diffLines: string[]): void {
    const badge = formatStatusBadge(status);
    console.log(`    ${badge} ${fileName}`);

    // Only show diff lines for NEW or MODIFIED files
    if (status !== "UNCHANGED" && diffLines.length > 0) {
      for (const line of diffLines) {
        console.log(`      ${line}`);
      }
    }
  }

  /**
   * Display summary statistics for dry-run diff.
   */
  diffSummary(
    newCount: number,
    modifiedCount: number,
    unchangedCount: number,
    deletedCount?: number
  ): void {
    const parts: string[] = [];
    if (newCount > 0) parts.push(chalk.green(`${newCount} new`));
    if (modifiedCount > 0)
      parts.push(chalk.yellow(`${modifiedCount} modified`));
    if ((deletedCount ?? 0) > 0)
      parts.push(chalk.red(`${deletedCount} deleted`));
    if (unchangedCount > 0)
      parts.push(chalk.gray(`${unchangedCount} unchanged`));

    if (parts.length > 0) {
      console.log(chalk.gray(`    Summary: ${parts.join(", ")}`));
    }
  }
}

/** No-op debug logger for use as a fallback when logging is optional. */
export const NO_OP_DEBUG_LOG: DebugLog = { debug() {} };
