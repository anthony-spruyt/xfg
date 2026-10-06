import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { FileWriteResult, IRenderWriter } from "./types.js";

export const RENDER_INDEX_FILE = "render.json";

interface RenderIndex {
  repos: Record<string, { files: string[]; deleted: string[] }>;
}

function resolveInside(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to render ${path}: outside ${root}`);
  }
  return target;
}

/**
 * Writes the content of created and updated files to <renderDir>/<repoName>/
 * and records written and deleted paths in <renderDir>/render.json.
 */
export class RenderWriter implements IRenderWriter {
  write(
    renderDir: string,
    repoName: string,
    fileChanges: Map<string, FileWriteResult>
  ): void {
    const root = resolve(renderDir);
    const repoDir = resolveInside(root, repoName);
    const files: string[] = [];
    const deleted: string[] = [];

    for (const change of fileChanges.values()) {
      if (change.action === "delete") {
        deleted.push(change.fileName);
        continue;
      }
      if (change.content === null || change.action === "skip") continue;

      const target = resolveInside(repoDir, change.fileName);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, change.content);
      if (change.mode === "100755") chmodSync(target, 0o755);
      files.push(change.fileName);
    }

    const indexPath = resolve(root, RENDER_INDEX_FILE);
    const index: RenderIndex = existsSync(indexPath)
      ? (JSON.parse(readFileSync(indexPath, "utf-8")) as RenderIndex)
      : { repos: {} };
    index.repos[repoName] = { files: files.sort(), deleted: deleted.sort() };
    mkdirSync(root, { recursive: true });
    writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  }
}
