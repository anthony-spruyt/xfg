import chalk from "chalk";
import { FileStatus, formatStatusBadge } from "./diff-utils.js";

export interface ILogger {
  info(message: string): void;
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

export interface LoggerStats {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export class Logger implements ILogger {
  private stats: LoggerStats = {
    total: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

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
    if (deletedCount && deletedCount > 0)
      parts.push(chalk.red(`${deletedCount} deleted`));
    if (unchangedCount > 0)
      parts.push(chalk.gray(`${unchangedCount} unchanged`));

    if (parts.length > 0) {
      console.log(chalk.gray(`    Summary: ${parts.join(", ")}`));
    }
  }
}

export const logger = new Logger();
