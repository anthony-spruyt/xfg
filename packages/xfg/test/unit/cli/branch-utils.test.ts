import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeBranchName,
  validateBranchName,
} from "../../../src/cli/branch-utils.js";
import { ValidationError } from "../../../src/shared/errors.js";

describe("sanitizeBranchName", () => {
  test("lowercases and removes extension", () => {
    assert.equal(sanitizeBranchName("MyFile.yaml"), "myfile");
  });

  test("replaces special characters with dashes", () => {
    assert.equal(sanitizeBranchName("my file@v2.json"), "my-file-v2");
  });

  test("collapses multiple dashes", () => {
    assert.equal(sanitizeBranchName("a--b--c.txt"), "a-b-c");
  });

  test("removes leading and trailing dashes", () => {
    assert.equal(sanitizeBranchName("-foo-.yaml"), "foo");
  });

  test("handles dotfiles", () => {
    assert.equal(sanitizeBranchName(".eslintrc.json"), "eslintrc");
  });
});

describe("validateBranchName", () => {
  test("accepts valid branch name", () => {
    assert.doesNotThrow(() => validateBranchName("feature/my-branch"));
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
});
