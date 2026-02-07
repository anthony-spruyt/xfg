import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  diffRulesets,
  RulesetChange,
  formatDiff,
  projectToDesiredShape,
  normalizeRuleset,
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

    test("ignores read-only API metadata fields (node_id, _links, created_at, updated_at, current_user_can_bypass)", () => {
      const current: GitHubRuleset[] = [
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          enforcement: "active",
          source_type: "Repository",
          source: "test-org/test-repo",
          // These are read-only API fields not in GitHubRuleset interface
          // but present in real API responses via JSON.parse
          ...({
            node_id: "RRS_lACqUmVwb3NpdG9yec5Di7RzzgC1f1Y",
            _links: { self: { href: "https://api.github.com/..." } },
            created_at: "2026-01-17T05:42:55.087Z",
            updated_at: "2026-01-30T12:34:29.079Z",
            current_user_can_bypass: "always",
          } as unknown as Partial<GitHubRuleset>),
        },
      ];
      const desired = new Map<string, Ruleset>([
        ["main-protection", { target: "branch", enforcement: "active" }],
      ]);
      const managed: string[] = [];

      const changes = diffRulesets(current, desired, managed);

      assert.equal(changes[0].action, "unchanged");
    });

    test("treats partial config as unchanged when API has extra nested params", () => {
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
                dismiss_stale_reviews_on_push: false,
                require_code_owner_review: false,
                require_last_push_approval: false,
                required_review_thread_resolution: false,
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
                  requiredApprovingReviewCount: 1,
                },
              },
            ],
          },
        ],
      ]);

      const changes = diffRulesets(current, desired, []);

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

