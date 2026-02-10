import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatCommitMessage } from "../../../src/sync/commit-message.js";
import type { FileAction } from "../../../src/vcs/pr-creator.js";

describe("formatCommitMessage", () => {
  test("returns single file message for one changed file", () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: sync config.json");
  });

  test("returns comma-separated message for 2-3 files", () => {
    const files: FileAction[] = [
      { fileName: "a.json", action: "create" },
      { fileName: "b.json", action: "update" },
    ];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: sync a.json, b.json");
  });

  test("returns count message for 4+ files", () => {
    const files: FileAction[] = [
      { fileName: "a.json", action: "create" },
      { fileName: "b.json", action: "update" },
      { fileName: "c.json", action: "create" },
      { fileName: "d.json", action: "update" },
    ];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: sync 4 config files");
  });

  test("filters out skipped files", () => {
    const files: FileAction[] = [
      { fileName: "changed.json", action: "create" },
      { fileName: "unchanged.json", action: "skip" },
    ];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: sync changed.json");
  });

  test("returns remove message for single deletion", () => {
    const files: FileAction[] = [{ fileName: "old.json", action: "delete" }];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: remove old.json");
  });

  test("returns orphan count message for multiple deletions only", () => {
    const files: FileAction[] = [
      { fileName: "old1.json", action: "delete" },
      { fileName: "old2.json", action: "delete" },
    ];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: remove 2 orphaned config files");
  });

  test("uses sync message for mixed sync and delete", () => {
    const files: FileAction[] = [
      { fileName: "new.json", action: "create" },
      { fileName: "old.json", action: "delete" },
    ];
    const result = formatCommitMessage(files);
    assert.equal(result, "chore: sync new.json, old.json");
  });
});
