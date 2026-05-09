import chalk from "chalk";

export function formatDiffLine(line: string): string {
  if (line.startsWith("+")) return chalk.green(line);
  if (line.startsWith("-")) return chalk.red(line);
  if (line.startsWith("@@")) return chalk.cyan(line);
  return line;
}
