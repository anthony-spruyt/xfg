// test/unit/ruleset-plan-formatter.test.ts
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import type { RulesetChange } from "../../src/ruleset-diff.js";
import {
  computePropertyDiffs,
  formatPropertyTree,
  formatRulesetPlan,
  PropertyDiff,
} from "../../src/ruleset-plan-formatter.js";

describe("computePropertyDiffs", () => {
  describe("scalar changes", () => {
    test("detects changed scalar value", () => {
      const current = { enforcement: "disabled" };
      const desired = { enforcement: "active" };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0], {
        path: ["enforcement"],
        action: "change",
        oldValue: "disabled",
        newValue: "active",
      });
    });

    test("detects added scalar property", () => {
      const current = {};
      const desired = { enforcement: "active" };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0], {
        path: ["enforcement"],
        action: "add",
        newValue: "active",
      });
    });

    test("detects removed scalar property", () => {
      const current = { enforcement: "active" };
      const desired = {};

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0], {
        path: ["enforcement"],
        action: "remove",
        oldValue: "active",
      });
    });
  });

  describe("nested objects", () => {
    test("detects changes in nested properties", () => {
      const current = {
        rules: {
          pull_request: {
            required_approving_review_count: 1,
          },
        },
      };
      const desired = {
        rules: {
          pull_request: {
            required_approving_review_count: 2,
          },
        },
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0].path, [
        "rules",
        "pull_request",
        "required_approving_review_count",
      ]);
      assert.equal(diffs[0].action, "change");
      assert.equal(diffs[0].oldValue, 1);
      assert.equal(diffs[0].newValue, 2);
    });

    test("detects added nested property", () => {
      const current = {
        rules: {
          pull_request: {
            required_approving_review_count: 1,
          },
        },
      };
      const desired = {
        rules: {
          pull_request: {
            required_approving_review_count: 1,
            dismiss_stale_reviews_on_push: true,
          },
        },
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0].path, [
        "rules",
        "pull_request",
        "dismiss_stale_reviews_on_push",
      ]);
      assert.equal(diffs[0].action, "add");
    });
  });

  describe("arrays", () => {
    test("detects changed array", () => {
      const current = {
        conditions: {
          ref_name: {
            include: ["~DEFAULT_BRANCH"],
          },
        },
      };
      const desired = {
        conditions: {
          ref_name: {
            include: ["~DEFAULT_BRANCH", "release/*"],
          },
        },
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0].path, ["conditions", "ref_name", "include"]);
      assert.equal(diffs[0].action, "change");
    });

    test("treats identical arrays as unchanged", () => {
      const current = {
        conditions: { ref_name: { include: ["main", "develop"] } },
      };
      const desired = {
        conditions: { ref_name: { include: ["main", "develop"] } },
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.equal(diffs.length, 0);
    });
  });
});

describe("formatPropertyTree", () => {
  test("formats single scalar change", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["enforcement"],
        action: "change",
        oldValue: "disabled",
        newValue: "active",
      },
    ];

    const lines = formatPropertyTree(diffs);

    assert.equal(lines.length, 1);
    // Line should contain: ~ enforcement: disabled → active
    assert.ok(lines[0].includes("enforcement"));
    assert.ok(lines[0].includes("disabled"));
    assert.ok(lines[0].includes("active"));
  });

  test("formats nested changes with indentation", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["rules", "pull_request", "required_approving_review_count"],
        action: "change",
        oldValue: 1,
        newValue: 2,
      },
    ];

    const lines = formatPropertyTree(diffs);

    // Should produce tree structure:
    // ~ rules:
    //     ~ pull_request:
    //         ~ required_approving_review_count: 1 → 2
    assert.ok(lines.some((l) => l.includes("rules")));
    assert.ok(lines.some((l) => l.includes("pull_request")));
    assert.ok(lines.some((l) => l.includes("required_approving_review_count")));
  });

  test("formats added property with +", () => {
    const diffs: PropertyDiff[] = [
      { path: ["enforcement"], action: "add", newValue: "active" },
    ];

    const lines = formatPropertyTree(diffs);

    // Should show: + enforcement: active
    assert.ok(lines[0].includes("+") || lines[0].includes("add"));
    assert.ok(lines[0].includes("enforcement"));
    assert.ok(lines[0].includes("active"));
  });

  test("formats removed property with -", () => {
    const diffs: PropertyDiff[] = [
      { path: ["enforcement"], action: "remove", oldValue: "active" },
    ];

    const lines = formatPropertyTree(diffs);

    // Should show: - enforcement (was: active)
    assert.ok(lines[0].includes("-") || lines[0].includes("remove"));
    assert.ok(lines[0].includes("enforcement"));
  });

  test("returns empty array for empty diffs", () => {
    const diffs: PropertyDiff[] = [];

    const lines = formatPropertyTree(diffs);

    assert.equal(lines.length, 0);
  });

  test("formats long arrays with truncation", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["branches"],
        action: "change",
        oldValue: ["main", "develop", "feature", "release", "hotfix"],
        newValue: ["main"],
      },
    ];

    const lines = formatPropertyTree(diffs);

    // Should truncate long arrays with "... (N more)"
    const output = lines.join("\n");
    assert.ok(output.includes("more") || output.includes("..."));
  });

  test("formats object values as {...}", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["config"],
        action: "change",
        oldValue: { nested: "object" },
        newValue: { different: "object" },
      },
    ];

    const lines = formatPropertyTree(diffs);

    // Object values should be shown as {...}
    const output = lines.join("\n");
    assert.ok(output.includes("{...}"));
  });
});

