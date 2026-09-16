import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatVariablesPlan } from "../../../../src/settings/variables/formatter.js";
import type { VariableChange } from "../../../../src/settings/variables/diff.js";

const escCodePattern = new RegExp(
  `${String.fromCharCode(0x1b)}\\[[0-9;]*m`,
  "g"
);
function stripAnsi(str: string): string {
  return str.replace(escCodePattern, "");
}

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

    const plain = result.lines.map((l) => stripAnsi(l));

    // Section headers
    assert.ok(plain.some((l) => l.includes("Create:")));
    assert.ok(plain.some((l) => l.includes("Update:")));
    assert.ok(plain.some((l) => l.includes("Delete:")));

    // Create entry content
    assert.ok(
      plain.some((l) => l.includes("+") && l.includes('variable "NEW_VAR"'))
    );
    assert.ok(plain.some((l) => l.includes('value: "val"')));

    // Update entry content
    assert.ok(
      plain.some((l) => l.includes("~") && l.includes('variable "UPD_VAR"'))
    );
    assert.ok(plain.some((l) => l.includes('"old"') && l.includes('"new"')));

    // Delete entry content
    assert.ok(
      plain.some((l) => l.includes("-") && l.includes('variable "OLD_VAR"'))
    );

    // Summary line
    assert.ok(
      plain.some(
        (l) =>
          l.includes("Plan:") &&
          l.includes("3 variables") &&
          l.includes("1 to create") &&
          l.includes("1 to update") &&
          l.includes("1 to delete")
      )
    );
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
