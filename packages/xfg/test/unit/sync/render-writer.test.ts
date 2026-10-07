import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RenderWriter } from "../../../src/sync/render-writer.js";
import type { FileWriteResult } from "../../../src/sync/types.js";

function changes(...entries: FileWriteResult[]): Map<string, FileWriteResult> {
  return new Map(entries.map((e) => [e.fileName, e]));
}

function readIndex(renderDir: string): {
  repos: Record<string, { files: string[]; deleted: string[] }>;
} {
  return JSON.parse(readFileSync(join(renderDir, "render.json"), "utf-8"));
}

describe("RenderWriter", () => {
  let renderDir: string;

  beforeEach(() => {
    renderDir = join(mkdtempSync(join(tmpdir(), "render-writer-")), "out");
  });

  afterEach(() => {
    rmSync(join(renderDir, ".."), { recursive: true, force: true });
  });

  test("writes created and updated files under the repo directory", () => {
    new RenderWriter().write(
      renderDir,
      "org/repo",
      changes(
        { fileName: "a.json", content: '{"a":1}\n', action: "create" },
        { fileName: "nested/b.yaml", content: "b: 2\n", action: "update" }
      )
    );

    assert.equal(
      readFileSync(join(renderDir, "org/repo/a.json"), "utf-8"),
      '{"a":1}\n'
    );
    assert.equal(
      readFileSync(join(renderDir, "org/repo/nested/b.yaml"), "utf-8"),
      "b: 2\n"
    );
  });

  test("skips unchanged, skipped and mode-only entries", () => {
    new RenderWriter().write(
      renderDir,
      "org/repo",
      changes(
        { fileName: "kept.txt", content: null, action: "skip" },
        {
          fileName: "mode.sh",
          content: null,
          action: "update",
          mode: "100755",
          modeOnly: true,
        }
      )
    );

    assert.equal(existsSync(join(renderDir, "org/repo/kept.txt")), false);
    assert.equal(existsSync(join(renderDir, "org/repo/mode.sh")), false);
    assert.deepEqual(readIndex(renderDir).repos["org/repo"], {
      files: [],
      deleted: [],
    });
  });

  test("marks executable files executable", () => {
    new RenderWriter().write(
      renderDir,
      "org/repo",
      changes({
        fileName: "run.sh",
        content: "#!/bin/sh\n",
        action: "create",
        mode: "100755",
      })
    );

    const mode = statSync(join(renderDir, "org/repo/run.sh")).mode & 0o777;
    assert.equal(mode, 0o700);
  });

  test("writes files and the index readable by the owner only", () => {
    new RenderWriter().write(
      renderDir,
      "org/repo",
      changes({ fileName: "a.json", content: "{}", action: "create" })
    );

    for (const path of ["org/repo/a.json", "render.json"]) {
      const mode = statSync(join(renderDir, path)).mode & 0o777;
      assert.equal(mode, 0o600, path);
    }
  });

  test("indexes written and deleted files per repo in render.json", () => {
    const writer = new RenderWriter();
    writer.write(
      renderDir,
      "org/one",
      changes(
        { fileName: "z.txt", content: "z", action: "create" },
        { fileName: "a.txt", content: "a", action: "update" },
        { fileName: "old.txt", content: null, action: "delete" }
      )
    );
    writer.write(
      renderDir,
      "org/two",
      changes({ fileName: "b.txt", content: "b", action: "create" })
    );

    assert.deepEqual(readIndex(renderDir), {
      repos: {
        "org/one": { files: ["a.txt", "z.txt"], deleted: ["old.txt"] },
        "org/two": { files: ["b.txt"], deleted: [] },
      },
    });
  });

  test("orders render.json entries by UTF-16 code unit, not locale", () => {
    new RenderWriter().write(
      renderDir,
      "org/repo",
      changes(
        { fileName: "b.txt", content: "b", action: "create" },
        { fileName: "a.txt", content: "a", action: "create" },
        { fileName: "_x.txt", content: "x", action: "create" },
        { fileName: "～.txt", content: "~", action: "create" },
        { fileName: "Z.txt", content: "z", action: "create" },
        { fileName: "\u{1F600}.txt", content: "s", action: "create" },
        { fileName: "é.txt", content: "e", action: "create" },
        { fileName: "e.txt", content: null, action: "delete" },
        { fileName: "E.txt", content: null, action: "delete" },
        { fileName: "-.txt", content: null, action: "delete" }
      )
    );

    assert.deepEqual(readIndex(renderDir).repos["org/repo"], {
      files: [
        "Z.txt",
        "_x.txt",
        "a.txt",
        "b.txt",
        "é.txt",
        "\u{1F600}.txt",
        "～.txt",
      ],
      deleted: ["-.txt", "E.txt", "e.txt"],
    });
  });

  test("refuses a file path that escapes the repo directory", () => {
    assert.throws(
      () =>
        new RenderWriter().write(
          renderDir,
          "org/repo",
          changes({
            fileName: "../../evil.txt",
            content: "x",
            action: "create",
          })
        ),
      /outside/
    );
    assert.equal(existsSync(join(renderDir, "evil.txt")), false);
  });
});