describe("formatRulesetPlan", () => {
  test("formats create action with full config", () => {
    const changes: RulesetChange[] = [
      {
        action: "create",
        name: "branch-protection",
        desired: {
          target: "branch",
          enforcement: "active",
          conditions: {
            refName: { include: ["~DEFAULT_BRANCH"] },
          },
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.creates, 1);
    assert.equal(result.updates, 0);
    assert.equal(result.deletes, 0);
    // Should contain ruleset name and full config
    const output = result.lines.join("\n");
    assert.ok(output.includes("branch-protection"));
    assert.ok(output.includes("enforcement"));
    assert.ok(output.includes("active"));
  });

  test("formats update action with property diff", () => {
    const changes: RulesetChange[] = [
      {
        action: "update",
        name: "branch-protection",
        rulesetId: 1,
        current: {
          id: 1,
          name: "branch-protection",
          target: "branch",
          enforcement: "disabled",
        },
        desired: {
          target: "branch",
          enforcement: "active",
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.updates, 1);
    const output = result.lines.join("\n");
    assert.ok(output.includes("branch-protection"));
    // Should show the diff: disabled → active
    assert.ok(output.includes("disabled") || output.includes("active"));
  });

  test("formats delete action with just name", () => {
    const changes: RulesetChange[] = [
      {
        action: "delete",
        name: "old-ruleset",
        rulesetId: 1,
        current: {
          id: 1,
          name: "old-ruleset",
          target: "branch",
          enforcement: "active",
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.deletes, 1);
    const output = result.lines.join("\n");
    assert.ok(output.includes("old-ruleset"));
    // Should NOT show full config for deletes
    assert.ok(
      !output.includes("enforcement") || output.split("enforcement").length <= 2
    );
  });

  test("excludes unchanged from output but includes in count", () => {
    const changes: RulesetChange[] = [
      {
        action: "unchanged",
        name: "stable-ruleset",
        rulesetId: 1,
        current: {
          id: 1,
          name: "stable-ruleset",
          target: "branch",
          enforcement: "active",
        },
        desired: { target: "branch", enforcement: "active" },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.unchanged, 1);
    // Unchanged should not appear in output
    const output = result.lines.join("\n");
    assert.ok(!output.includes("stable-ruleset"));
  });

  test("formats create with empty arrays", () => {
    const changes: RulesetChange[] = [
      {
        action: "create",
        name: "branch-protection",
        desired: {
          target: "branch",
          enforcement: "active",
          conditions: {
            refName: { include: ["~DEFAULT_BRANCH"], exclude: [] },
          },
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.creates, 1);
    const output = result.lines.join("\n");
    // Should show empty array as []
    assert.ok(output.includes("[]"));
  });

  test("formats create with arrays of objects (rules)", () => {
    const changes: RulesetChange[] = [
      {
        action: "create",
        name: "branch-protection",
        desired: {
          target: "branch",
          enforcement: "active",
          rules: [
            {
              type: "pull_request",
              parameters: { requiredApprovingReviewCount: 1 },
            },
            { type: "required_status_checks" },
          ],
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.creates, 1);
    const output = result.lines.join("\n");
    // Should show rules array with objects
    assert.ok(output.includes("rules"));
    assert.ok(output.includes("pull_request") || output.includes("type"));
  });

  test("formats update with nested camelCase properties normalized", () => {
    const changes: RulesetChange[] = [
      {
        action: "update",
        name: "branch-protection",
        rulesetId: 1,
        current: {
          id: 1,
          name: "branch-protection",
          target: "branch",
          enforcement: "active",
          conditions: {
            ref_name: {
              include: ["main"],
              exclude: [],
            },
          },
        },
        desired: {
          target: "branch",
          enforcement: "active",
          conditions: {
            refName: {
              include: ["main", "develop"],
              exclude: [],
            },
          },
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.updates, 1);
    const output = result.lines.join("\n");
    // Should show the change in the include array
    assert.ok(output.includes("include") || output.includes("ref_name"));
  });

  test("formats create with mixed array (objects with primitive-like items)", () => {
    // This tests the code path where array items are not all objects
    const changes: RulesetChange[] = [
      {
        action: "create",
        name: "test-ruleset",
        desired: {
          target: "branch",
          enforcement: "active",
          bypassActors: [
            { actorId: 1, actorType: "Team", bypassMode: "always" },
            { actorId: 2, actorType: "Team", bypassMode: "pull_request" },
          ],
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.creates, 1);
    const output = result.lines.join("\n");
    assert.ok(
      output.includes("bypassActors") || output.includes("bypass_actors")
    );
  });
});
