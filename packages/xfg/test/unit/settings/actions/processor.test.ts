import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { ActionsProcessor } from "../../../../src/settings/actions/processor.js";
import type {
  ActionsApiBody,
  ActionsEndpointName,
  IActionsStrategy,
} from "../../../../src/settings/actions/types.js";
import type {
  ActionsSettings,
  RepoConfig,
} from "../../../../src/config/index.js";
import type { GitHubRepoInfo, RepoInfo } from "../../../../src/repo/index.js";

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "https://github.com/test-org/test-repo.git",
  host: "github.com",
  owner: "test-org",
  repo: "test-repo",
};

const adoRepo: RepoInfo = {
  type: "azure-devops",
  gitUrl: "https://dev.azure.com/org/project/_git/repo",
  owner: "org",
  organization: "org",
  project: "project",
  repo: "repo",
};

type Call = { op: "get" | "update"; endpoint: ActionsEndpointName };

class MockStrategy implements IActionsStrategy {
  state: Partial<Record<ActionsEndpointName, ActionsApiBody>> = {
    permissions: {
      enabled: true,
      allowed_actions: "all",
      sha_pinning_required: false,
    },
  };
  calls: Call[] = [];
  payloads: Partial<Record<ActionsEndpointName, ActionsApiBody>> = {};
  failOn?: ActionsEndpointName;

  async get(
    _repo: RepoInfo,
    endpoint: ActionsEndpointName
  ): Promise<ActionsApiBody> {
    this.calls.push({ op: "get", endpoint });
    if (
      endpoint === "selectedActions" &&
      this.state.permissions?.allowed_actions !== "selected"
    ) {
      throw new Error(
        "Conflict: All actions and workflows are allowed (HTTP 409)"
      );
    }
    return this.state[endpoint] ?? {};
  }

  async update(
    _repo: RepoInfo,
    endpoint: ActionsEndpointName,
    payload: ActionsApiBody
  ): Promise<void> {
    this.calls.push({ op: "update", endpoint });
    if (endpoint === this.failOn) throw new Error("Forbidden (HTTP 403)");
    this.payloads[endpoint] = payload;
    this.state[endpoint] = { ...this.state[endpoint], ...payload };
  }

  endpointsOf(op: Call["op"]): ActionsEndpointName[] {
    return this.calls.filter((c) => c.op === op).map((c) => c.endpoint);
  }
}

function makeConfig(actions?: ActionsSettings): RepoConfig {
  return {
    git: githubRepo.gitUrl,
    files: [],
    settings: actions ? { actions } : undefined,
  } as RepoConfig;
}

const SELECTED: ActionsSettings = {
  allowedActions: "selected",
  githubOwnedAllowed: true,
  verifiedAllowed: false,
  patternsAllowed: ["docker/login-action@*"],
};

