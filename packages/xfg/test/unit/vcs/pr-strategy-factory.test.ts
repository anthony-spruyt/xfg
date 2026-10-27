import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { createPRStrategy } from "../../../src/vcs/pr-strategy-factory.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";

const mockExecutor: ICommandExecutor = { exec: async () => "" };

describe("createPRStrategy", () => {
  test("throws for unknown repository type", () => {
    const unknownRepo = {
      type: "bitbucket",
      gitUrl: "git@bitbucket.org:test/repo.git",
    } as never;

    assert.throws(
      () => createPRStrategy(unknownRepo, mockExecutor),
      /Unknown repository type/
    );
  });
});
