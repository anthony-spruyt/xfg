import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  GitHubRulesetStrategy,
  configToGitHub,
  GitHubRuleset,
} from "./github-ruleset-strategy.js";
import type { Ruleset } from "../config.js";
import type { GitHubRepoInfo, AzureDevOpsRepoInfo } from "../repo-detector.js";
import type { ICommandExecutor } from "../command-executor.js";

// Mock executor that records commands and returns configured responses
class MockExecutor implements ICommandExecutor {
  commands: string[] = [];
  responses: Map<string, string> = new Map();
  defaultResponse = "{}";

  async exec(command: string, _cwd: string): Promise<string> {
    this.commands.push(command);

    // Find matching response by endpoint pattern
    for (const [pattern, response] of this.responses) {
      if (command.includes(pattern)) {
        return response;
      }
    }
    return this.defaultResponse;
  }

  setResponse(pattern: string, response: string): void {
    this.responses.set(pattern, response);
  }

  reset(): void {
    this.commands = [];
    this.responses.clear();
  }
}

const mockGitHubRepo: GitHubRepoInfo = {
  type: "github",
  owner: "test-org",
  repo: "test-repo",
  gitUrl: "git@github.com:test-org/test-repo.git",
  host: "github.com",
};

const mockAzureRepo: AzureDevOpsRepoInfo = {
  type: "azure-devops",
  owner: "test-org",
  organization: "test-org",
  project: "test-project",
  repo: "test-repo",
  gitUrl: "git@ssh.dev.azure.com:v3/test-org/test-project/test-repo",
};

