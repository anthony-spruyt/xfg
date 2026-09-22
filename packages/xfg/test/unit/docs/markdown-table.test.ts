import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTable,
  escapeCell,
  firstSentence,
} from "../../../scripts/docs/markdown-table.js";

describe("renderTable", () => {
  test("pads every cell to the column width", () => {
    const out = renderTable(
      ["Option", "Description"],
      [
        ["`-c`", "Path"],
        ["`--work-dir`", "Temporary directory"],
      ]
    );
    assert.equal(
      out,
      [
        "| Option       | Description         |",
        "| ------------ | ------------------- |",
        "| `-c`         | Path                |",
        "| `--work-dir` | Temporary directory |",
      ].join("\n")
    );
  });

  test("dash row is at least three dashes wide", () => {
    const out = renderTable(["A"], [["b"]]);
    assert.equal(
      out,
      [
        "| A   |",
        "| --- |",
        "| b   |",
      ].join("\n")
    );
  });

  test("pads short rows with empty cells", () => {
    const out = renderTable(["A", "B"], [["x"]]);
    assert.equal(
      out,
      [
        "| A   | B   |",
        "| --- | --- |",
        "| x   |     |",
      ].join("\n")
    );
  });
});

describe("firstSentence", () => {
  test("returns short text unchanged", () => {
    assert.equal(firstSentence("Short text."), "Short text.");
  });

  test("takes only the leading sentence", () => {
    assert.equal(
      firstSentence("First sentence here. Second sentence follows."),
      "First sentence here."
    );
  });

  test("does not split on a period inside a version or path", () => {
    assert.equal(firstSentence("Use v1.2.3 now."), "Use v1.2.3 now.");
  });

  test("does not split on a lowercase continuation", () => {
    assert.equal(
      firstSentence("Ends here. then lowercase."),
      "Ends here. then lowercase."
    );
  });

  test("returns the whole string when there is no sentence break", () => {
    assert.equal(firstSentence("no punctuation at all"), "no punctuation at all");
  });
});

describe("escapeCell", () => {
  test("escapes backslashes before the characters they would escape", () => {
    assert.equal(escapeCell("a \\| b"), "a \\\\\\| b");
    assert.equal(escapeCell("path\\\\to"), "path\\\\\\\\to");
  });

  test("escapes pipes", () => {
    assert.equal(escapeCell("a | b"), "a \\| b");
  });

  test("escapes opening angle brackets the way mdformat does", () => {
    assert.equal(escapeCell("<path>"), "\\<path>");
  });

  test("collapses newlines and runs of whitespace", () => {
    assert.equal(escapeCell("one\ntwo   three"), "one two three");
  });

  test("wraps bare URLs in backticks so markdownlint MD034 passes", () => {
    assert.equal(
      escapeCell(
        "Supports https://github.com/owner/repo.git and git@host:o/r.git formats"
      ),
      "Supports `https://github.com/owner/repo.git` and `git@host:o/r.git` formats"
    );
  });

  test("leaves URLs that are already in backticks alone", () => {
    assert.equal(escapeCell("see `https://x.dev`"), "see `https://x.dev`");
  });

  test("returns an empty string for undefined", () => {
    assert.equal(escapeCell(undefined), "");
  });
});
