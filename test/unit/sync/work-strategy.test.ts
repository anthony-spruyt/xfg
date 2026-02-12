import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import type { WorkResult } from "../../../src/sync/types.js";
import type { FileWriteResult } from "../../../src/sync/types.js";

describe("IWorkStrategy interface", () => {
  test("WorkResult has required shape", () => {
    const result: WorkResult = {
      fileChanges: new Map<string, FileWriteResult>(),
      changedFiles: [],
      commitMessage: "test commit",
      fileChangeDetails: [],
    };
    assert.ok(result.fileChanges instanceof Map);
    assert.ok(Array.isArray(result.changedFiles));
    assert.equal(typeof result.commitMessage, "string");
    assert.ok(Array.isArray(result.fileChangeDetails));
  });
});
