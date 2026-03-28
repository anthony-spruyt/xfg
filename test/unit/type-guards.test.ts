import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { isPlainObject, toErrorMessage } from "../../src/shared/type-guards.js";
import { safeCleanup } from "../../src/shared/cleanup-utils.js";

describe("isPlainObject", () => {
  test("returns true for plain objects", () => {
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject({ a: 1 }), true);
  });

  test("returns false for arrays", () => {
    assert.equal(isPlainObject([]), false);
    assert.equal(isPlainObject([1, 2]), false);
  });

  test("returns false for null and undefined", () => {
    assert.equal(isPlainObject(null), false);
    assert.equal(isPlainObject(undefined), false);
  });

  test("returns false for primitives", () => {
    assert.equal(isPlainObject("string"), false);
    assert.equal(isPlainObject(42), false);
    assert.equal(isPlainObject(true), false);
  });
});

describe("toErrorMessage", () => {
  test("extracts message from Error instances", () => {
    assert.equal(toErrorMessage(new Error("test error")), "test error");
  });

  test("converts non-Error values to string", () => {
    assert.equal(toErrorMessage("string error"), "string error");
    assert.equal(toErrorMessage(42), "42");
    assert.equal(toErrorMessage(null), "null");
    assert.equal(toErrorMessage(undefined), "undefined");
  });
});

describe("safeCleanup", () => {
  test("calls the function and swallows sync errors", async () => {
    const messages: string[] = [];
    const log = { debug: (msg: string) => messages.push(msg) };

    await safeCleanup(
      () => {
        throw new Error("boom");
      },
      "test cleanup",
      log
    );

    assert.equal(messages.length, 1);
    assert.match(messages[0], /Cleanup: test cleanup: boom/);
  });

  test("calls the function and swallows async errors", async () => {
    const messages: string[] = [];
    const log = { debug: (msg: string) => messages.push(msg) };

    await safeCleanup(
      async () => {
        throw new Error("async boom");
      },
      "async cleanup",
      log
    );

    assert.equal(messages.length, 1);
    assert.match(messages[0], /Cleanup: async cleanup: async boom/);
  });

  test("does not log when function succeeds", async () => {
    const messages: string[] = [];
    const log = { debug: (msg: string) => messages.push(msg) };

    await safeCleanup(() => {}, "noop", log);

    assert.equal(messages.length, 0);
  });
});
