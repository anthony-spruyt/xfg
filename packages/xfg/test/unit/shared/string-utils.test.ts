import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  camelToSnake,
  formatScalarValue,
  quoted,
} from "../../../src/shared/string-utils.js";

describe("camelToSnake", () => {
  test("converts camelCase to snake_case", () => {
    assert.equal(camelToSnake("fooBar"), "foo_bar");
  });

  test("converts PascalCase to snake_case", () => {
    assert.equal(camelToSnake("FooBar"), "_foo_bar");
  });

  test("leaves lowercase unchanged", () => {
    assert.equal(camelToSnake("foobar"), "foobar");
  });
});

describe("quoted", () => {
  test("wraps text in double quotes", () => {
    assert.equal(quoted("bug"), '"bug"');
  });

  test("escapes \\n and \\r so the text stays on one line", () => {
    assert.equal(quoted("a\r\nb\nc"), '"a\\r\\nb\\nc"');
  });

  test("keeps backslashes and quotes as written", () => {
    assert.equal(quoted('^feat\\("'), '"^feat\\(""');
  });
});

describe("formatScalarValue", () => {
  test("escapes line breaks but keeps backslashes and quotes as written", () => {
    assert.equal(formatScalarValue('^feat\\(\n"x"'), '"^feat\\(\\n"x""');
  });

  test("formats null", () => {
    assert.equal(formatScalarValue(null), "null");
  });

  test("formats undefined", () => {
    assert.equal(formatScalarValue(undefined), "undefined");
  });

  test("formats string with quotes", () => {
    assert.equal(formatScalarValue("hello"), '"hello"');
  });

  test("formats empty string with quotes", () => {
    assert.equal(formatScalarValue(""), '""');
  });

  test("formats true", () => {
    assert.equal(formatScalarValue(true), "true");
  });

  test("formats false", () => {
    assert.equal(formatScalarValue(false), "false");
  });

  test("returns undefined for numbers", () => {
    assert.equal(formatScalarValue(42), undefined);
  });

  test("returns undefined for objects", () => {
    assert.equal(formatScalarValue({}), undefined);
  });

  test("returns undefined for arrays", () => {
    assert.equal(formatScalarValue([]), undefined);
  });
});
