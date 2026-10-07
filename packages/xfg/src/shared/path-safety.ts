import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { ValidationError } from "./errors.js";

// Characters HFS+ ignores in names, so `.g<ZWNJ>it` opens `.git` on macOS.
const IGNORABLE_CHARS =
  /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;

/**
 * Matches every spelling filesystems resolve to `.git`: any case, Windows
 * trailing dots/spaces, NTFS `::$` streams and the `GIT~1` short name.
 */
export function hasGitDirSegment(fileName: string): boolean {
  return fileName.split(/[/\\]/).some((raw) => {
    const segment = raw
      .replace(IGNORABLE_CHARS, "")
      .replace(/:.*$/, "")
      .replace(/[. ]+$/, "")
      .toLowerCase();
    return segment === ".git" || /^git~\d+$/.test(segment);
  });
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
