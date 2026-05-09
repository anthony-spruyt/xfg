import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { escapeRegExp } from "../../../src/shared/shell-utils.js";

describe("escapeRegExp", () => {
  test("escapes special regex characters", () => {
    assert.strictEqual(escapeRegExp("a.b"), "a\\.b");
    assert.strictEqual(escapeRegExp("a*b"), "a\\*b");
    assert.strictEqual(escapeRegExp("a+b"), "a\\+b");
    assert.strictEqual(escapeRegExp("a?b"), "a\\?b");
    assert.strictEqual(escapeRegExp("a^b"), "a\\^b");
    assert.strictEqual(escapeRegExp("a$b"), "a\\$b");
    assert.strictEqual(escapeRegExp("a{b}"), "a\\{b\\}");
    assert.strictEqual(escapeRegExp("a[b]"), "a\\[b\\]");
    assert.strictEqual(escapeRegExp("a(b)"), "a\\(b\\)");
    assert.strictEqual(escapeRegExp("a|b"), "a\\|b");
    assert.strictEqual(escapeRegExp("a\\b"), "a\\\\b");
  });

  test("returns plain string unchanged", () => {
    assert.strictEqual(escapeRegExp("hello"), "hello");
  });

  test("handles empty string", () => {
    assert.strictEqual(escapeRegExp(""), "");
  });
});
