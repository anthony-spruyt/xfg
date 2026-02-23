import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatLabelsPlan } from "../../src/settings/labels/formatter.js";
import type { LabelChange } from "../../src/settings/labels/diff.js";

// Strip ANSI escape codes for assertion
function stripAnsi(str: string): string {
  return str.replace(
    new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g"),
    ""
  );
}

describe("formatLabelsPlan", () => {
  test("formats create action", () => {
    const changes: LabelChange[] = [
      {
        action: "create",
        name: "deploy",
        desired: { color: "0e8a16", description: "Deployment related" },
      },
    ];

    const result = formatLabelsPlan(changes);

    assert.equal(result.creates, 1);
    assert.equal(result.updates, 0);
    assert.equal(result.deletes, 0);
    assert.ok(
      result.lines.some((l) => stripAnsi(l).includes('label "deploy"'))
    );
    assert.ok(result.lines.some((l) => stripAnsi(l).includes("0e8a16")));
  });

  test("formats update action with property changes", () => {
    const changes: LabelChange[] = [
      {
        action: "update",
        name: "bug",
        desired: { color: "ff0000" },
        propertyChanges: [
          { property: "color", oldValue: "d73a4a", newValue: "ff0000" },
        ],
      },
    ];

    const result = formatLabelsPlan(changes);

    assert.equal(result.updates, 1);
    assert.ok(result.lines.some((l) => stripAnsi(l).includes('label "bug"')));
  });

  test("formats rename", () => {
    const changes: LabelChange[] = [
      {
        action: "update",
        name: "old-name",
        newName: "new-name",
        desired: { color: "d73a4a", new_name: "new-name" },
        propertyChanges: [
          { property: "new_name", oldValue: "old-name", newValue: "new-name" },
        ],
      },
    ];

    const result = formatLabelsPlan(changes);

    assert.equal(result.updates, 1);
    const renamed = result.entries.find((e) => e.newName === "new-name");
    assert.ok(renamed);
  });

  test("formats delete action", () => {
    const changes: LabelChange[] = [{ action: "delete", name: "stale" }];

    const result = formatLabelsPlan(changes);

    assert.equal(result.deletes, 1);
    assert.ok(result.lines.some((l) => stripAnsi(l).includes('label "stale"')));
  });

  test("counts unchanged", () => {
    const changes: LabelChange[] = [
      {
        action: "unchanged",
        name: "bug",
        desired: { color: "d73a4a" },
      },
    ];

    const result = formatLabelsPlan(changes);

    assert.equal(result.unchanged, 1);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].action, "unchanged");
  });

  test("summary line includes counts", () => {
    const changes: LabelChange[] = [
      { action: "create", name: "a", desired: { color: "000000" } },
      {
        action: "update",
        name: "b",
        desired: { color: "111111" },
        propertyChanges: [
          { property: "color", oldValue: "222222", newValue: "111111" },
        ],
      },
      { action: "delete", name: "c" },
    ];

    const result = formatLabelsPlan(changes);

    assert.equal(result.creates, 1);
    assert.equal(result.updates, 1);
    assert.equal(result.deletes, 1);
    const summary = result.lines.find((l) =>
      stripAnsi(l).includes("to create")
    );
    assert.ok(summary);
  });
});
