import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  Resource,
  ResourceAction,
  formatResourceId,
  formatResourceLine,
  formatPlanSummary,
  formatPlan,
  PlanCounts,
  Plan,
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

  describe("formatPlanSummary", () => {
    test("formats counts with all action types", () => {
      const counts: PlanCounts = {
        create: 2,
        update: 3,
        delete: 1,
      };

      const result = formatPlanSummary(counts);

      assert.ok(result.includes("Plan:"));
      assert.ok(result.includes("2 to create"));
      assert.ok(result.includes("3 to change"));
      assert.ok(result.includes("1 to destroy"));
    });

    test("omits zero counts", () => {
      const counts: PlanCounts = {
        create: 1,
        update: 0,
        delete: 0,
      };

      const result = formatPlanSummary(counts);

      assert.ok(result.includes("1 to create"));
      assert.ok(!result.includes("to change"));
      assert.ok(!result.includes("to destroy"));
    });

    test("returns no changes message when all zero", () => {
      const counts: PlanCounts = {
        create: 0,
        update: 0,
        delete: 0,
      };

      const result = formatPlanSummary(counts);

      assert.ok(result.includes("No changes"));
    });
  });

  describe("formatPlan", () => {
    test("formats multiple resources with summary", () => {
      const plan: Plan = {
        resources: [
          { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
          {
            type: "ruleset",
            repo: "org/repo",
            name: "pr-rules",
            action: "update",
          },
        ],
      };

      const lines = formatPlan(plan);

      // Should have resource lines
      assert.ok(lines.some((l) => l.includes('file "org/repo/ci.yml"')));
      assert.ok(lines.some((l) => l.includes('ruleset "org/repo/pr-rules"')));
      // Should have summary line
      assert.ok(lines.some((l) => l.includes("Plan:")));
    });

    test("shows no changes message for empty plan", () => {
      const plan: Plan = { resources: [] };

      const lines = formatPlan(plan);

      assert.ok(lines.some((l) => l.includes("No changes")));
    });

    test("excludes unchanged resources from output", () => {
      const plan: Plan = {
        resources: [
          {
            type: "file",
            repo: "org/repo",
            name: "ci.yml",
            action: "unchanged",
          },
        ],
      };

      const lines = formatPlan(plan);

      assert.ok(lines.some((l) => l.includes("No changes")));
    });

    test("includes error information", () => {
      const plan: Plan = {
        resources: [],
        errors: [{ repo: "org/failed-repo", message: "Connection refused" }],
      };

      const lines = formatPlan(plan);

      assert.ok(lines.some((l) => l.includes("org/failed-repo")));
      assert.ok(lines.some((l) => l.includes("Connection refused")));
    });

    test("includes diff details when present", () => {
      const plan: Plan = {
        resources: [
          {
            type: "file",
            repo: "org/repo",
            name: "ci.yml",
            action: "update",
            details: {
              diff: ["- old line", "+ new line"],
            },
          },
        ],
      };

      const lines = formatPlan(plan);

      assert.ok(lines.some((l) => l.includes("- old line")));
      assert.ok(lines.some((l) => l.includes("+ new line")));
    });
  });
});
