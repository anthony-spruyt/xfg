import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  diffActions,
  hasActionsChanges,
} from "../../../../src/settings/actions/diff.js";

describe("diffActions", () => {
  test("compares only configured fields", () => {
    const changes = diffActions(
      { defaultWorkflowPermissions: "write", cacheSizeGb: 10 },
      { defaultWorkflowPermissions: "read" }
    );
    assert.deepStrictEqual(changes, [
      {
        property: "defaultWorkflowPermissions",
        action: "update",
        oldValue: "write",
        newValue: "read",
      },
    ]);
  });

  test("reports unchanged fields", () => {
    const changes = diffActions(
      { shaPinningRequired: true },
      { shaPinningRequired: true }
    );
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "unchanged");
    assert.equal(hasActionsChanges(changes), false);
  });

  test("a field with no current value is a create", () => {
    const changes = diffActions({}, { githubOwnedAllowed: true });
    assert.deepStrictEqual(changes, [
      {
        property: "githubOwnedAllowed",
        action: "create",
        oldValue: undefined,
        newValue: true,
      },
    ]);
  });

  test("keeps field order stable", () => {
    const changes = diffActions(
      {},
      { cacheSizeGb: 1, enabled: true, patternsAllowed: ["a@*"] }
    );
    assert.deepStrictEqual(
      changes.map((c) => c.property),
      ["enabled", "patternsAllowed", "cacheSizeGb"]
    );
  });

  test("patternsAllowed order is not a change", () => {
    const changes = diffActions(
      { patternsAllowed: ["b/y@*", "a/x@*"] },
      { patternsAllowed: ["a/x@*", "b/y@*"] }
    );
    assert.equal(changes[0].action, "unchanged");
  });

  test("duplicate patternsAllowed entries are not a change", () => {
    const changes = diffActions(
      { patternsAllowed: ["a/x@*"] },
      { patternsAllowed: ["a/x@*", "a/x@*"] }
    );
    assert.equal(changes[0].action, "unchanged");
  });

  test("a different patternsAllowed set is an update", () => {
    const changes = diffActions(
      { patternsAllowed: ["a/x@*"] },
      { patternsAllowed: ["a/x@*", "b/y@*"] }
    );
    assert.equal(changes[0].action, "update");
    assert.deepStrictEqual(changes[0].oldValue, ["a/x@*"]);
    assert.deepStrictEqual(changes[0].newValue, ["a/x@*", "b/y@*"]);
  });

  test("an empty current patternsAllowed is an update, not a create", () => {
    const changes = diffActions(
      { patternsAllowed: [] },
      { patternsAllowed: ["a/x@*"] }
    );
    assert.equal(changes[0].action, "update");
  });

  test("does not reorder the configured patterns", () => {
    const patterns = ["b/y@*", "a/x@*"];
    diffActions({}, { patternsAllowed: patterns });
    assert.deepStrictEqual(patterns, ["b/y@*", "a/x@*"]);
  });
});
