import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { mergeConfigFragments } from "../../src/config/config-merger.js";
import type { RawConfig } from "../../src/config/types.js";

describe("mergeConfigFragments", () => {
  test("concatenates repos from multiple fragments in order", () => {
    const fragments: Array<{ fileName: string; config: Partial<RawConfig> }> = [
      {
        fileName: "a.yaml",
        config: {
          id: "test",
          files: { "test.json": { content: {} } },
          repos: [{ git: "git@github.com:org/repo-a.git" }],
        },
      },
      {
        fileName: "b.yaml",
        config: {
          repos: [{ git: "git@github.com:org/repo-b.git" }],
        },
      },
    ];

    const result = mergeConfigFragments(fragments);

    assert.equal(result.id, "test");
    assert.equal(result.repos.length, 2);
    assert.equal(result.repos[0].git, "git@github.com:org/repo-a.git");
    assert.equal(result.repos[1].git, "git@github.com:org/repo-b.git");
  });
});
