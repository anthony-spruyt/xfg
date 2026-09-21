import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { diffSecrets } from "../../../../src/settings/secrets/diff.js";
import type { GitHubSecret } from "../../../../src/settings/secrets/types.js";

function secret(name: string): GitHubSecret {
  return { name, created_at: "", updated_at: "" };
}

describe("diffSecrets", () => {
  test("reports create for a secret not present remotely", () => {
    const changes = diffSecrets([], ["NEW_ONE"], false);
    assert.deepEqual(changes, [{ action: "create", name: "NEW_ONE" }]);
  });

  test("reports update for a secret already present remotely", () => {
    const changes = diffSecrets([secret("EXISTING")], ["EXISTING"], false);
    assert.deepEqual(changes, [{ action: "update", name: "EXISTING" }]);
  });

  test("never reports unchanged — remote secret values are write-only", () => {
    const changes = diffSecrets([secret("EXISTING")], ["EXISTING"], false);
    assert.equal(
      changes.some((c) => c.action === "unchanged"),
      false
    );
  });

  test("matches remote secrets case-insensitively", () => {
    const changes = diffSecrets([secret("my_secret")], ["MY_SECRET"], false);
    assert.deepEqual(changes, [{ action: "update", name: "MY_SECRET" }]);
  });

  test("reports delete for orphans when deleteOrphaned is true", () => {
    const changes = diffSecrets([secret("ORPHAN")], [], true);
    assert.deepEqual(changes, [{ action: "delete", name: "ORPHAN" }]);
  });

  test("uses the remote casing for a deleted orphan", () => {
    const changes = diffSecrets([secret("orphan")], [], true);
    assert.deepEqual(changes, [{ action: "delete", name: "orphan" }]);
  });

  test("leaves orphans alone when deleteOrphaned is false", () => {
    const changes = diffSecrets([secret("ORPHAN")], [], false);
    assert.deepEqual(changes, []);
  });

  test("does not delete a desired secret that differs only in case", () => {
    const changes = diffSecrets([secret("my_secret")], ["MY_SECRET"], true);
    assert.deepEqual(changes, [{ action: "update", name: "MY_SECRET" }]);
  });

  test("orders deletes before updates before creates", () => {
    const changes = diffSecrets(
      [secret("EXISTING"), secret("ORPHAN")],
      ["BRAND_NEW", "EXISTING"],
      true
    );
    assert.deepEqual(
      changes.map((c) => c.action),
      ["delete", "update", "create"]
    );
  });
});
