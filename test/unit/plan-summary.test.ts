import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatPlanMarkdown,
  writePlanSummary,
  Plan,
} from "../../src/plan-summary.js";

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

  describe("diff details", () => {
    test("includes collapsible diff for modified resources", () => {
      const plan: Plan = {
        resources: [
          {
            type: "file",
            repo: "org/repo",
            name: "ci.yml",
            action: "update",
            details: {
              diff: ["- version: 1", "+ version: 2"],
            },
          },
        ],
      };

      const markdown = formatPlanMarkdown(plan, {
        title: "Summary",
        dryRun: false,
      });

      assert.ok(markdown.includes("<details>"));
      assert.ok(markdown.includes("Diff:"));
      assert.ok(markdown.includes("```diff"));
      assert.ok(markdown.includes("- version: 1"));
      assert.ok(markdown.includes("+ version: 2"));
    });

    test("omits diff section for resources without details", () => {
      const plan: Plan = {
        resources: [
          { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
        ],
      };

      const markdown = formatPlanMarkdown(plan, {
        title: "Summary",
        dryRun: false,
      });

      assert.ok(!markdown.includes("```diff"));
    });
  });

  describe("writePlanSummary", () => {
    let tempFile: string;
    let originalEnv: string | undefined;

    beforeEach(() => {
      tempFile = join(tmpdir(), `plan-summary-test-${Date.now()}.md`);
      originalEnv = process.env.GITHUB_STEP_SUMMARY;
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY;
      } else {
        process.env.GITHUB_STEP_SUMMARY = originalEnv;
      }
      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
      }
    });

    test("writes markdown to GITHUB_STEP_SUMMARY path", () => {
      process.env.GITHUB_STEP_SUMMARY = tempFile;
      const plan: Plan = {
        resources: [
          { type: "file", repo: "org/repo", name: "ci.yml", action: "create" },
        ],
      };

      writePlanSummary(plan, { title: "Test Summary", dryRun: false });

      assert.ok(existsSync(tempFile));
      const content = readFileSync(tempFile, "utf-8");
      assert.ok(content.includes("## Test Summary"));
    });

    test("no-ops when env var not set", () => {
      delete process.env.GITHUB_STEP_SUMMARY;
      const plan: Plan = { resources: [] };

      // Should not throw
      writePlanSummary(plan, { title: "Test", dryRun: false });

      assert.ok(!existsSync(tempFile));
    });
  });
});
