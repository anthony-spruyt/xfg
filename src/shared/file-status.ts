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
  }
}
