import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatVariablesPlan } from "../../../../src/settings/variables/formatter.js";
import type { VariableChange } from "../../../../src/settings/variables/diff.js";

describe("formatVariablesPlan", () => {
  test("formats creates, updates, deletes, and unchanged", () => {
    const changes: VariableChange[] = [
      { action: "delete", name: "OLD_VAR" },
      { action: "update", name: "UPD_VAR", oldValue: "old", newValue: "new" },
      { action: "create", name: "NEW_VAR", newValue: "val" },
      { action: "unchanged", name: "KEEP_VAR" },
    ];
    const result = formatVariablesPlan(changes);
    assert.equal(result.creates, 1);
    assert.equal(result.updates, 1);
    assert.equal(result.deletes, 1);
    assert.equal(result.unchanged, 1);
    assert.equal(result.entries.length, 4);
    assert.equal(result.lines.length, 12);
  });

  test("returns empty output for no changes", () => {
    const result = formatVariablesPlan([]);
    assert.equal(result.creates, 0);
    assert.equal(result.updates, 0);
    assert.equal(result.deletes, 0);
    assert.equal(result.unchanged, 0);
    assert.equal(result.entries.length, 0);
    assert.equal(result.lines.length, 0);
  });
});
