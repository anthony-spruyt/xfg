import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { diffVariables } from "../../../../src/settings/variables/diff.js";
import type { GitHubVariable } from "../../../../src/settings/variables/types.js";

function makeVariable(name: string, value: string): GitHubVariable {
  return {
    name,
    value,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };
}

describe("diffVariables", () => {
  test("detects new variables to create", () => {
    const current: GitHubVariable[] = [];
    const desired: Record<string, string> = { NEW_VAR: "value" };
    const changes = diffVariables(current, desired, false);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "create");
    assert.equal(changes[0].name, "NEW_VAR");
  });

  test("detects unchanged variables", () => {
    const current = [makeVariable("MY_VAR", "same-value")];
    const desired: Record<string, string> = { MY_VAR: "same-value" };
    const changes = diffVariables(current, desired, false);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "unchanged");
  });

  test("detects value changes for update", () => {
    const current = [makeVariable("MY_VAR", "old-value")];
    const desired: Record<string, string> = { MY_VAR: "new-value" };
    const changes = diffVariables(current, desired, false);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "update");
    assert.equal(changes[0].oldValue, "old-value");
    assert.equal(changes[0].newValue, "new-value");
  });

  test("detects orphans for deletion when deleteOrphaned is true", () => {
    const current = [makeVariable("ORPHAN", "value")];
    const desired: Record<string, string> = {};
    const changes = diffVariables(current, desired, true);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "delete");
    assert.equal(changes[0].name, "ORPHAN");
  });

  test("does not delete orphans when deleteOrphaned is false", () => {
    const current = [makeVariable("ORPHAN", "value")];
    const desired: Record<string, string> = {};
    const changes = diffVariables(current, desired, false);
    assert.equal(changes.length, 0);
  });

  test("matches variable names case-insensitively", () => {
    const current = [makeVariable("my_var", "value")];
    const desired: Record<string, string> = { MY_VAR: "value" };
    const changes = diffVariables(current, desired, false);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "unchanged");
  });

  test("preserves remote name casing for update and unchanged actions", () => {
    const current = [
      makeVariable("MY_VAR", "old-value"),
      makeVariable("Keep_Me", "same"),
    ];
    const desired: Record<string, string> = {
      my_var: "new-value",
      keep_me: "same",
    };
    const changes = diffVariables(current, desired, false);
    const update = changes.find((c) => c.action === "update")!;
    const unchanged = changes.find((c) => c.action === "unchanged")!;
    assert.equal(update.name, "MY_VAR");
    assert.equal(unchanged.name, "Keep_Me");
  });

  test("sorts changes: delete, update, create, unchanged", () => {
    const current = [
      makeVariable("DELETE_ME", "val"),
      makeVariable("UPDATE_ME", "old"),
      makeVariable("KEEP_ME", "same"),
    ];
    const desired: Record<string, string> = {
      UPDATE_ME: "new",
      KEEP_ME: "same",
      CREATE_ME: "val",
    };
    const changes = diffVariables(current, desired, true);
    assert.equal(changes[0].action, "delete");
    assert.equal(changes[1].action, "update");
    assert.equal(changes[2].action, "create");
    assert.equal(changes[3].action, "unchanged");
  });
});
