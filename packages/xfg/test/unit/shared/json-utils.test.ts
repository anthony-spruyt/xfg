import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseApiJson } from "../../../src/shared/json-utils.js";
import { SyncError } from "../../../src/shared/errors.js";

describe("parseApiJson", () => {
  test("parses valid JSON", () => {
    const result = parseApiJson<{ id: number }>('{"id": 42}', "test");
    assert.deepStrictEqual(result, { id: 42 });
  });

  test("parses JSON array", () => {
    const result = parseApiJson<number[]>("[1, 2, 3]", "test");
    assert.deepStrictEqual(result, [1, 2, 3]);
  });

  test("throws SyncError with context on invalid JSON", () => {
    assert.throws(
      () => parseApiJson("not json", "GitHub API response"),
      (err: unknown) => {
        assert.ok(err instanceof SyncError);
        assert.ok(err.message.includes("Failed to parse GitHub API response"));
        assert.ok(err.message.includes("not json"));
        return true;
      }
    );
  });

  test("truncates long invalid response in error message", () => {
    const longResponse = "x".repeat(300);
    assert.throws(
      () => parseApiJson(longResponse, "test"),
      (err: unknown) => {
        assert.ok(err instanceof SyncError);
        assert.ok(err.message.length < longResponse.length + 100);
        return true;
      }
    );
  });
});
