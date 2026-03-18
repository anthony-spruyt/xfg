import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { validateRepoSettings } from "../../../src/config/validators/repo-settings-validator.js";

describe("validateRepoSettings", () => {
  test("accepts valid settings object", () => {
    assert.doesNotThrow(() =>
      validateRepoSettings({ hasIssues: true, visibility: "public" }, "test")
    );
  });

  test("accepts empty object", () => {
    assert.doesNotThrow(() => validateRepoSettings({}, "test"));
  });

  test("rejects non-object input", () => {
    assert.throws(
      () => validateRepoSettings("string", "test"),
      /must be an object/
    );
    assert.throws(
      () => validateRepoSettings(null, "test"),
      /must be an object/
    );
    assert.throws(() => validateRepoSettings([], "test"), /must be an object/);
  });

  test("rejects non-boolean for boolean fields", () => {
    assert.throws(
      () => validateRepoSettings({ hasIssues: "yes" }, "test"),
      /hasIssues must be a boolean/
    );
  });

  test("rejects non-string defaultBranch", () => {
    assert.throws(
      () => validateRepoSettings({ defaultBranch: 42 }, "test"),
      /defaultBranch must be a string/
    );
  });

  test("rejects invalid visibility", () => {
    assert.throws(
      () => validateRepoSettings({ visibility: "hidden" }, "test"),
      /visibility must be one of/
    );
  });

  test("accepts valid visibility values", () => {
    for (const v of ["public", "private", "internal"]) {
      assert.doesNotThrow(() =>
        validateRepoSettings({ visibility: v }, "test")
      );
    }
  });

  test("rejects invalid squashMergeCommitTitle", () => {
    assert.throws(
      () => validateRepoSettings({ squashMergeCommitTitle: "INVALID" }, "test"),
      /squashMergeCommitTitle must be one of/
    );
  });

  test("rejects invalid mergeCommitMessage", () => {
    assert.throws(
      () => validateRepoSettings({ mergeCommitMessage: "INVALID" }, "test"),
      /mergeCommitMessage must be one of/
    );
  });
});
