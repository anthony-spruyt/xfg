import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  fitSummary,
  summaryHeader,
} from "../../../src/output/summary-budget.js";

function repoBlock(name: string, lineCount: number) {
  return {
    heading: `### ${name}`,
    diffLines: Array.from({ length: lineCount }, (_, i) => `+ line ${i}`),
  };
}

describe("summaryHeader", () => {
  test("adds the dry run warning", () => {
    assert.deepEqual(summaryHeader(true), [
      "## xfg Plan",
      "",
      "> [!WARNING]",
      "> This was a dry run — no changes were applied",
      "",
    ]);
  });

  test("uses a custom title", () => {
    assert.deepEqual(summaryHeader(false, "## Custom"), ["## Custom", ""]);
  });
});

describe("fitSummary", () => {
  test("renders header, blocks and footer when everything fits", () => {
    const markdown = fitSummary(
      {
        header: ["## T", ""],
        blocks: [
          { heading: "### a", diffLines: ["+x"] },
          { diffLines: ["-y"] },
        ],
        footer: "**F**",
      },
      1000
    );

    assert.equal(
      markdown,
      "## T\n\n### a\n\n```diff\n+x\n```\n\n```diff\n-y\n```\n\n**F**"
    );
  });

  test("keeps header and footer and cuts diffs to fit", () => {
    const maxBytes = 20_000;
    const blocks = Array.from({ length: 10 }, (_, i) =>
      repoBlock(`org/repo-${i}`, 400)
    );

    const markdown = fitSummary(
      { header: summaryHeader(true), blocks, footer: "**Plan: 10 files**" },
      maxBytes
    );

    assert.ok(Buffer.byteLength(markdown) <= maxBytes);
    assert.ok(markdown.startsWith("## xfg Plan"));
    assert.ok(markdown.endsWith("**Plan: 10 files**"));
    assert.ok(markdown.includes("### org/repo-0"));
    assert.ok(markdown.includes("... cut to fit GitHub's 1 MiB summary limit"));
    assert.ok(
      markdown.includes("_... 5 more repos not shown. See the job log._")
    );
    assert.ok(!markdown.includes("### org/repo-9"));
    assert.equal((markdown.match(/^```/gm) ?? []).length % 2, 0);
  });

  test("a huge repo does not hide small repos after it", () => {
    const markdown = fitSummary(
      {
        header: summaryHeader(false),
        blocks: [
          repoBlock("org/small-1", 3),
          repoBlock("org/huge", 5000),
          repoBlock("org/small-2", 3),
        ],
        footer: "**F**",
      },
      5000
    );

    assert.ok(Buffer.byteLength(markdown) <= 5000);
    assert.ok(markdown.includes("### org/small-1"));
    assert.ok(markdown.includes("### org/small-2"));
    assert.ok(markdown.includes("### org/huge"));
    assert.ok(markdown.includes("cut to fit"));
    assert.ok(
      markdown.indexOf("### org/huge") < markdown.indexOf("### org/small-2")
    );
  });

  test("keeps the footer when there is almost no room", () => {
    const markdown = fitSummary(
      {
        header: summaryHeader(true),
        blocks: [repoBlock("org/repo", 10)],
        footer: "**F**",
      },
      20
    );

    assert.equal(markdown, "**F**");
  });
});
