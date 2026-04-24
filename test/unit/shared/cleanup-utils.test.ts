import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { safeCleanup } from "../../../src/shared/cleanup-utils.js";

describe("safeCleanup", () => {
  test("executes sync cleanup and does not log on success", async () => {
    const calls: string[] = [];
    const log = {
      debug(msg: string) {
        calls.push(msg);
      },
    };
    let receivedArg: string | undefined;
    await safeCleanup(
      () => {
        receivedArg = "sync-done";
      },
      "test-sync",
      log
    );
    assert.equal(receivedArg, "sync-done");
    assert.deepStrictEqual(calls, [], "debug should not be called on success");
  });

  test("executes async cleanup and does not log on success", async () => {
    const calls: string[] = [];
    const log = {
      debug(msg: string) {
        calls.push(msg);
      },
    };
    let receivedArg: string | undefined;
    await safeCleanup(
      async () => {
        receivedArg = "async-done";
      },
      "test-async",
      log
    );
    assert.equal(receivedArg, "async-done");
    assert.deepStrictEqual(calls, [], "debug should not be called on success");
  });

  test("does not propagate sync errors", async () => {
    const log = { debug() {} };
    await assert.doesNotReject(() =>
      safeCleanup(
        () => {
          throw new Error("should be swallowed");
        },
        "sync-err",
        log
      )
    );
  });

  test("does not propagate async errors", async () => {
    const log = { debug() {} };
    await assert.doesNotReject(() =>
      safeCleanup(
        async () => {
          throw new Error("should be swallowed");
        },
        "async-err",
        log
      )
    );
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
