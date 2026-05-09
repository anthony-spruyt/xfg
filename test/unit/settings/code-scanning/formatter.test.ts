import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { formatCodeScanningPlan } from "../../../../src/settings/code-scanning/formatter.js";
import type { CodeScanningChange } from "../../../../src/settings/code-scanning/diff.js";

describe("formatCodeScanningPlan", () => {
  test("formats create actions", () => {
    const changes: CodeScanningChange[] = [
      { property: "state", action: "create", newValue: "configured" },
      { property: "querySuite", action: "create", newValue: "extended" },
    ];

    const result = formatCodeScanningPlan(changes);

    assert.equal(result.creates, 2);
    assert.equal(result.updates, 0);
    assert.equal(result.lines.length, 2);
    assert.equal(result.entries.length, 2);

    assert.deepStrictEqual(result.entries[0], {
      property: "state",
      action: "create",
      newValue: "configured",
    });
    assert.deepStrictEqual(result.entries[1], {
      property: "querySuite",
      action: "create",
      newValue: "extended",
    });
  });

  test("formats update actions with old and new values", () => {
    const changes: CodeScanningChange[] = [
      {
        property: "state",
        action: "update",
        oldValue: "not-configured",
        newValue: "configured",
      },
      {
        property: "querySuite",
        action: "update",
        oldValue: "default",
        newValue: "extended",
      },
    ];

    const result = formatCodeScanningPlan(changes);

    assert.equal(result.creates, 0);
    assert.equal(result.updates, 2);
    assert.equal(result.lines.length, 2);
    assert.equal(result.entries.length, 2);

    assert.deepStrictEqual(result.entries[0], {
      property: "state",
      action: "update",
      oldValue: "not-configured",
      newValue: "configured",
    });
    assert.deepStrictEqual(result.entries[1], {
      property: "querySuite",
      action: "update",
      oldValue: "default",
      newValue: "extended",
    });
  });

  test("formats mixed create and update actions", () => {
    const changes: CodeScanningChange[] = [
      { property: "state", action: "create", newValue: "configured" },
      {
        property: "querySuite",
        action: "update",
        oldValue: "default",
        newValue: "extended",
      },
    ];

    const result = formatCodeScanningPlan(changes);

    assert.equal(result.creates, 1);
    assert.equal(result.updates, 1);
    assert.equal(result.lines.length, 2);
    assert.equal(result.entries.length, 2);

    assert.equal(result.entries[0].action, "create");
    assert.equal(result.entries[1].action, "update");
  });

  test("produces empty lines and entries for unchanged-only actions", () => {
    const changes: CodeScanningChange[] = [
      {
        property: "state",
        action: "unchanged",
        oldValue: "configured",
        newValue: "configured",
      },
      {
        property: "querySuite",
        action: "unchanged",
        oldValue: "default",
        newValue: "default",
      },
    ];

    const result = formatCodeScanningPlan(changes);

    assert.equal(result.creates, 0);
    assert.equal(result.updates, 0);
    assert.equal(result.lines.length, 0);
    assert.equal(result.entries.length, 0);
  });

  test("formats languages array values using array branch", () => {
    const changes: CodeScanningChange[] = [
      {
        property: "languages",
        action: "update",
        oldValue: ["javascript"],
        newValue: ["javascript", "python", "go"],
      },
    ];

    const result = formatCodeScanningPlan(changes);

    assert.equal(result.updates, 1);
    assert.equal(result.lines.length, 1);
    assert.equal(result.entries.length, 1);

    // The line should contain the array formatted as [javascript, python, go]
    // (chalk wraps it, so check the raw entry instead for values)
    assert.deepStrictEqual(result.entries[0], {
      property: "languages",
      action: "update",
      oldValue: ["javascript"],
      newValue: ["javascript", "python", "go"],
    });

    // Verify the line contains the array-formatted strings
    const line = result.lines[0];
    assert.ok(
      line.includes("javascript, python, go"),
      "new value should contain formatted array"
    );
    assert.ok(
      line.includes("javascript"),
      "old value should contain formatted array"
    );
  });
});
