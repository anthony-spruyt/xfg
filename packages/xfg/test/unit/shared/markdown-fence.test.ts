import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  appendDiffBlock,
  inlineCode,
} from "../../../src/shared/markdown-fence.js";

describe("appendDiffBlock", () => {
  test("appends a three-backtick diff block and a blank line", () => {
    const lines = ["### org/repo"];
    appendDiffBlock(lines, ["+a", "-b"]);
    assert.deepEqual(lines, ["### org/repo", "```diff", "+a", "-b", "```", ""]);
  });

  test("appends nothing when there are no diff lines", () => {
    const lines = ["### org/repo"];
    appendDiffBlock(lines, []);
    assert.deepEqual(lines, ["### org/repo"]);
  });

  test("uses a fence longer than any backtick run in the content", () => {
    const lines: string[] = [];
    appendDiffBlock(lines, [" ```"]);
    assert.deepEqual(lines, ["````diff", " ```", "````", ""]);
  });

  test("handles backtick runs longer than three", () => {
    const lines: string[] = [];
    appendDiffBlock(lines, [" `````"]);
    assert.equal(lines[0], "``````diff");
    assert.equal(lines[2], "``````");
  });

  test("handles diffs too large to spread into push()", () => {
    const lines: string[] = [];
    const diffLines = Array.from({ length: 500_000 }, (_, i) => `+${i}`);
    appendDiffBlock(lines, diffLines);
    assert.equal(lines.length, diffLines.length + 3);
  });
});

describe("inlineCode", () => {
  test("wraps plain text in single backticks", () => {
    assert.equal(inlineCode("config.json"), "`config.json`");
  });

  test("uses a fence longer than any backtick run in the text", () => {
    assert.equal(inlineCode("a`b"), "``a`b``");
    assert.equal(inlineCode("a``b"), "```a``b```");
  });

  test("pads with spaces when the text starts or ends with a backtick", () => {
    assert.equal(inlineCode("`a"), "`` `a ``");
    assert.equal(inlineCode("a`"), "`` a` ``");
  });

  test("pads when the text starts and ends with a space, so both survive", () => {
    assert.equal(inlineCode(" a "), "`  a  `");
    assert.equal(inlineCode(" a"), "` a`");
    assert.equal(inlineCode("  "), "`  `");
  });
});
