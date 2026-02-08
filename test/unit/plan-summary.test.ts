import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { formatPlanMarkdown, Plan } from "../../src/plan-summary.js";

describe("plan-summary", () => {
  describe("formatPlanMarkdown", () => {
    test("includes title and plan summary as heading", () => {
      const plan: Plan = {
        resources: [
          { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
        ],
      };

      const markdown = formatPlanMarkdown(plan, {
        title: "Config Sync Summary",
        dryRun: false,
      });

      assert.ok(markdown.includes("## Config Sync Summary"));
      assert.ok(markdown.includes("### Plan: 1 to create"));
    });

    test("includes dry run warning", () => {
      const plan: Plan = {
        resources: [
          { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
        ],
      };

      const markdown = formatPlanMarkdown(plan, {
        title: "Config Sync Summary",
        dryRun: true,
      });

      assert.ok(markdown.includes("(Dry Run)"));
      assert.ok(markdown.includes("[!WARNING]"));
      assert.ok(markdown.includes("no changes were applied"));
    });

    test("includes resource table", () => {
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

      const markdown = formatPlanMarkdown(plan, {
        title: "Summary",
        dryRun: false,
      });

      assert.ok(markdown.includes("| Resource |"));
      assert.ok(markdown.includes("| Action |"));
      assert.ok(markdown.includes('file "org/repo/ci.yml"'));
      assert.ok(markdown.includes("create"));
    });

    test("shows no changes message", () => {
      const plan: Plan = { resources: [] };

      const markdown = formatPlanMarkdown(plan, {
        title: "Summary",
        dryRun: false,
      });

      assert.ok(markdown.includes("No changes"));
    });

    test("includes error section", () => {
      const plan: Plan = {
        resources: [],
        errors: [{ repo: "org/failed-repo", message: "Connection refused" }],
      };

      const markdown = formatPlanMarkdown(plan, {
        title: "Summary",
        dryRun: false,
      });

      assert.ok(markdown.includes("Errors"));
      assert.ok(markdown.includes("org/failed-repo"));
      assert.ok(markdown.includes("Connection refused"));
    });
  });
});
