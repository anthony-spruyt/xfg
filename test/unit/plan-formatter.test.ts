import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  Resource,
  ResourceAction,
  formatResourceId,
  formatResourceLine,
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

  describe("formatResourceLine", () => {
    test("formats create action with + symbol", () => {
      const resource: Resource = {
        type: "file",
        repo: "org/repo",
        name: "ci.yml",
        action: "create",
      };

      const result = formatResourceLine(resource);

      // Result contains ANSI codes, check for content
      assert.ok(result.includes("+"));
      assert.ok(result.includes('file "org/repo/ci.yml"'));
    });

    test("formats update action with ~ symbol", () => {
      const resource: Resource = {
        type: "ruleset",
        repo: "org/repo",
        name: "pr-rules",
        action: "update",
      };

      const result = formatResourceLine(resource);

      assert.ok(result.includes("~"));
      assert.ok(result.includes('ruleset "org/repo/pr-rules"'));
    });

    test("formats delete action with - symbol", () => {
      const resource: Resource = {
        type: "setting",
        repo: "org/repo",
        name: "hasWiki",
        action: "delete",
      };

      const result = formatResourceLine(resource);

      assert.ok(result.includes("-"));
      assert.ok(result.includes('setting "org/repo/hasWiki"'));
    });

    test("formats unchanged action with space", () => {
      const resource: Resource = {
        type: "file",
        repo: "org/repo",
        name: "unchanged.txt",
        action: "unchanged",
      };

      const result = formatResourceLine(resource);

      assert.ok(result.includes('file "org/repo/unchanged.txt"'));
    });
  });
});
