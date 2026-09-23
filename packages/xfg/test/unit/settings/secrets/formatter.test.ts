import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatSecretsPlan } from "../../../../src/settings/secrets/formatter.js";
import type { SecretChange } from "../../../../src/settings/secrets/diff.js";

const escCodePattern = new RegExp(
  `${String.fromCharCode(0x1b)}\\[[0-9;]*m`,
  "g"
);
function stripAnsi(str: string): string {
  return str.replace(escCodePattern, "");
}

describe("formatSecretsPlan", () => {
  test("names every secret grouped create, update, delete", () => {
    const changes: SecretChange[] = [
      { action: "delete", name: "OLD_TOKEN" },
      { action: "update", name: "DEPLOY_TOKEN" },
      { action: "create", name: "NEW_KEY" },
    ];

    const result = formatSecretsPlan(changes);

    assert.deepEqual(result.lines.map(stripAnsi), [
      '    + secret "NEW_KEY"',
      '    ~ secret "DEPLOY_TOKEN" (update, value write-only)',
      '    - secret "OLD_TOKEN"',
      "  Plan: 3 secrets (1 to create, 1 to update, 1 to delete)",
    ]);
    assert.deepEqual(result.entries, [
      { name: "NEW_KEY", action: "create" },
      { name: "DEPLOY_TOKEN", action: "update" },
      { name: "OLD_TOKEN", action: "delete" },
    ]);
  });

  test("uses the singular noun for one secret", () => {
    const result = formatSecretsPlan([{ action: "create", name: "ONLY" }]);
    assert.equal(
      stripAnsi(result.lines.at(-1)!),
      "  Plan: 1 secret (1 to create)"
    );
  });

  test("returns no lines when nothing changes", () => {
    const result = formatSecretsPlan([]);
    assert.deepEqual(result.lines, []);
    assert.deepEqual(result.entries, []);
  });
});
