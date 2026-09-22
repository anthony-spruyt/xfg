import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applyGeneratedBlocks,
  findGeneratedBlockIds,
} from "../../../scripts/docs/generated-blocks.js";

const doc = [
  "# Title",
  "",
  "intro",
  "",
  "<!-- xfg:generated demo:one -->",
  "",
  "stale",
  "",
  "<!-- xfg:generated:end -->",
  "",
  "outro",
  "",
].join("\n");

describe("applyGeneratedBlocks", () => {
  test("replaces block body with rendered content and keeps markers", () => {
    const out = applyGeneratedBlocks(doc, (id) => `fresh ${id}`);
    assert.equal(
      out,
      [
        "# Title",
        "",
        "intro",
        "",
        "<!-- xfg:generated demo:one -->",
        "",
        "<!-- markdownlint-disable MD013 -->",
        "",
        "fresh demo:one",
        "",
        "<!-- markdownlint-enable MD013 -->",
        "",
        "<!-- xfg:generated:end -->",
        "",
        "outro",
        "",
      ].join("\n")
    );
  });

  test("is idempotent", () => {
    const once = applyGeneratedBlocks(doc, (id) => `fresh ${id}`);
    const twice = applyGeneratedBlocks(once, (id) => `fresh ${id}`);
    assert.equal(twice, once);
  });

  test("handles multiple blocks", () => {
    const two = `${doc}\n<!-- xfg:generated demo:two -->\n\nx\n\n<!-- xfg:generated:end -->\n`;
    const out = applyGeneratedBlocks(two, (id) => `[${id}]`);
    assert.match(out, /\[demo:one\]/);
    assert.match(out, /\[demo:two\]/);
    assert.doesNotMatch(out, /\nstale\n/);
  });

  test("leaves documents without markers untouched", () => {
    assert.equal(
      applyGeneratedBlocks("# plain\n", () => "x"),
      "# plain\n"
    );
  });

  test("throws on a start marker without an end marker", () => {
    assert.throws(
      () => applyGeneratedBlocks("<!-- xfg:generated a:b -->\n", () => "x"),
      /unterminated generated block 'a:b'/
    );
  });

  test("throws on an end marker without a start marker", () => {
    assert.throws(
      () => applyGeneratedBlocks("<!-- xfg:generated:end -->\n", () => "x"),
      /end marker without a start/
    );
  });
});

describe("findGeneratedBlockIds", () => {
  test("lists block ids in document order", () => {
    const two = `${doc}<!-- xfg:generated demo:two -->\n<!-- xfg:generated:end -->\n`;
    assert.deepEqual(findGeneratedBlockIds(two), ["demo:one", "demo:two"]);
  });
});
