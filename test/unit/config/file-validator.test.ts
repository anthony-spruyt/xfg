import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  validateFileName,
  isStructuredFileExtension,
} from "../../../src/config/validators/file-validator.js";

describe("isStructuredFileExtension", () => {
  test("returns true for JSON extensions", () => {
    assert.equal(isStructuredFileExtension("config.json"), true);
    assert.equal(isStructuredFileExtension("config.json5"), true);
  });

  test("returns true for YAML extensions", () => {
    assert.equal(isStructuredFileExtension("config.yaml"), true);
    assert.equal(isStructuredFileExtension("config.yml"), true);
  });

  test("returns false for non-structured extensions", () => {
    assert.equal(isStructuredFileExtension("script.sh"), false);
    assert.equal(isStructuredFileExtension("readme.md"), false);
    assert.equal(isStructuredFileExtension("Dockerfile"), false);
  });

  test("is case-insensitive", () => {
    assert.equal(isStructuredFileExtension("config.JSON"), true);
    assert.equal(isStructuredFileExtension("config.YAML"), true);
  });
});

describe("validateFileName", () => {
  test("accepts valid relative paths", () => {
    assert.doesNotThrow(() => validateFileName("config.json"));
    assert.doesNotThrow(() => validateFileName("dir/config.json"));
  });

  test("rejects empty string", () => {
    assert.throws(() => validateFileName(""), /non-empty string/);
  });

  test("rejects path traversal", () => {
    assert.throws(() => validateFileName("../secret"), /relative path/);
    assert.throws(() => validateFileName("dir/../file"), /relative path/);
  });

  test("rejects absolute paths", () => {
    assert.throws(() => validateFileName("/etc/passwd"), /relative path/);
  });

  test("rejects control characters", () => {
    assert.throws(
      () => validateFileName("file\nname"),
      /newlines or null bytes/
    );
    assert.throws(
      () => validateFileName("file\0name"),
      /newlines or null bytes/
    );
  });
});
