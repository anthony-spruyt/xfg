import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatStatusBadge,
  type FileStatus,
} from "../../../src/shared/file-status.js";

describe("formatStatusBadge", () => {
  const cases: Array<[FileStatus, string]> = [
    ["NEW", "[NEW]"],
    ["MODIFIED", "[MODIFIED]"],
    ["UNCHANGED", "[UNCHANGED]"],
    ["DELETED", "[DELETED]"],
  ];

  for (const [status, expected] of cases) {
    test(`returns badge containing ${expected} for ${status}`, () => {
      const result = formatStatusBadge(status);
      // Strip ANSI codes to test the text content
      const stripped = result.replace(
        new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g"),
        ""
      );
      assert.equal(stripped, expected);
    });
  }
});
