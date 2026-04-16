import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseMergeMode,
  parseMergeStrategy,
} from "../../../src/cli/program.js";

describe("parseMergeMode", () => {
  test("accepts 'manual'", () => {
    assert.equal(parseMergeMode("manual"), "manual");
  });

  test("accepts 'auto'", () => {
    assert.equal(parseMergeMode("auto"), "auto");
  });

  test("accepts 'force'", () => {
    assert.equal(parseMergeMode("force"), "force");
  });

  test("accepts 'direct'", () => {
    assert.equal(parseMergeMode("direct"), "direct");
  });

  test("throws ValidationError for invalid mode", () => {
    assert.throws(() => parseMergeMode("invalid"), { name: "ValidationError" });
  });

  test("error message includes invalid value", () => {
    assert.throws(() => parseMergeMode("bad"), /Invalid merge mode: bad/);
  });

  test("error message lists valid options", () => {
    assert.throws(() => parseMergeMode("bad"), /manual, auto, force, direct/);
  });
});

describe("parseMergeStrategy", () => {
  test("accepts 'merge'", () => {
    assert.equal(parseMergeStrategy("merge"), "merge");
  });

  test("accepts 'squash'", () => {
    assert.equal(parseMergeStrategy("squash"), "squash");
  });

  test("accepts 'rebase'", () => {
    assert.equal(parseMergeStrategy("rebase"), "rebase");
  });

  test("throws ValidationError for invalid strategy", () => {
    assert.throws(() => parseMergeStrategy("invalid"), {
      name: "ValidationError",
    });
  });

  test("error message includes invalid value", () => {
    assert.throws(
      () => parseMergeStrategy("bad"),
      /Invalid merge strategy: bad/
    );
  });

  test("error message lists valid options", () => {
    assert.throws(() => parseMergeStrategy("bad"), /merge, squash, rebase/);
  });
});
