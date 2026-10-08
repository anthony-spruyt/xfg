import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { runSequentially } from "../../../src/shared/sequential.js";

describe("runSequentially", () => {
  test("runs each task in order, starting the next only after the previous settles", async () => {
    const events: string[] = [];
    await runSequentially([1, 2, 3], async (n) => {
      events.push(`start ${n}`);
      await new Promise((resolve) => setTimeout(resolve, 3 - n));
      events.push(`end ${n}`);
    });
    assert.deepStrictEqual(events, [
      "start 1",
      "end 1",
      "start 2",
      "end 2",
      "start 3",
      "end 3",
    ]);
  });

  test("stops at the first failure and rejects with its error", async () => {
    const seen: number[] = [];
    await assert.rejects(
      runSequentially([1, 2, 3], async (n) => {
        seen.push(n);
        if (n === 2) throw new Error("boom");
      }),
      /boom/
    );
    assert.deepStrictEqual(seen, [1, 2]);
  });

  test("resolves without calling the task for an empty list", async () => {
    let calls = 0;
    await runSequentially([], async () => {
      calls++;
    });
    assert.equal(calls, 0);
  });
});