describe("GitHubRulesetStrategy", () => {
  let mockExecutor: MockExecutor;
  let strategy: GitHubRulesetStrategy;

  beforeEach(() => {
    mockExecutor = new MockExecutor();
    strategy = new GitHubRulesetStrategy(mockExecutor);
  });

  describe("list", () => {
    test("fetches all rulesets for a repository", async () => {
      const rulesets: GitHubRuleset[] = [
        {
          id: 1,
          name: "pr-rules",
          target: "branch",
          enforcement: "active",
        },
        {
          id: 2,
          name: "release-rules",
          target: "tag",
          enforcement: "disabled",
        },
      ];
      mockExecutor.setResponse("/rulesets", JSON.stringify(rulesets));

      const result = await strategy.list(mockGitHubRepo);

      assert.equal(result.length, 2);
      assert.equal(result[0].name, "pr-rules");
      assert.equal(result[1].name, "release-rules");
      assert.ok(
        mockExecutor.commands[0].includes("/repos/test-org/test-repo/rulesets")
      );
    });

    test("throws error for non-GitHub repos", async () => {
      await assert.rejects(
        () => strategy.list(mockAzureRepo),
        /GitHub Ruleset strategy requires GitHub repositories/
      );
    });

    test("uses token when provided", async () => {
      mockExecutor.setResponse("/rulesets", "[]");

      await strategy.list(mockGitHubRepo, { token: "test-token" });

      assert.ok(mockExecutor.commands[0].includes("GH_TOKEN="));
      assert.ok(mockExecutor.commands[0].includes("test-token"));
    });

    test("uses custom host for GitHub Enterprise", async () => {
      mockExecutor.setResponse("/rulesets", "[]");
      const gheRepo: GitHubRepoInfo = {
        ...mockGitHubRepo,
        host: "github.mycompany.com",
      };

      await strategy.list(gheRepo, { host: "github.mycompany.com" });

      assert.ok(
        mockExecutor.commands[0].includes("--hostname"),
        "Should include --hostname flag"
      );
      assert.ok(
        mockExecutor.commands[0].includes("github.mycompany.com"),
        "Should include the custom host"
      );
    });
  });

  describe("get", () => {
    test("fetches a single ruleset by ID", async () => {
      const ruleset: GitHubRuleset = {
        id: 123,
        name: "pr-rules",
        target: "branch",
        enforcement: "active",
        rules: [{ type: "pull_request" }],
      };
      mockExecutor.setResponse("/rulesets/123", JSON.stringify(ruleset));

      const result = await strategy.get(mockGitHubRepo, 123);

      assert.equal(result.id, 123);
      assert.equal(result.name, "pr-rules");
      assert.ok(
        mockExecutor.commands[0].includes(
          "/repos/test-org/test-repo/rulesets/123"
        )
      );
    });

    test("throws error for non-GitHub repos", async () => {
      await assert.rejects(
        () => strategy.get(mockAzureRepo, 123),
        /GitHub Ruleset strategy requires GitHub repositories/
      );
    });
  });

  describe("create", () => {
    test("creates a new ruleset", async () => {
      const createdRuleset: GitHubRuleset = {
        id: 456,
        name: "new-rules",
        target: "branch",
        enforcement: "active",
      };
      mockExecutor.setResponse("POST", JSON.stringify(createdRuleset));

      const ruleset: Ruleset = {
        target: "branch",
        enforcement: "active",
        rules: [{ type: "pull_request" }],
      };

      const result = await strategy.create(
        mockGitHubRepo,
        "new-rules",
        ruleset
      );

      assert.equal(result.id, 456);
      assert.equal(result.name, "new-rules");
      assert.ok(mockExecutor.commands[0].includes("-X POST"));
      assert.ok(
        mockExecutor.commands[0].includes("/repos/test-org/test-repo/rulesets")
      );
    });

    test("includes payload in request", async () => {
      mockExecutor.setResponse("POST", '{"id": 1, "name": "test"}');

      const ruleset: Ruleset = {
        target: "branch",
        enforcement: "active",
        conditions: {
          refName: {
            include: ["refs/heads/main"],
          },
        },
      };

      await strategy.create(mockGitHubRepo, "test-rules", ruleset);

      const command = mockExecutor.commands[0];
      assert.ok(command.includes("--input -"), "Should use stdin for payload");
      assert.ok(command.includes("echo"), "Should use echo pipe pattern");
    });

    test("throws error for non-GitHub repos", async () => {
      await assert.rejects(
        () => strategy.create(mockAzureRepo, "test", { target: "branch" }),
        /GitHub Ruleset strategy requires GitHub repositories/
      );
    });
  });

  describe("update", () => {
    test("updates an existing ruleset", async () => {
      const updatedRuleset: GitHubRuleset = {
        id: 123,
        name: "updated-rules",
        target: "branch",
        enforcement: "disabled",
      };
      mockExecutor.setResponse("PUT", JSON.stringify(updatedRuleset));

      const ruleset: Ruleset = {
        target: "branch",
        enforcement: "disabled",
      };

      const result = await strategy.update(
        mockGitHubRepo,
        123,
        "updated-rules",
        ruleset
      );

      assert.equal(result.id, 123);
      assert.equal(result.enforcement, "disabled");
      assert.ok(mockExecutor.commands[0].includes("-X PUT"));
      assert.ok(
        mockExecutor.commands[0].includes(
          "/repos/test-org/test-repo/rulesets/123"
        )
      );
    });

    test("throws error for non-GitHub repos", async () => {
      await assert.rejects(
        () => strategy.update(mockAzureRepo, 123, "test", { target: "branch" }),
        /GitHub Ruleset strategy requires GitHub repositories/
      );
    });
  });

  describe("delete", () => {
    test("deletes a ruleset", async () => {
      mockExecutor.setResponse("DELETE", "");

      await strategy.delete(mockGitHubRepo, 123);

      assert.ok(mockExecutor.commands[0].includes("-X DELETE"));
      assert.ok(
        mockExecutor.commands[0].includes(
          "/repos/test-org/test-repo/rulesets/123"
        )
      );
    });

    test("throws error for non-GitHub repos", async () => {
      await assert.rejects(
        () => strategy.delete(mockAzureRepo, 123),
        /GitHub Ruleset strategy requires GitHub repositories/
      );
    });
  });
});

