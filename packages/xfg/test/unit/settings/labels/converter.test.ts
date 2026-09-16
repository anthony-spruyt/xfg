import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  normalizeColor,
  labelConfigToPayload,
} from "../../../../src/settings/labels/converter.js";

describe("normalizeColor", () => {
  test("strips # prefix", () => {
    assert.equal(normalizeColor("#d73a4a"), "d73a4a");
  });

  test("lowercases hex", () => {
    assert.equal(normalizeColor("D73A4A"), "d73a4a");
  });

  test("strips # and lowercases", () => {
    assert.equal(normalizeColor("#D73A4A"), "d73a4a");
  });

  test("passes through valid lowercase hex", () => {
    assert.equal(normalizeColor("d73a4a"), "d73a4a");
  });
});

describe("labelConfigToPayload", () => {
  test("converts label config to API payload for create", () => {
    const payload = labelConfigToPayload("bug", {
      color: "#d73a4a",
      description: "Something isn't working",
    });
    assert.deepEqual(payload, {
      name: "bug",
      color: "d73a4a",
      description: "Something isn't working",
    });
  });

  test("includes new_name when present", () => {
    const payload = labelConfigToPayload("old-name", {
      color: "d73a4a",
      new_name: "new-name",
    });
    assert.deepEqual(payload, {
      name: "old-name",
      new_name: "new-name",
      color: "d73a4a",
    });
  });

  test("omits description when undefined", () => {
    const payload = labelConfigToPayload("bug", { color: "d73a4a" });
    assert.deepEqual(payload, { name: "bug", color: "d73a4a" });
  });

  test("includes empty string description", () => {
    const payload = labelConfigToPayload("bug", {
      color: "d73a4a",
      description: "",
    });
    assert.deepEqual(payload, {
      name: "bug",
      color: "d73a4a",
      description: "",
    });
  });
});
