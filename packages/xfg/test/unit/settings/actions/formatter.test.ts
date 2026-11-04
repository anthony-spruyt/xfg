import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { formatActionsPlan } from "../../../../src/settings/actions/formatter.js";
import type { ActionsChange } from "../../../../src/settings/actions/diff.js";

describe("formatActionsPlan", () => {
  test("formats creates, updates and skips unchanged", () => {
    const changes: ActionsChange[] = [
      { property: "githubOwnedAllowed", action: "create", newValue: true },
      {
        property: "defaultWorkflowPermissions",
        action: "update",
        oldValue: "write",
        newValue: "read",
      },
      {
        property: "shaPinningRequired",
        action: "unchanged",
        oldValue: true,
        newValue: true,
      },
    ];

    const result = formatActionsPlan(changes);

    assert.equal(result.creates, 1);
    assert.equal(result.updates, 1);
    assert.equal(result.lines.length, 2);
    assert.deepStrictEqual(
      result.entries.map((e) => e.property),
      ["githubOwnedAllowed", "defaultWorkflowPermissions"]
    );
    assert.ok(result.lines[1].includes("write"));
    assert.ok(result.lines[1].includes("read"));
  });

  test("renders lists as [a, b]", () => {
    const result = formatActionsPlan([
      {
        property: "patternsAllowed",
        action: "update",
        oldValue: ["a/x@*"],
        newValue: ["a/x@*", "b/y@*"],
      },
    ]);
    assert.ok(result.lines[0].includes("[a/x@*] "));
    assert.ok(result.lines[0].includes("[a/x@*, b/y@*]"));
  });
});
