import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  diffRulesets,
  RulesetChange,
  formatDiff,
} from "../../src/ruleset-diff.js";
import type { Ruleset } from "../../src/config.js";
import type { GitHubRuleset } from "../../src/strategies/github-ruleset-strategy.js";

describe("diffRulesets", () => {
  describe("new rulesets", () => {
    test("identifies rulesets in desired but not in current as CREATE", () => {
      const current: GitHubRuleset[] = [];
      const desired = new Map<string, Ruleset>([
        ["main-protection", { target: "branch", enforcement: "active" }],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "create");
      assert.equal(changes[0].name, "main-protection");
      assert.deepEqual(changes[0].desired, {
        target: "branch",
        enforcement: "active",
      });
    });

    test("identifies multiple new rulesets", () => {
      const current: GitHubRuleset[] = [];
      const desired = new Map<string, Ruleset>([
        ["main-protection", { target: "branch", enforcement: "active" }],
        ["tag-protection", { target: "tag", enforcement: "evaluate" }],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes.length, 2);
      const actions = changes.map((c) => c.action);
      assert.deepEqual(actions, ["create", "create"]);
    });
  });

  describe("modified rulesets", () => {
    test("identifies rulesets with different enforcement as UPDATE", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "disabled",
        },
      ];
      const desired = new Map<string, Ruleset>([
        ["main-protection", { target: "branch", enforcement: "active" }],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
      assert.equal(changes[0].name, "main-protection");
      assert.equal(changes[0].rulesetId, 1);
    });

    test("identifies rulesets with different rules as UPDATE", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
          rules: [{ type: "pull_request" }],
        },
      ];
      const desired = new Map<string, Ruleset>([
        [
          "main-protection",
          {
            target: "branch",
            enforcement: "active",
            rules: [{ type: "pull_request" }, { type: "required_signatures" }],
          },
        ],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
    });

    test("identifies rulesets with different conditions as UPDATE", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
          conditions: {
            ref_name: {
              include: ["refs/heads/main"],
            },
          },
        },
      ];
      const desired = new Map<string, Ruleset>([
        [
          "main-protection",
          {
            target: "branch",
            enforcement: "active",
            conditions: {
              refName: {
                include: ["refs/heads/main", "refs/heads/release/*"],
              },
            },
          },
        ],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
    });

    test("identifies rulesets with different bypass_actors as UPDATE", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
          bypass_actors: [{ actor_id: 1, actor_type: "Team" }],
        },
      ];
      const desired = new Map<string, Ruleset>([
        [
          "main-protection",
          {
            target: "branch",
            enforcement: "active",
            bypassActors: [
              { actorId: 1, actorType: "Team" },
              { actorId: 2, actorType: "User" },
            ],
          },
        ],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "update");
    });
  });

  describe("unchanged rulesets", () => {
    test("identifies identical rulesets as NO_CHANGE", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
        },
      ];
      const desired = new Map<string, Ruleset>([
        ["main-protection", { target: "branch", enforcement: "active" }],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "unchanged");
      assert.equal(changes[0].rulesetId, 1);
    });

    test("considers default values when comparing", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
        },
      ];
      // Desired has no explicit target/enforcement - should use defaults
      const desired = new Map<string, Ruleset>([["main-protection", {}]]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      // Default target is "branch", default enforcement is "active"
      assert.equal(changes[0].action, "unchanged");
    });

    test("ignores extra fields from GitHub API response", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
          source_type: "Repository",
          source: "test-org/test-repo",
        },
      ];
      const desired = new Map<string, Ruleset>([
        ["main-protection", { target: "branch", enforcement: "active" }],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes[0].action, "unchanged");
    });
  });

  describe("deleted rulesets", () => {
    test("identifies rulesets in managed but not in desired as DELETE", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "old-ruleset",
          target: "branch",
          enforcement: "active",
        },
      ];
      const desired = new Map<string, Ruleset>();
      const managed = ["old-ruleset"];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].action, "delete");
      assert.equal(changes[0].name, "old-ruleset");
      assert.equal(changes[0].rulesetId, 1);
    });

    test("does not delete rulesets not in managed list", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "external-ruleset",
          target: "branch",
          enforcement: "active",
        },
      ];
      const desired = new Map<string, Ruleset>();
      const managed: string[] = []; // Not managed by xfg

      const changes = diffRulesets(current, desired, managed);

      // Should not suggest deleting unmanaged rulesets
      assert.equal(changes.length, 0);
    });

    test("deletes only managed orphaned rulesets", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "managed-old",
          target: "branch",
          enforcement: "active",
        },
        {
          id: 2,
          name: "external",
          target: "branch",
          enforcement: "active",
        },
      ];
      const desired = new Map<string, Ruleset>();
      const managed = ["managed-old"]; // Only managed-old was managed

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes.length, 1);
      assert.equal(changes[0].name, "managed-old");
      assert.equal(changes[0].action, "delete");
    });
  });

  describe("mixed scenarios", () => {
    test("handles mix of create, update, delete, and unchanged", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "to-update",
          target: "branch",
          enforcement: "disabled",
        },
        {
          id: 2,
          name: "to-delete",
          target: "branch",
          enforcement: "active",
        },
        {
          id: 3,
          name: "unchanged",
          target: "branch",
          enforcement: "active",
        },
      ];
      const desired = new Map<string, Ruleset>([
        ["to-update", { target: "branch", enforcement: "active" }],
        ["unchanged", { target: "branch", enforcement: "active" }],
        ["to-create", { target: "tag", enforcement: "evaluate" }],
      ]);
      const managed = ["to-update", "to-delete", "unchanged"];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes.length, 4);
      const byName = new Map(changes.map((c) => [c.name, c]));

      assert.equal(byName.get("to-update")?.action, "update");
      assert.equal(byName.get("to-delete")?.action, "delete");
      assert.equal(byName.get("unchanged")?.action, "unchanged");
      assert.equal(byName.get("to-create")?.action, "create");
    });

    test("sorts changes: delete, update, create, unchanged", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "to-delete",
          target: "branch",
          enforcement: "active",
        },
        {
          id: 2,
          name: "unchanged",
          target: "branch",
          enforcement: "active",
        },
      ];
      const desired = new Map<string, Ruleset>([
        ["unchanged", { target: "branch", enforcement: "active" }],
        ["to-create", { target: "tag", enforcement: "evaluate" }],
      ]);
      const managed = ["to-delete", "unchanged"];

      const changes = diffRulesets(current, desired, managed);

      const actions = changes.map((c) => c.action);
      // Should be sorted: delete first, then create, then unchanged
      assert.equal(actions[0], "delete");
      assert.equal(actions[1], "create");
      assert.equal(actions[2], "unchanged");
    });
  });

  describe("parameter comparison", () => {
    test("detects changes in pull_request rule parameters", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "pr-rules",
          target: "branch",
          enforcement: "active",
          rules: [
            {
              type: "pull_request",
              parameters: {
                required_approving_review_count: 1,
              },
            },
          ],
        },
      ];
      const desired = new Map<string, Ruleset>([
        [
          "pr-rules",
          {
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
        ],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes[0].action, "update");
    });

    test("detects changes in required_status_checks parameters", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "status-checks",
          target: "branch",
          enforcement: "active",
          rules: [
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: [{ context: "ci/build" }],
              },
            },
          ],
        },
      ];
      const desired = new Map<string, Ruleset>([
        [
          "status-checks",
          {
            target: "branch",
            enforcement: "active",
            rules: [
              {
                type: "required_status_checks",
                parameters: {
                  requiredStatusChecks: [
                    { context: "ci/build" },
                    { context: "ci/test" },
                  ],
                },
              },
            ],
          },
        ],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes[0].action, "update");
    });
  });
});

