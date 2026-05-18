import chalk from "chalk";

export type FileStatus = "NEW" | "MODIFIED" | "UNCHANGED" | "DELETED";

export function formatStatusBadge(status: FileStatus): string {
  switch (status) {
    case "NEW":
      return chalk.green("[NEW]");
    case "MODIFIED":
      return chalk.yellow("[MODIFIED]");
    case "UNCHANGED":
      return chalk.gray("[UNCHANGED]");
    case "DELETED":
      return chalk.red("[DELETED]");

    default: {
      const _exhaustive: never = status;
      throw new Error(`Unexpected file status: ${String(_exhaustive)}`);
    }
  }
}