describe("diffRulesets bypass_actors null vs empty array", () => {
  test("treats API bypass_actors: null as equivalent to config bypassActors: []", () => {
    const current: GitHubRuleset[] = [
      {
        id: 1,
        name: "push-protection",
        target: "branch",
        enforcement: "active",
        bypass_actors: null as unknown as GitHubRuleset["bypass_actors"],
        conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
        rules: [{ type: "non_fast_forward" }, { type: "creation" }],
      },
    ];
    const desired = new Map<string, Ruleset>([
      [
        "push-protection",
        {
          target: "branch",
          enforcement: "active",
          bypassActors: [],
          conditions: {
            refName: { include: ["refs/heads/main"], exclude: [] },
          },
          rules: [{ type: "non_fast_forward" }, { type: "creation" }],
        },
      ],
    ]);

    const changes = diffRulesets(current, desired, []);

    assert.equal(changes[0].action, "unchanged");
  });

  test("treats API bypass_actors: null as equivalent to config with bypass actor", () => {
    const current: GitHubRuleset[] = [
      {
        id: 1,
        name: "pr-rules",
        target: "branch",
        enforcement: "active",
        bypass_actors: null as unknown as GitHubRuleset["bypass_actors"],
        rules: [{ type: "pull_request" }],
      },
    ];
    const desired = new Map<string, Ruleset>([
      [
        "pr-rules",
        {
          target: "branch",
          enforcement: "active",
          bypassActors: [
            { actorId: 123, actorType: "Integration", bypassMode: "always" },
          ],
          rules: [{ type: "pull_request" }],
        },
      ],
    ]);

    const changes = diffRulesets(current, desired, []);

    // This IS a real change - null (no actors) vs actual actors
    assert.equal(changes[0].action, "update");
  });

  test("treats API bypass_actors: [] as equivalent to config bypassActors: []", () => {
    const current: GitHubRuleset[] = [
      {
        id: 1,
        name: "tag-rules",
        target: "tag",
        enforcement: "active",
        bypass_actors: [],
        conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } },
        rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
      },
    ];
    const desired = new Map<string, Ruleset>([
      [
        "tag-rules",
        {
          target: "tag",
          enforcement: "active",
          bypassActors: [],
          conditions: { refName: { include: ["refs/tags/v*"], exclude: [] } },
          rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
        },
      ],
    ]);

    const changes = diffRulesets(current, desired, []);

    assert.equal(changes[0].action, "unchanged");
  });

  test("no-op for real-world xfg rulesets (API null bypass_actors)", () => {
    // Simulates the exact CI failure: API returns full ruleset details
    // but bypass_actors is null (GitHub App token behavior)
    const current: GitHubRuleset[] = [
      {
        id: 11894614,
        name: "pr-rules",
        target: "branch",
        enforcement: "active",
        bypass_actors: [
          {
            actor_id: 2719952,
            actor_type: "Integration",
            bypass_mode: "always",
          },
        ],
        rules: [
          {
            type: "pull_request",
            parameters: { required_approving_review_count: 0 },
          },
        ],
        conditions: {
          ref_name: { include: ["refs/heads/main"], exclude: [] },
        },
      },
      {
        id: 11894616,
        name: "push-protection",
        target: "branch",
        enforcement: "active",
        bypass_actors: null as unknown as GitHubRuleset["bypass_actors"],
        rules: [{ type: "non_fast_forward" }, { type: "creation" }],
        conditions: {
          ref_name: { include: ["refs/heads/main"], exclude: [] },
        },
      },
      {
        id: 12105737,
        name: "tag-rules",
        target: "tag",
        enforcement: "active",
        bypass_actors: null as unknown as GitHubRuleset["bypass_actors"],
        rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
        conditions: {
          ref_name: { include: ["refs/tags/v*"], exclude: [] },
        },
      },
    ];

    const desired = new Map<string, Ruleset>([
      [
        "pr-rules",
        {
          target: "branch",
          enforcement: "active",
          bypassActors: [
            {
              actorId: 2719952,
              actorType: "Integration",
              bypassMode: "always",
            },
          ],
          rules: [
            {
              type: "pull_request",
              parameters: { requiredApprovingReviewCount: 0 },
            },
          ],
          conditions: {
            refName: { include: ["refs/heads/main"], exclude: [] },
          },
        },
      ],
      [
        "push-protection",
        {
          target: "branch",
          enforcement: "active",
          bypassActors: [],
          rules: [{ type: "non_fast_forward" }, { type: "creation" }],
          conditions: {
            refName: { include: ["refs/heads/main"], exclude: [] },
          },
        },
      ],
      [
        "tag-rules",
        {
          target: "tag",
          enforcement: "active",
          bypassActors: [],
          rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
          conditions: {
            refName: { include: ["refs/tags/v*"], exclude: [] },
          },
        },
      ],
    ]);

    const changes = diffRulesets(current, desired, []);

    const byName = new Map(changes.map((c) => [c.name, c]));
    assert.equal(byName.get("pr-rules")?.action, "unchanged");
    assert.equal(byName.get("push-protection")?.action, "unchanged");
    assert.equal(byName.get("tag-rules")?.action, "unchanged");
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

  test("ignores extra API params when config does not declare them", () => {
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
    assert.equal(changes[0].action, "unchanged");
  });
});

describe("normalizeRuleset", () => {
  test("skips properties with undefined values", () => {
    const ruleset = {
      target: "branch",
      enforcement: "active",
      bypass_actors: undefined,
    } as unknown as GitHubRuleset;

    const result = normalizeRuleset(ruleset);

    assert.equal("bypass_actors" in result, false);
    assert.deepEqual(result, {
      target: "branch",
      enforcement: "active",
    });
  });

  test("skips properties with null values (API returns null for empty arrays)", () => {
    const ruleset = {
      target: "branch",
      enforcement: "active",
      bypass_actors: null,
    } as unknown as GitHubRuleset;

    const result = normalizeRuleset(ruleset);

    // null should be excluded entirely - no phantom key with undefined value
    assert.equal("bypass_actors" in result, false);
    assert.deepEqual(result, {
      target: "branch",
      enforcement: "active",
    });
  });

  test("converts camelCase keys to snake_case", () => {
    const ruleset = {
      target: "branch",
      enforcement: "active",
      bypassActors: [{ actorId: 1, actorType: "Team", bypassMode: "always" }],
    } as unknown as Ruleset;

    const result = normalizeRuleset(ruleset);

    assert.ok("bypass_actors" in result);
    assert.equal("bypassActors" in result, false);
  });

  test("filters to comparable fields only", () => {
    const ruleset = {
      id: 1,
      name: "test",
      target: "branch",
      enforcement: "active",
      source_type: "Repository",
      node_id: "RRS_xxx",
    } as unknown as GitHubRuleset;

    const result = normalizeRuleset(ruleset);

    assert.ok("target" in result);
    assert.ok("enforcement" in result);
    assert.equal("id" in result, false);
    assert.equal("name" in result, false);
    assert.equal("source_type" in result, false);
    assert.equal("node_id" in result, false);
  });
});

