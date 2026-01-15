import chalk from "chalk";

export interface ILogger {
  info(message: string): void;
}

export interface LoggerStats {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export class Logger {
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
        ` ${repoName}: ${message}`,
    );
  }

  info(message: string): void {
    console.log(chalk.gray(`    ${message}`));
  }

  success(current: number, repoName: string, message: string): void {
    this.stats.succeeded++;
    console.log(
      chalk.green(`[${current}/${this.stats.total}] ✓`) +
        ` ${repoName}: ${message}`,
    );
  }

  skip(current: number, repoName: string, reason: string): void {
    this.stats.skipped++;
    console.log(
      chalk.yellow(`[${current}/${this.stats.total}] ⊘`) +
        ` ${repoName}: Skipped - ${reason}`,
    );
  }

  error(current: number, repoName: string, error: string): void {
    this.stats.failed++;
    console.log(
      chalk.red(`[${current}/${this.stats.total}] ✗`) +
        ` ${repoName}: ${error}`,
    );
  }

  summary(): void {
    console.log("");
    console.log(chalk.bold("Summary:"));
    console.log(`  Total:     ${this.stats.total}`);
    console.log(chalk.green(`  Succeeded: ${this.stats.succeeded}`));
    console.log(chalk.yellow(`  Skipped:   ${this.stats.skipped}`));
    console.log(chalk.red(`  Failed:    ${this.stats.failed}`));
  }

  hasFailures(): boolean {
    return this.stats.failed > 0;
  }
}

export const logger = new Logger();