describe("ActionsProcessor", () => {
  let strategy: MockStrategy;
  let processor: ActionsProcessor;

  beforeEach(() => {
    strategy = new MockStrategy();
    processor = new ActionsProcessor(strategy);
  });

  test("first run on a repo not yet selected never reads selected-actions and plans its fields as creates", async () => {
    const result = await processor.process(makeConfig(SELECTED), githubRepo, {
      dryRun: true,
    });

    assert.ok(result.success);
    assert.deepStrictEqual(strategy.endpointsOf("get"), ["permissions"]);
    const entries = result.planOutput?.entries ?? [];
    const byProperty = Object.fromEntries(entries.map((e) => [e.property, e]));
    assert.equal(byProperty.allowedActions.action, "update");
    assert.equal(byProperty.githubOwnedAllowed.action, "create");
    assert.equal(byProperty.verifiedAllowed.action, "create");
    assert.equal(byProperty.patternsAllowed.action, "create");
  });

  test("reads selected-actions when the current mode is selected", async () => {
    strategy.state = {
      permissions: {
        enabled: true,
        allowed_actions: "selected",
        sha_pinning_required: false,
      },
      selectedActions: {
        github_owned_allowed: true,
        verified_allowed: false,
        patterns_allowed: ["old/x@*"],
      },
    };

    const result = await processor.process(makeConfig(SELECTED), githubRepo, {
      dryRun: true,
    });

    assert.deepStrictEqual(strategy.endpointsOf("get"), [
      "permissions",
      "selectedActions",
    ]);
    const entries = result.planOutput?.entries ?? [];
    assert.deepStrictEqual(
      entries.map((e) => [e.property, e.action]),
      [["patternsAllowed", "update"]]
    );
  });

  test("skips non-GitHub repos", async () => {
    const result = await processor.process(makeConfig(SELECTED), adoRepo, {});
    assert.ok(result.skipped);
    assert.ok(result.message.includes("not a GitHub repository"));
    assert.equal(strategy.calls.length, 0);
  });

  test("skips when no actions settings are configured", async () => {
    const result = await processor.process(makeConfig(), githubRepo, {});
    assert.ok(result.skipped);
    assert.equal(strategy.calls.length, 0);
  });

  test("only calls the endpoints whose fields are configured", async () => {
    strategy.state.workflow = {
      default_workflow_permissions: "write",
      can_approve_pull_request_reviews: false,
    };

    await processor.process(
      makeConfig({ defaultWorkflowPermissions: "read" }),
      githubRepo,
      {}
    );

    assert.deepStrictEqual(strategy.endpointsOf("get"), ["workflow"]);
    assert.deepStrictEqual(strategy.endpointsOf("update"), ["workflow"]);
  });

  test("writes nothing when everything is unchanged", async () => {
    strategy.state = {
      permissions: {
        enabled: true,
        allowed_actions: "selected",
        sha_pinning_required: true,
      },
      selectedActions: {
        github_owned_allowed: true,
        verified_allowed: false,
        patterns_allowed: ["docker/login-action@*"],
      },
    };

    const result = await processor.process(
      makeConfig({ ...SELECTED, shaPinningRequired: true }),
      githubRepo,
      {}
    );

    assert.ok(result.success);
    assert.equal(result.message, "No changes needed");
    assert.deepStrictEqual(strategy.endpointsOf("update"), []);
    assert.equal(result.changes?.unchanged, 5);
  });

  test("an order-only change of patternsAllowed writes nothing", async () => {
    strategy.state = {
      permissions: {
        enabled: true,
        allowed_actions: "selected",
        sha_pinning_required: false,
      },
      selectedActions: { patterns_allowed: ["b/y@*", "a/x@*"] },
    };

    await processor.process(
      makeConfig({
        allowedActions: "selected",
        patternsAllowed: ["a/x@*", "b/y@*"],
      }),
      githubRepo,
      {}
    );

    assert.deepStrictEqual(strategy.endpointsOf("update"), []);
  });

  test("writes only the endpoints that changed", async () => {
    strategy.state = {
      permissions: {
        enabled: true,
        allowed_actions: "selected",
        sha_pinning_required: true,
      },
      selectedActions: {
        github_owned_allowed: true,
        verified_allowed: false,
        patterns_allowed: ["docker/login-action@*"],
      },
      workflow: {
        default_workflow_permissions: "write",
        can_approve_pull_request_reviews: false,
      },
    };

    await processor.process(
      makeConfig({
        ...SELECTED,
        shaPinningRequired: true,
        defaultWorkflowPermissions: "read",
        canApprovePullRequestReviews: false,
      }),
      githubRepo,
      {}
    );

    assert.deepStrictEqual(strategy.endpointsOf("update"), ["workflow"]);
    assert.deepStrictEqual(strategy.payloads.workflow, {
      default_workflow_permissions: "read",
      can_approve_pull_request_reviews: false,
    });
  });

  test("writes permissions before selected-actions on a first run", async () => {
    await processor.process(makeConfig(SELECTED), githubRepo, {});

    assert.deepStrictEqual(strategy.endpointsOf("update"), [
      "permissions",
      "selectedActions",
    ]);
    assert.deepStrictEqual(strategy.payloads.permissions, {
      enabled: true,
      allowed_actions: "selected",
      sha_pinning_required: false,
    });
    assert.deepStrictEqual(strategy.payloads.selectedActions, {
      github_owned_allowed: true,
      verified_allowed: false,
      patterns_allowed: ["docker/login-action@*"],
    });
  });

  test("permissions PUT echoes the current values of fields not configured", async () => {
    strategy.state.permissions = {
      enabled: true,
      allowed_actions: "local_only",
      sha_pinning_required: false,
    };

    await processor.process(
      makeConfig({ shaPinningRequired: true }),
      githubRepo,
      {}
    );

    assert.deepStrictEqual(strategy.payloads.permissions, {
      enabled: true,
      allowed_actions: "local_only",
      sha_pinning_required: true,
    });
  });

  test("dry run reads and plans but writes nothing", async () => {
    const result = await processor.process(makeConfig(SELECTED), githubRepo, {
      dryRun: true,
    });

    assert.ok(result.success);
    assert.ok(result.dryRun);
    assert.ok(result.message.includes("DRY RUN"));
    assert.deepStrictEqual(strategy.endpointsOf("update"), []);
    assert.ok((result.planOutput?.lines.length ?? 0) > 0);
  });

  test("applied result carries the plan", async () => {
    const result = await processor.process(
      makeConfig(SELECTED),
      githubRepo,
      {}
    );
    assert.ok(result.message.startsWith("Applied"));
    assert.equal(result.planOutput?.entries.length, 4);
  });

  test("drops selected-actions fields under allowedActions: all and warns", async () => {
    const result = await processor.process(
      makeConfig({
        allowedActions: "all",
        githubOwnedAllowed: true,
        patternsAllowed: ["a/b@*"],
      }),
      githubRepo,
      {}
    );

    assert.ok(result.success);
    assert.equal(result.message, "No changes needed");
    assert.deepStrictEqual(strategy.endpointsOf("get"), ["permissions"]);
    assert.equal(result.warnings?.length, 1);
    assert.match(result.warnings?.[0] ?? "", /test-org\/test-repo/);
    assert.match(
      result.warnings?.[0] ?? "",
      /githubOwnedAllowed, patternsAllowed/
    );
  });

  test("returns a skipped result with the warning when nothing is left to apply", async () => {
    const result = await processor.process(
      makeConfig({ githubOwnedAllowed: true }),
      githubRepo,
      {}
    );

    assert.ok(result.skipped);
    assert.equal(strategy.calls.length, 0);
    assert.equal(result.warnings?.length, 1);
  });

  test("an API error fails the result with GitHub's message", async () => {
    strategy.failOn = "permissions";

    const result = await processor.process(
      makeConfig(SELECTED),
      githubRepo,
      {}
    );

    assert.equal(result.success, false);
    assert.match(result.message, /Failed: Forbidden \(HTTP 403\)/);
    assert.deepStrictEqual(strategy.endpointsOf("update"), ["permissions"]);
  });

  test("a read error fails the result", async () => {
    strategy.get = async () => {
      throw new Error("Not Found (HTTP 404)");
    };

    const result = await processor.process(
      makeConfig(SELECTED),
      githubRepo,
      {}
    );

    assert.equal(result.success, false);
    assert.match(result.message, /Not Found/);
  });
});
