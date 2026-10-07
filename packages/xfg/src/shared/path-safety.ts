import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { ValidationError } from "./errors.js";

/** Case-insensitive: case-insensitive filesystems treat `.GIT` as `.git`. */
export function hasGitDirSegment(fileName: string): boolean {
  return fileName
    .split(/[/\\]/)
    .some((segment) => segment.toLowerCase() === ".git");
}

/** True if `path` itself is a symlink, dangling or not. */
export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/**
 * Writes `content` to `path`, refusing if `path` is a symlink. A cloned repo
 * can commit a symlink where xfg writes its own files.
 */
export function writeFileNoFollow(path: string, content: string): void {
  if (isSymlink(path)) {
    throw new ValidationError(`Refusing to write '${path}': it is a symlink`);
  }
  // O_NOFOLLOW closes the lstat/open race; it is undefined on Windows.
  const flag =
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_TRUNC |
    (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(path, flag, 0o666);
  try {
    writeFileSync(fd, content, "utf-8");
  } finally {
    closeSync(fd);
  }
}