describe("formatDiff", () => {
  test("formats create action", () => {
    const changes: RulesetChange[] = [
      {
        action: "create",
        name: "main-protection",
        desired: { target: "branch", enforcement: "active" },
      },
    ];

    const output = formatDiff(changes);

    assert.ok(output.includes("CREATE"));
    assert.ok(output.includes("main-protection"));
  });

  test("formats update action", () => {
    const changes: RulesetChange[] = [
      {
        action: "update",
        name: "main-protection",
        rulesetId: 1,
        current: {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "disabled",
        },
        desired: { target: "branch", enforcement: "active" },
      },
    ];

    const output = formatDiff(changes);

    assert.ok(output.includes("UPDATE"));
    assert.ok(output.includes("main-protection"));
  });

  test("formats delete action", () => {
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

    const output = formatDiff(changes);

    assert.ok(output.includes("DELETE"));
    assert.ok(output.includes("old-ruleset"));
  });

  test("formats unchanged action", () => {
    const changes: RulesetChange[] = [
      {
        action: "unchanged",
        name: "main-protection",
        rulesetId: 1,
        current: {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
        },
        desired: { target: "branch", enforcement: "active" },
      },
    ];

    const output = formatDiff(changes);

    assert.ok(output.includes("UNCHANGED"));
    assert.ok(output.includes("main-protection"));
  });

  test("returns empty message when no changes", () => {
    const changes: RulesetChange[] = [];

    const output = formatDiff(changes);

    assert.ok(output.includes("No ruleset changes"));
  });

  test("summarizes change counts", () => {
    const changes: RulesetChange[] = [
      { action: "create", name: "new1", desired: {} },
      { action: "create", name: "new2", desired: {} },
      { action: "update", name: "upd1", rulesetId: 1, desired: {} },
      { action: "delete", name: "del1", rulesetId: 2 },
      { action: "unchanged", name: "unch1", rulesetId: 3, desired: {} },
    ];

    const output = formatDiff(changes);

    assert.ok(output.includes("2 to create"));
    assert.ok(output.includes("1 to update"));
    assert.ok(output.includes("1 to delete"));
    assert.ok(output.includes("1 unchanged"));
  });
});

