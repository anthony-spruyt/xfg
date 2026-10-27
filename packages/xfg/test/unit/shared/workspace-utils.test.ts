import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { generateWorkspaceName } from "../../../src/shared/workspace-utils.js";

describe("generateWorkspaceName", () => {
  test("generates name with correct prefix", () => {
    const name = generateWorkspaceName(0);
    assert.ok(name.startsWith("repo-"));
  });

  test("includes index in name", () => {
    const name0 = generateWorkspaceName(0);
    const name5 = generateWorkspaceName(5);
    const name99 = generateWorkspaceName(99);

    assert.ok(name0.includes("-0-"));
    assert.ok(name5.includes("-5-"));
    assert.ok(name99.includes("-99-"));
  });

  test("generates unique names for same index", () => {
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) {
      names.add(generateWorkspaceName(0));
    }
    // All 100 names should be unique due to UUID component
    assert.equal(names.size, 100);
  });

  test("generates unique names across different indices", () => {
    const names = new Set<string>();
    for (let i = 0; i < 50; i++) {
      names.add(generateWorkspaceName(i));
    }
    assert.equal(names.size, 50);
  });

  test("name matches expected pattern", () => {
    const name = generateWorkspaceName(42);
    // Pattern: repo-{timestamp}-{index}-{8-char-uuid}
    const pattern = /^repo-\d+-42-[a-f0-9]{8}$/;
    assert.ok(pattern.test(name), `Name "${name}" should match pattern`);
  });

  test("handles large index values", () => {
    const name = generateWorkspaceName(999999);
    assert.ok(name.includes("-999999-"));
  });

  test("handles zero index", () => {
    const name = generateWorkspaceName(0);
    assert.ok(name.includes("-0-"));
  });
});
