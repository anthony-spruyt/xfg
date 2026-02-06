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

    test("recurses into arrays of objects matching by type", () => {
      const current = {
        rules: [
          {
            type: "pull_request",
            parameters: {
              required_approving_review_count: 1,
            },
          },
          { type: "required_signatures" },
        ],
      };
      const desired = {
        rules: [
          {
            type: "pull_request",
            parameters: {
              required_approving_review_count: 2,
            },
          },
          { type: "required_signatures" },
        ],
      };

      const diffs = computePropertyDiffs(current, desired);

      // Should show a change at the parameter level, not the whole rules array
      assert.equal(diffs.length, 1);
      assert.deepEqual(diffs[0].path, [
        "rules",
        "[0] (pull_request)",
        "parameters",
        "required_approving_review_count",
      ]);
      assert.equal(diffs[0].action, "change");
      assert.equal(diffs[0].oldValue, 1);
      assert.equal(diffs[0].newValue, 2);
    });

    test("detects added array item", () => {
      const current = {
        rules: [{ type: "pull_request" }],
      };
      const desired = {
        rules: [{ type: "pull_request" }, { type: "required_signatures" }],
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.ok(diffs.some((d) => d.action === "add"));
    });

    test("detects removed array item", () => {
      const current = {
        rules: [{ type: "pull_request" }, { type: "required_signatures" }],
      };
      const desired = {
        rules: [{ type: "pull_request" }],
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.ok(diffs.some((d) => d.action === "remove"));
    });

    test("falls back to index matching for arrays without type field", () => {
      const current = {
        bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole" }],
      };
      const desired = {
        bypass_actors: [{ actor_id: 5, actor_type: "Team" }],
      };

      const diffs = computePropertyDiffs(current, desired);

      // Should detect change at actor_type level, not whole array
      assert.ok(
        diffs.some(
          (d) => d.path.includes("actor_type") && d.action === "change"
        )
      );
    });

    test("index fallback detects added and removed items by length", () => {
      const current = {
        bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole" }],
      };
      const desired = {
        bypass_actors: [
          { actor_id: 5, actor_type: "RepositoryRole" },
          { actor_id: 10, actor_type: "Team" },
        ],
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.ok(diffs.some((d) => d.action === "add"));
    });

    test("index fallback detects removed items when current is longer", () => {
      const current = {
        bypass_actors: [
          { actor_id: 5, actor_type: "RepositoryRole" },
          { actor_id: 10, actor_type: "Team" },
        ],
      };
      const desired = {
        bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole" }],
      };

      const diffs = computePropertyDiffs(current, desired);

      assert.ok(diffs.some((d) => d.action === "remove"));
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

  test("formats primitive arrays inline", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["branches"],
        action: "change",
        oldValue: ["main", "develop", "feature", "release", "hotfix"],
        newValue: ["main"],
      },
    ];

    const lines = formatPropertyTree(diffs);

    const output = lines.join("\n");
    // Primitive arrays should render inline
    assert.ok(output.includes("branches"));
    assert.ok(output.includes("main"));
  });

  test("expands object values recursively", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["config"],
        action: "add",
        newValue: { nested: "value", count: 42 },
      },
    ];

    const lines = formatPropertyTree(diffs);

    const output = lines.join("\n");
    // Should NOT collapse to {...}
    assert.ok(!output.includes("{...}"));
    // Should show nested properties
    assert.ok(output.includes("nested"));
    assert.ok(output.includes("value"));
    assert.ok(output.includes("count"));
    assert.ok(output.includes("42"));
  });

  test("expands array of objects recursively", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["rules"],
        action: "add",
        newValue: [
          {
            type: "pull_request",
            parameters: { required_approving_review_count: 1 },
          },
          { type: "required_signatures" },
        ],
      },
    ];

    const lines = formatPropertyTree(diffs);

    const output = lines.join("\n");
    assert.ok(!output.includes("{...}"));
    assert.ok(output.includes("pull_request"));
    assert.ok(output.includes("required_signatures"));
    assert.ok(output.includes("required_approving_review_count"));
  });

  test("expands removed object value recursively", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["config"],
        action: "remove",
        oldValue: { nested: "value", count: 42 },
      },
    ];

    const lines = formatPropertyTree(diffs);

    const output = lines.join("\n");
    assert.ok(!output.includes("{...}"));
    assert.ok(output.includes("nested"));
    assert.ok(output.includes("count"));
  });

  test("expands changed complex values showing old and new", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["config"],
        action: "change",
        oldValue: { nested: "old" },
        newValue: { nested: "new" },
      },
    ];

    const lines = formatPropertyTree(diffs);

    const output = lines.join("\n");
    assert.ok(!output.includes("{...}"));
    assert.ok(output.includes("old"));
    assert.ok(output.includes("new"));
  });

  test("renders nested array with mixed object and primitive items", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["items"],
        action: "add",
        newValue: [{ type: "a" }, "primitive"],
      },
    ];

    const lines = formatPropertyTree(diffs);

    const output = lines.join("\n");
    assert.ok(output.includes("a"));
    assert.ok(output.includes("primitive"));
  });

  test("renders nested object with array-of-objects property", () => {
    const diffs: PropertyDiff[] = [
      {
        path: ["ruleset"],
        action: "add",
        newValue: {
          rules: [{ type: "pull_request", parameters: { count: 1 } }],
        },
      },
    ];

    const lines = formatPropertyTree(diffs);

    const output = lines.join("\n");
    assert.ok(output.includes("rules"));
    assert.ok(output.includes("pull_request"));
    assert.ok(output.includes("count"));
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

  test("formats create with mixed array containing primitives and objects", () => {
    const changes: RulesetChange[] = [
      {
        action: "create",
        name: "test-ruleset",
        desired: {
          target: "branch",
          enforcement: "active",
          rules: [
            { type: "pull_request" },
            "not-an-object" as unknown as Record<string, unknown>,
          ],
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    const output = result.lines.join("\n");
    assert.ok(output.includes("rules"));
  });

  test("formats create with no desired (edge case)", () => {
    const changes: RulesetChange[] = [
      {
        action: "create",
        name: "empty-ruleset",
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.entries[0].propertyCount, 0);
  });

  test("formats update without current and desired", () => {
    const changes: RulesetChange[] = [
      {
        action: "update",
        name: "partial-update",
        rulesetId: 1,
      },
    ];

    const result = formatRulesetPlan(changes);

    assert.equal(result.entries[0].action, "update");
    assert.equal(result.entries[0].propertyChanges, undefined);
  });

  test("filters read-only API metadata fields from update diff", () => {
    const changes: RulesetChange[] = [
      {
        action: "update",
        name: "pr-rules",
        rulesetId: 1,
        current: {
          id: 1,
          name: "pr-rules",
          target: "branch",
          enforcement: "disabled",
          // Read-only API fields that should not appear in diff
          ...({
            node_id: "RRS_lACqUmVwb3NpdG9yec5Di7RzzgC1f1Y",
            _links: { self: { href: "https://api.github.com/..." } },
            created_at: "2026-01-17T05:42:55.087Z",
            updated_at: "2026-01-30T12:34:29.079Z",
            current_user_can_bypass: "always",
          } as Record<string, unknown>),
        },
        desired: {
          target: "branch",
          enforcement: "active",
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    const output = result.lines.join("\n");
    // Should show the real change
    assert.ok(output.includes("enforcement"));
    // Should NOT show read-only fields as removals
    assert.ok(!output.includes("node_id"));
    assert.ok(!output.includes("_links"));
    assert.ok(!output.includes("created_at"));
    assert.ok(!output.includes("updated_at"));
    assert.ok(!output.includes("current_user_can_bypass"));
  });

  test("update with partial config ignores extra API params", () => {
    const changes: RulesetChange[] = [
      {
        action: "update",
        name: "pr-rules",
        rulesetId: 1,
        current: {
          id: 1,
          name: "pr-rules",
          target: "branch",
          enforcement: "active",
          rules: [
            {
              type: "pull_request",
              parameters: {
                required_approving_review_count: 1,
                dismiss_stale_reviews_on_push: false,
                require_last_push_approval: false,
              },
            },
          ],
        },
        desired: {
          target: "branch",
          enforcement: "active",
          rules: [
            {
              type: "pull_request",
              parameters: {
                requiredApprovingReviewCount: 2,
              },
            },
          ],
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    const output = result.lines.join("\n");
    // Should show the real change
    assert.ok(output.includes("required_approving_review_count"));
    // Should NOT show extra API params as removals
    assert.ok(!output.includes("dismiss_stale_reviews_on_push"));
    assert.ok(!output.includes("require_last_push_approval"));
  });

  describe("entries population", () => {
    test("populates entry for create with property count", () => {
      const changes: RulesetChange[] = [
        {
          action: "create",
          name: "new-ruleset",
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

      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].name, "new-ruleset");
      assert.equal(result.entries[0].action, "create");
      assert.equal(result.entries[0].propertyCount, 3);
    });

    test("populates entry for update with diff counts", () => {
      const changes: RulesetChange[] = [
        {
          action: "update",
          name: "my-ruleset",
          rulesetId: 1,
          current: {
            id: 1,
            name: "my-ruleset",
            target: "branch",
            enforcement: "disabled",
            conditions: {
              ref_name: { include: ["main"], exclude: [] },
            },
          },
          desired: {
            target: "branch",
            enforcement: "active",
            bypassActors: [
              { actorId: 1, actorType: "Team", bypassMode: "always" },
            ],
          },
        },
      ];

      const result = formatRulesetPlan(changes);

      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].name, "my-ruleset");
      assert.equal(result.entries[0].action, "update");
      assert.ok(result.entries[0].propertyChanges);
      assert.ok(result.entries[0].propertyChanges!.added >= 0);
      assert.ok(result.entries[0].propertyChanges!.changed >= 0);
      assert.ok(result.entries[0].propertyChanges!.removed >= 0);
      const total =
        result.entries[0].propertyChanges!.added +
        result.entries[0].propertyChanges!.changed +
        result.entries[0].propertyChanges!.removed;
      assert.ok(total > 0);
    });

    test("populates entry for delete without property changes", () => {
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

      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].name, "old-ruleset");
      assert.equal(result.entries[0].action, "delete");
      assert.equal(result.entries[0].propertyChanges, undefined);
      assert.equal(result.entries[0].propertyCount, undefined);
    });

    test("populates entry for unchanged without property changes", () => {
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

      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].name, "stable-ruleset");
      assert.equal(result.entries[0].action, "unchanged");
      assert.equal(result.entries[0].propertyChanges, undefined);
    });

    test("populates entries for mixed actions", () => {
      const changes: RulesetChange[] = [
        {
          action: "create",
          name: "new-one",
          desired: { target: "branch", enforcement: "active" },
        },
        {
          action: "update",
          name: "existing",
          rulesetId: 2,
          current: {
            id: 2,
            name: "existing",
            target: "branch",
            enforcement: "disabled",
          },
          desired: { target: "branch", enforcement: "active" },
        },
        {
          action: "delete",
          name: "old-one",
          rulesetId: 3,
          current: {
            id: 3,
            name: "old-one",
            target: "branch",
            enforcement: "active",
          },
        },
      ];

      const result = formatRulesetPlan(changes);

      assert.equal(result.entries.length, 3);
      assert.equal(result.entries[0].action, "create");
      assert.equal(result.entries[1].action, "update");
      assert.equal(result.entries[2].action, "delete");
    });
  });

  test("regression #361: identical data with different key casing produces no diff", () => {
    const changes: RulesetChange[] = [
      {
        action: "update",
        name: "pr-rules",
        rulesetId: 1,
        current: {
          id: 1,
          name: "pr-rules",
          target: "branch",
          enforcement: "active",
          bypass_actors: [
            {
              actor_id: 5,
              actor_type: "RepositoryRole",
              bypass_mode: "always",
            },
          ],
          conditions: {
            ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
          },
          rules: [
            {
              type: "pull_request",
              parameters: { required_approving_review_count: 1 },
            },
            { type: "required_signatures" },
          ],
        },
        desired: {
          target: "branch",
          enforcement: "active",
          bypassActors: [
            { actorId: 5, actorType: "RepositoryRole", bypassMode: "always" },
          ],
          conditions: {
            refName: { include: ["~DEFAULT_BRANCH"], exclude: [] },
          },
          rules: [
            {
              type: "pull_request",
              parameters: { requiredApprovingReviewCount: 1 },
            },
            { type: "required_signatures" },
          ],
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    // Should have zero property diffs — data is identical after normalization
    assert.ok(result.entries[0].propertyChanges);
    const total =
      result.entries[0].propertyChanges!.added +
      result.entries[0].propertyChanges!.changed +
      result.entries[0].propertyChanges!.removed;
    assert.equal(total, 0, "Should have no property diffs for identical data");
  });

  test("issue #360: create shows expanded rules instead of {...}", () => {
    const changes: RulesetChange[] = [
      {
        action: "create",
        name: "pr-rules",
        desired: {
          target: "branch",
          enforcement: "active",
          rules: [
            {
              type: "pull_request",
              parameters: {
                requiredApprovingReviewCount: 1,
                dismissStaleReviewsOnPush: true,
              },
            },
            { type: "required_signatures" },
          ],
        },
      },
    ];

    const result = formatRulesetPlan(changes);

    const output = result.lines.join("\n");
    // Should NOT contain collapsed objects
    assert.ok(
      !output.includes("{...}"),
      `Output should not contain {…}: ${output}`
    );
    // Should show rule details
    assert.ok(output.includes("pull_request"));
    assert.ok(output.includes("required_signatures"));
    assert.ok(
      output.includes("requiredApprovingReviewCount") ||
        output.includes("required_approving_review_count")
    );
  });
});
