import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { applyGeneratedBlocks } from "../../../scripts/docs/generated-blocks.js";
import {
  createRenderer,
  docFiles,
  repoRoot,
} from "../../../scripts/docs/generate-docs.js";

describe("generated documentation", () => {
  const render = createRenderer();

  for (const file of docFiles()) {
    const name = relative(repoRoot, file);
    test(`${name} is up to date`, () => {
      const content = readFileSync(file, "utf-8");
      assert.equal(
        applyGeneratedBlocks(content, render),
        content,
        `${name} is stale — run \`npm run docs:generate\` from packages/xfg/`
      );
    });
  }
});
