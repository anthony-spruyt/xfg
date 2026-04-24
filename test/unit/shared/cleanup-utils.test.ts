import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { safeCleanup } from "../../../src/shared/cleanup-utils.js";

describe("safeCleanup", () => {
  test("executes sync cleanup function", async () => {
    let called = false;
    const log = { debug() {} };
    await safeCleanup(
      () => {
        called = true;
      },
      "test",
      log
    );
    assert.ok(called);
  });

  test("executes async cleanup function", async () => {
    let called = false;
    const log = { debug() {} };
    await safeCleanup(
      async () => {
        called = true;
      },
      "test",
      log
    );
    assert.ok(called);
  });

  test("swallows sync errors and logs debug", async () => {
    const debugMessages: string[] = [];
    const log = {
      debug(msg: string) {
        debugMessages.push(msg);
      },
    };
    await safeCleanup(
      () => {
        throw new Error("boom");
      },
      "rmdir",
      log
    );
    assert.ok(debugMessages.some((m) => m.includes("Cleanup: rmdir")));
    assert.ok(debugMessages.some((m) => m.includes("boom")));
  });

  test("swallows async errors and logs debug", async () => {
    const debugMessages: string[] = [];
    const log = {
      debug(msg: string) {
        debugMessages.push(msg);
      },
    };
    await safeCleanup(
      async () => {
        throw new Error("async boom");
      },
      "cleanup",
      log
    );
    assert.ok(debugMessages.some((m) => m.includes("async boom")));
  });
});