describe("diffRulesets edge cases", () => {
  test("detects change when comparing null vs undefined in parameters", () => {
    const current: GitHubRuleset[] = [
      {
        id: 1,
        name: "test",
        target: "branch",
        enforcement: "active",
        rules: [
          {
            type: "pull_request",
            parameters: {
              required_approving_review_count: null as unknown as number,
            },
          },
        ],
      },
    ];
    const desired = new Map<string, Ruleset>([
      [
        "test",
        {
          target: "branch",
          enforcement: "active",
          rules: [
            {
              type: "pull_request",
              parameters: {
                requiredApprovingReviewCount: 1,
              },
            },
          ],
        },
      ],
    ]);

    const changes = diffRulesets(current, desired, []);
    assert.equal(changes[0].action, "update");
  });

  test("detects change when parameter types differ", () => {
    const current: GitHubRuleset[] = [
      {
        id: 1,
        name: "test",
        target: "branch",
        enforcement: "active",
        rules: [
          {
            type: "pull_request",
            parameters: {
              required_approving_review_count: "2" as unknown as number,
            },
          },
        ],
      },
    ];
    const desired = new Map<string, Ruleset>([
      [
        "test",
        {
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
      ],
    ]);

    const changes = diffRulesets(current, desired, []);
    assert.equal(changes[0].action, "update");
  });

  test("detects change when object has extra keys", () => {
    const current: GitHubRuleset[] = [
      {
        id: 1,
        name: "test",
        target: "branch",
        enforcement: "active",
        rules: [
          {
            type: "pull_request",
            parameters: {
              required_approving_review_count: 2,
              dismiss_stale_reviews_on_push: true,
            },
          },
        ],
      },
    ];
    const desired = new Map<string, Ruleset>([
      [
        "test",
        {
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
      ],
    ]);

    const changes = diffRulesets(current, desired, []);
    assert.equal(changes[0].action, "update");
  });
});
