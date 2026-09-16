import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { validateBranchName } from "../../../src/shared/branch-validation.js";
import { ValidationError } from "../../../src/shared/errors.js";

describe("shared/branch-validation", () => {
  test("accepts valid branch name", () => {
    assert.doesNotThrow(() => validateBranchName("feature/my-branch"));
  });

  test("accepts branch with slashes and dashes", () => {
    assert.doesNotThrow(() => validateBranchName("chore/sync-config"));
  });

  test("rejects empty string", () => {
    assert.throws(
      () => validateBranchName(""),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects whitespace-only", () => {
    assert.throws(
      () => validateBranchName("   "),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch starting with dot", () => {
    assert.throws(
      () => validateBranchName(".hidden"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch starting with dash", () => {
    assert.throws(
      () => validateBranchName("-invalid"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch with spaces", () => {
    assert.throws(
      () => validateBranchName("my branch"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch with forbidden characters", () => {
    const forbidden = [
      "feat~1",
      "feat^2",
      "feat:name",
      "feat?name",
      "feat*name",
      "feat[0]",
      "feat\\name",
    ];
    for (const name of forbidden) {
      assert.throws(
        () => validateBranchName(name),
        (err: unknown) => err instanceof ValidationError,
        `Expected "${name}" to be rejected`
      );
    }
  });

  test("rejects branch ending with .lock", () => {
    assert.throws(
      () => validateBranchName("branch.lock"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch ending with dot", () => {
    assert.throws(
      () => validateBranchName("branch."),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch with consecutive dots", () => {
    assert.throws(
      () => validateBranchName("feature..name"),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test("rejects branch ending with slash", () => {
    assert.throws(
      () => validateBranchName("feature/"),
      (err: unknown) => err instanceof ValidationError
    );
  });
});
