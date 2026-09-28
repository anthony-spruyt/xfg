import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { fencedCodeBlock } from "../../../src/shared/markdown-fence.js";

describe("fencedCodeBlock", () => {
  test("uses a three-backtick fence for plain content", () => {
    assert.deepEqual(fencedCodeBlock("diff", ["+a", "-b"]), [
      "```diff",
      "+a",
      "-b",
      "```",
    ]);
  });

  test("uses a fence longer than any backtick run in the content", () => {
    assert.deepEqual(fencedCodeBlock("diff", ["-```", "+```bash"]), [
      "````diff",
      "-```",
      "+```bash",
      "````",
    ]);
  });

  test("handles backtick runs longer than three", () => {
    const block = fencedCodeBlock("diff", [" `````"]);
    assert.equal(block[0], "``````diff");
    assert.equal(block[block.length - 1], "``````");
  });
});
