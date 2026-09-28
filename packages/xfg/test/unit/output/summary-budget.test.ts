import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  fitSummary,
  summaryHeader,
} from "../../../src/output/summary-budget.js";

function repoBlock(name: string, lineCount: number) {
  return {
    heading: `### ${name}`,
    repos: [name],
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
          { heading: "### a", diffLines: ["+x"], repos: ["a"] },
          { diffLines: ["-y"], repos: ["b"] },
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
      markdown.includes(
        "_5 more repos not shown, see the job log:_ `org/repo-5`, `org/repo-6`"
      )
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

  test("renders whole at the exact byte length and cuts one byte below", () => {
    const parts = {
      header: summaryHeader(true),
      blocks: [repoBlock("org/a", 3), { diffLines: ["+ ```"], repos: ["b"] }],
      footer: "**F**",
    };
    const whole = fitSummary(parts, 1_000_000);
    const length = Buffer.byteLength(whole);

    assert.equal(fitSummary(parts, length), whole);
    assert.notEqual(fitSummary(parts, length - 1), whole);
  });

  test("counts every repo in a block when it is hidden", () => {
    const markdown = fitSummary(
      {
        header: [],
        blocks: [
          {
            diffLines: Array.from({ length: 30 }, (_, i) => `+ CREATE ${i}`),
            repos: Array.from({ length: 10 }, (_, i) => `r${i}`),
          },
        ],
        footer: "**F**",
      },
      100
    );

    assert.ok(
      markdown.startsWith("_10 more repos not shown, see the job log:_ `r0`")
    );
    assert.ok(markdown.includes(", …\n\n**F**"));
    assert.ok(Buffer.byteLength(markdown) <= 100);
  });

  test("cuts a line that alone is too long instead of hiding the repo", () => {
    const markdown = fitSummary(
      {
        header: [],
        blocks: [
          {
            heading: "### org/a",
            diffLines: ["+" + "x".repeat(5000)],
            repos: ["org/a"],
          },
        ],
        footer: "**F**",
      },
      1000
    );

    assert.ok(Buffer.byteLength(markdown) <= 1000);
    assert.ok(markdown.includes("### org/a"));
    assert.ok(markdown.includes("+xxx"));
    assert.ok(markdown.includes("cut to fit"));
  });

  test("never splits a multi-byte character when cutting a line", () => {
    const markdown = fitSummary(
      {
        header: [],
        blocks: [{ diffLines: ["+" + "é".repeat(3000)], repos: ["org/a"] }],
        footer: "**F**",
      },
      1001
    );

    assert.ok(Buffer.byteLength(markdown) <= 1001);
    assert.ok(!markdown.includes("\uFFFD"));
  });
});