describe("projectToDesiredShape", () => {
  test("keeps only keys present in desired for objects", () => {
    const current = {
      target: "branch",
      enforcement: "active",
      extra_api_field: "noise",
    };
    const desired = {
      target: "branch",
      enforcement: "active",
    };

    const result = projectToDesiredShape(current, desired);

    assert.deepEqual(result, {
      target: "branch",
      enforcement: "active",
    });
  });

  test("recurses into nested objects", () => {
    const current = {
      conditions: {
        ref_name: {
          include: ["main"],
          exclude: [],
          extra_nested: true,
        },
      },
    };
    const desired = {
      conditions: {
        ref_name: {
          include: ["main"],
          exclude: [],
        },
      },
    };

    const result = projectToDesiredShape(current, desired);

    assert.deepEqual(result, {
      conditions: {
        ref_name: {
          include: ["main"],
          exclude: [],
        },
      },
    });
  });

  test("matches array items by type field and projects each pair", () => {
    const current = {
      rules: [
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 1,
            require_last_push_approval: false,
            required_review_thread_resolution: false,
          },
        },
        {
          type: "required_signatures",
        },
      ],
    };
    const desired = {
      rules: [
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 1,
          },
        },
        {
          type: "required_signatures",
        },
      ],
    };

    const result = projectToDesiredShape(current, desired);

    assert.deepEqual(result, {
      rules: [
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 1,
          },
        },
        {
          type: "required_signatures",
        },
      ],
    });
  });

  test("falls back to index matching when no type field", () => {
    const current = {
      bypass_actors: [
        {
          actor_id: 5,
          actor_type: "RepositoryRole",
          bypass_mode: "always",
          extra: true,
        },
        { actor_id: 10, actor_type: "Team", bypass_mode: "pull_request" },
      ],
    };
    const desired = {
      bypass_actors: [
        { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
        { actor_id: 10, actor_type: "Team", bypass_mode: "pull_request" },
      ],
    };

    const result = projectToDesiredShape(current, desired);

    assert.deepEqual(result, {
      bypass_actors: [
        { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
        { actor_id: 10, actor_type: "Team", bypass_mode: "pull_request" },
      ],
    });
  });

  test("returns current as-is for scalar values", () => {
    const result = projectToDesiredShape("active", "active");

    assert.equal(result, "active");
  });

  test("returns current as-is for primitive arrays", () => {
    const result = projectToDesiredShape(
      ["main", "develop"],
      ["main", "develop"]
    );

    assert.deepEqual(result, ["main", "develop"]);
  });

  test("handles desired items not in current (additions)", () => {
    const current = {
      rules: [
        {
          type: "pull_request",
          parameters: { required_approving_review_count: 1 },
        },
      ],
    };
    const desired = {
      rules: [
        {
          type: "pull_request",
          parameters: { required_approving_review_count: 1 },
        },
        { type: "required_signatures" },
      ],
    };

    const result = projectToDesiredShape(current, desired);

    // Current only has pull_request, required_signatures has no match
    // so current side should only contain the matched pull_request
    assert.equal((result as Record<string, unknown[]>).rules.length, 1);
  });

  test("handles empty desired", () => {
    const current = { target: "branch", enforcement: "active" };
    const desired = {};

    const result = projectToDesiredShape(current, desired);

    assert.deepEqual(result, {});
  });
});