describe("configToGitHub", () => {
  test("converts basic ruleset structure", () => {
    const ruleset: Ruleset = {
      target: "branch",
      enforcement: "active",
    };

    const result = configToGitHub("test-rules", ruleset);

    assert.equal(result.name, "test-rules");
    assert.equal(result.target, "branch");
    assert.equal(result.enforcement, "active");
  });

  test("uses default values when not specified", () => {
    const ruleset: Ruleset = {};

    const result = configToGitHub("test-rules", ruleset);

    assert.equal(result.target, "branch");
    assert.equal(result.enforcement, "active");
  });

  test("converts bypass actors with camelCase to snake_case", () => {
    const ruleset: Ruleset = {
      bypassActors: [
        { actorId: 123, actorType: "Team", bypassMode: "always" },
        { actorId: 456, actorType: "Integration" },
      ],
    };

    const result = configToGitHub("test-rules", ruleset);

    assert.ok(result.bypass_actors);
    assert.equal(result.bypass_actors.length, 2);
    assert.equal(result.bypass_actors[0].actor_id, 123);
    assert.equal(result.bypass_actors[0].actor_type, "Team");
    assert.equal(result.bypass_actors[0].bypass_mode, "always");
    assert.equal(result.bypass_actors[1].actor_id, 456);
    assert.equal(result.bypass_actors[1].bypass_mode, undefined);
  });

  test("converts conditions with camelCase to snake_case", () => {
    const ruleset: Ruleset = {
      conditions: {
        refName: {
          include: ["refs/heads/main", "refs/heads/release/*"],
          exclude: ["refs/heads/dev*"],
        },
      },
    };

    const result = configToGitHub("test-rules", ruleset);

    assert.ok(result.conditions);
    assert.ok(result.conditions.ref_name);
    assert.deepEqual(result.conditions.ref_name.include, [
      "refs/heads/main",
      "refs/heads/release/*",
    ]);
    assert.deepEqual(result.conditions.ref_name.exclude, ["refs/heads/dev*"]);
  });

  test("converts rules array", () => {
    const ruleset: Ruleset = {
      rules: [{ type: "pull_request" }, { type: "required_signatures" }],
    };

    const result = configToGitHub("test-rules", ruleset);

    assert.ok(result.rules);
    assert.equal(result.rules.length, 2);
    assert.equal(result.rules[0].type, "pull_request");
    assert.equal(result.rules[1].type, "required_signatures");
  });

  test("converts pull_request rule parameters", () => {
    const ruleset: Ruleset = {
      rules: [
        {
          type: "pull_request",
          parameters: {
            requiredApprovingReviewCount: 2,
            dismissStaleReviewsOnPush: true,
            requireCodeOwnerReview: true,
            allowedMergeMethods: ["squash", "rebase"],
          },
        },
      ],
    };

    const result = configToGitHub("test-rules", ruleset);

    assert.ok(result.rules);
    const params = result.rules[0].parameters as Record<string, unknown>;
    assert.equal(params.required_approving_review_count, 2);
    assert.equal(params.dismiss_stale_reviews_on_push, true);
    assert.equal(params.require_code_owner_review, true);
    assert.deepEqual(params.allowed_merge_methods, ["squash", "rebase"]);
  });

  test("converts required_status_checks rule parameters", () => {
    const ruleset: Ruleset = {
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            strictRequiredStatusChecksPolicy: true,
            requiredStatusChecks: [
              { context: "ci/build" },
              { context: "ci/test", integrationId: 12345 },
            ],
          },
        },
      ],
    };

    const result = configToGitHub("test-rules", ruleset);

    assert.ok(result.rules);
    const params = result.rules[0].parameters as Record<string, unknown>;
    assert.equal(params.strict_required_status_checks_policy, true);
    assert.ok(Array.isArray(params.required_status_checks));
    const checks = params.required_status_checks as Array<{
      context: string;
      integration_id?: number;
    }>;
    assert.equal(checks[0].context, "ci/build");
    assert.equal(checks[1].context, "ci/test");
    assert.equal(checks[1].integration_id, 12345);
  });

  test("converts code_scanning rule parameters", () => {
    const ruleset: Ruleset = {
      rules: [
        {
          type: "code_scanning",
          parameters: {
            codeScanningTools: [
              {
                tool: "CodeQL",
                alertsThreshold: "errors",
                securityAlertsThreshold: "high_or_higher",
              },
            ],
          },
        },
      ],
    };

    const result = configToGitHub("test-rules", ruleset);

    assert.ok(result.rules);
    const params = result.rules[0].parameters as Record<string, unknown>;
    const tools = params.code_scanning_tools as Array<{
      tool: string;
      alerts_threshold: string;
      security_alerts_threshold: string;
    }>;
    assert.equal(tools[0].tool, "CodeQL");
    assert.equal(tools[0].alerts_threshold, "errors");
    assert.equal(tools[0].security_alerts_threshold, "high_or_higher");
  });

  test("converts pattern rule parameters", () => {
    const ruleset: Ruleset = {
      rules: [
        {
          type: "commit_message_pattern",
          parameters: {
            operator: "regex",
            pattern: "^(feat|fix|docs):",
            negate: false,
          },
        },
      ],
    };

    const result = configToGitHub("test-rules", ruleset);

    assert.ok(result.rules);
    const params = result.rules[0].parameters as Record<string, unknown>;
    assert.equal(params.operator, "regex");
    assert.equal(params.pattern, "^(feat|fix|docs):");
    assert.equal(params.negate, false);
  });
});
