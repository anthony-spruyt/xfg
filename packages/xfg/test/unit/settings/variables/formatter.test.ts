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
  test("escapes newlines in values so each stays on one line", () => {
    const changes: VariableChange[] = [
      { action: "create", name: "A", newValue: "x\ny" },
      { action: "update", name: "B", oldValue: "p\nq", newValue: "^r\\(" },
    ];

    const plain = formatVariablesPlan(changes).lines.map(stripAnsi);

    assert.ok(plain.includes('        value: "x\\ny"'));
    assert.ok(plain.includes('        value: "p\\nq" → "^r\\("'));
  });

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

    assert.ok(plain.some((l) => l.includes("Create:")));
    assert.ok(plain.some((l) => l.includes("Update:")));
    assert.ok(plain.some((l) => l.includes("Delete:")));

    assert.ok(
      plain.some((l) => l.includes("+") && l.includes('variable "NEW_VAR"'))
    );
    assert.ok(plain.some((l) => l.includes('value: "val"')));

    assert.ok(
      plain.some((l) => l.includes("~") && l.includes('variable "UPD_VAR"'))
    );
    assert.ok(plain.some((l) => l.includes('"old"') && l.includes('"new"')));

    assert.ok(
      plain.some((l) => l.includes("-") && l.includes('variable "OLD_VAR"'))
    );

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
