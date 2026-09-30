import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { splitCommitMessage } from "../../../src/vcs/commit-message-parts.js";

describe("splitCommitMessage", () => {
  test("single line has no body", () => {
    assert.deepEqual(splitCommitMessage("fix: x"), { headline: "fix: x" });
  });

  test("splits at the first blank line", () => {
    assert.deepEqual(splitCommitMessage("fix: x\n\nbody 1\n\nbody 2"), {
      headline: "fix: x",
      body: "body 1\n\nbody 2",
    });
  });

  test("headline is only the first line", () => {
    assert.deepEqual(splitCommitMessage("fix: x\nmore\n\nbody"), {
      headline: "fix: x",
      body: "more\n\nbody",
    });
  });

  test("ignores an empty body", () => {
    assert.deepEqual(splitCommitMessage("fix: x\n\n  \n"), {
      headline: "fix: x",
    });
  });
});
