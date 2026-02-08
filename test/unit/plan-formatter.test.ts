import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  Resource,
  ResourceAction,
  formatResourceId,
} from "../../src/plan-formatter.js";

describe("plan-formatter", () => {
  describe("formatResourceId", () => {
    test("formats file resource", () => {
      const resource: Resource = {
        type: "file",
        repo: "org/repo",
        name: ".github/workflows/ci.yml",
        action: "create",
      };

      const result = formatResourceId(resource);

      assert.equal(result, 'file "org/repo/.github/workflows/ci.yml"');
    });

    test("formats ruleset resource", () => {
      const resource: Resource = {
        type: "ruleset",
        repo: "org/repo",
        name: "pr-rules",
        action: "update",
      };

      const result = formatResourceId(resource);

      assert.equal(result, 'ruleset "org/repo/pr-rules"');
    });

    test("formats setting resource", () => {
      const resource: Resource = {
        type: "setting",
        repo: "org/repo",
        name: "description",
        action: "update",
      };

      const result = formatResourceId(resource);

      assert.equal(result, 'setting "org/repo/description"');
    });
  });
});
