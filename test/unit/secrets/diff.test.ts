import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { diffSecrets } from "../../../src/settings/secrets/diff.js";
import type { GitHubSecret } from "../../../src/settings/secrets/types.js";

function makeSecret(name: string): GitHubSecret {
  return {
    name,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };
}

describe("diffSecrets", () => {
  test("detects new secrets to create", () => {
    const current: GitHubSecret[] = [];
    const desired = ["NEW_SECRET"];
    const changes = diffSecrets(current, desired, false);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "create");
    assert.equal(changes[0].name, "NEW_SECRET");
  });

  test("detects existing secrets as updates (values are encrypted)", () => {
    const current = [makeSecret("DEPLOY_TOKEN")];
    const desired = ["DEPLOY_TOKEN"];
    const changes = diffSecrets(current, desired, false);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "update");
    assert.equal(changes[0].name, "DEPLOY_TOKEN");
  });

  test("detects orphans for deletion when deleteOrphaned is true", () => {
    const current = [makeSecret("OLD_SECRET")];
    const desired: string[] = [];
    const changes = diffSecrets(current, desired, true);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "delete");
    assert.equal(changes[0].name, "OLD_SECRET");
  });

  test("does not delete orphans when deleteOrphaned is false", () => {
    const current = [makeSecret("OLD_SECRET")];
    const desired: string[] = [];
    const changes = diffSecrets(current, desired, false);
    assert.equal(changes.length, 0);
  });

  test("matches secret names case-insensitively", () => {
    const current = [makeSecret("my_secret")];
    const desired = ["MY_SECRET"];
    const changes = diffSecrets(current, desired, false);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, "update");
  });

  test("handles mixed create, update, and delete", () => {
    const current = [makeSecret("EXISTING"), makeSecret("ORPHAN")];
    const desired = ["EXISTING", "BRAND_NEW"];
    const changes = diffSecrets(current, desired, true);
    assert.equal(changes.length, 3);
    const actions = changes.map((c) => c.action);
    assert.ok(actions.includes("create"));
    assert.ok(actions.includes("update"));
    assert.ok(actions.includes("delete"));
  });

  test("sorts changes: delete, update, create", () => {
    const current = [makeSecret("DELETE_ME"), makeSecret("UPDATE_ME")];
    const desired = ["UPDATE_ME", "CREATE_ME"];
    const changes = diffSecrets(current, desired, true);
    assert.equal(changes[0].action, "delete");
    assert.equal(changes[1].action, "update");
    assert.equal(changes[2].action, "create");
  });

  test("empty current and empty desired returns no changes", () => {
    const changes = diffSecrets([], [], false);
    assert.equal(changes.length, 0);
  });

  test("empty current and empty desired with deleteOrphaned returns no changes", () => {
    const changes = diffSecrets([], [], true);
    assert.equal(changes.length, 0);
  });

  test("deleteOrphaned with multiple orphans deletes all", () => {
    const current = [makeSecret("A"), makeSecret("B"), makeSecret("C")];
    const desired: string[] = [];
    const changes = diffSecrets(current, desired, true);
    assert.equal(changes.length, 3);
    assert.ok(changes.every((c) => c.action === "delete"));
  });
});
