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

  test("rejects any .git path segment, case-insensitively", () => {
    for (const name of [
      ".git",
      ".git/config",
      ".git/hooks/post-checkout",
      "sub/.git/config",
      "a/b/.git",
      ".GIT/config",
      "sub/.Git/hooks/x",
      ".git\\config",
      "sub\\.git\\config",
      "./.git/config",
      "sub//.git/config",
    ]) {
      assert.throws(
        () => validateFileName(name),
        /'\.git'/,
        JSON.stringify(name)
      );
    }
  });

  test("allows names that only resemble .git", () => {
    for (const name of [
      ".github/workflows/ci.yml",
      ".gitignore",
      ".gitattributes",
      ".gitmodules",
      ".gitkeep",
      "foo.git/file",
      "foo.git",
      "sub/.github/CODEOWNERS",
      ".git-blame-ignore-revs",
      "git/config",
    ]) {
      assert.doesNotThrow(() => validateFileName(name), name);
    }
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

describe("validateFileName .git aliases", () => {
  for (const name of [
    ".git./config",
    ".git /config",
    ".git. . /config",
    "GIT~1/config",
    "git~12/config",
    ".git::$INDEX_ALLOCATION/config",
    ".g\u200Cit/config",
    "\uFEFF.git/config",
  ]) {
    test(`rejects ${JSON.stringify(name)}`, () => {
      assert.throws(() => validateFileName(name), /'\.git'/);
    });
  }

  test("still accepts lookalikes that are not .git", () => {
    for (const name of [
      ".github/x",
      ".gitignore",
      "foo.git/x",
      "git/x",
      "git~x/y",
    ]) {
      assert.doesNotThrow(() => validateFileName(name), name);
    }
  });
});
