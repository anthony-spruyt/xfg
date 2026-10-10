import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EnvironmentsProcessor } from "../../../../src/settings/environments/processor.js";
import type {
  ExistingBranchPattern,
  GitHubDeploymentBranchPolicy,
  GitHubEnvironment,
  IEnvironmentsStrategy,
} from "../../../../src/settings/environments/types.js";
import type {
  DeploymentBranchPattern,
  EnvironmentConfig,
  EnvironmentsConfig,
  RepoConfig,
  RepoVisibility,
} from "../../../../src/config/index.js";
import type {
  GitHubRepoInfo,
  IRepoMetadataProvider,
  RepoInfo,
} from "../../../../src/repo/index.js";

class MockStrategy implements IEnvironmentsStrategy {
  calls: { method: string; args: unknown[] }[] = [];
  environments: GitHubEnvironment[] = [];
  patterns = new Map<string, (DeploymentBranchPattern & { id?: number })[]>();
  failOn?: string;
  failWith = "HTTP 404: Not Found";
  failListFor?: string;

  async list(): Promise<GitHubEnvironment[]> {
    return this.environments;
  }
  async createOrUpdate(
    _r: RepoInfo,
    name: string,
    policy: GitHubDeploymentBranchPolicy | null
  ): Promise<void> {
    if (this.failOn === "createOrUpdate") throw new Error(this.failWith);
    this.calls.push({ method: "createOrUpdate", args: [name, policy] });
  }
  async delete(_r: RepoInfo, name: string): Promise<void> {
    if (this.failOn === "delete") throw new Error(this.failWith);
    this.calls.push({ method: "delete", args: [name] });
  }
  async listBranchPolicies(
    _r: RepoInfo,
    env: string
  ): Promise<ExistingBranchPattern[]> {
    this.calls.push({ method: "listBranchPolicies", args: [env] });
    if (this.failListFor === env) throw new Error(this.failWith);
    return (this.patterns.get(env) ?? []).map((p, i) => ({
      ...p,
      id: p.id ?? i + 1,
    }));
  }
  async createBranchPolicy(
    _r: RepoInfo,
    env: string,
    pattern: DeploymentBranchPattern
  ): Promise<void> {
    if (this.failOn === "createBranchPolicy") throw new Error(this.failWith);
    this.calls.push({ method: "createBranchPolicy", args: [env, pattern] });
  }
  async deleteBranchPolicy(
    _r: RepoInfo,
    env: string,
    id: number
  ): Promise<void> {
    if (this.failOn === "deleteBranchPolicy") throw new Error(this.failWith);
    this.calls.push({ method: "deleteBranchPolicy", args: [env, id] });
  }
}

function metadata(
  visibility: RepoVisibility = "public"
): IRepoMetadataProvider & { called: number } {
  return {
    called: 0,
    async getMetadata() {
      this.called++;
      return { visibility, ownerType: "User", hasGHAS: false };
    },
  };
}

const repo: GitHubRepoInfo = {
  type: "github",
  owner: "me",
  repo: "r",
  host: "github.com",
  gitUrl: "https://github.com/me/r.git",
};

function config(environments?: Record<string, EnvironmentConfig>): RepoConfig {
  return {
    git: repo.gitUrl,
    files: [],
    settings: environments ? { environments } : {},
  };
}

function pruning(environments: Record<string, EnvironmentConfig>): RepoConfig {
  return config({ ...environments, deleteOrphaned: true } as EnvironmentsConfig);
}

const custom = { protected_branches: false, custom_branch_policies: true };
const billingError =
  "gh: Failed to create the environment protection rule. Please ensure the billing plan supports the required reviewers protection rule. (HTTP 422)";
const upgradeError =
  "gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)";
const main: DeploymentBranchPattern = { type: "branch", name: "main" };

describe("EnvironmentsProcessor", () => {
  test("skips non-GitHub repos", async () => {
    const processor = new EnvironmentsProcessor(new MockStrategy(), metadata());
    const result = await processor.process(
      config({ release: {} }),
      {
        type: "azure-devops",
        owner: "o",
        repo: "r",
        organization: "o",
        project: "p",
        gitUrl: "https://dev.azure.com/o/p/_git/r",
      },
      {}
    );
    assert.equal(result.skipped, true);
  });

  test("skips when no environments are configured", async () => {
    const processor = new EnvironmentsProcessor(new MockStrategy(), metadata());
    const result = await processor.process(config(), repo, {});
    assert.equal(result.skipped, true);
    assert.equal(result.message, "No environments configured");
  });

  test("creates an environment and its custom patterns", async () => {
    const strategy = new MockStrategy();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(
      config({ release: { deploymentBranchPolicy: { custom: [main] } } }),
      repo,
      {}
    );
    assert.equal(result.success, true);
    assert.deepEqual(strategy.calls, [
      { method: "createOrUpdate", args: ["release", custom] },
      { method: "createBranchPolicy", args: ["release", main] },
    ]);
    assert.equal(result.changes?.create, 1);
    assert.match(result.message, /Applied: 1 created/);
  });

  test("creates an environment that any branch can deploy from", async () => {
    const strategy = new MockStrategy();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    await processor.process(config({ preview: {} }), repo, {});
    assert.deepEqual(strategy.calls, [
      { method: "createOrUpdate", args: ["preview", null] },
    ]);
  });

  test("dry run plans without writing", async () => {
    const strategy = new MockStrategy();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(config({ release: {} }), repo, {
      dryRun: true,
    });
    assert.equal(result.dryRun, true);
    assert.deepEqual(strategy.calls, []);
    assert.equal(result.planOutput?.entries.length, 1);
  });

  test("leaves a matching environment alone", async () => {
    const strategy = new MockStrategy();
    strategy.environments = [{ name: "release", deployment_branch_policy: custom }];
    strategy.patterns.set("release", [main]);
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(
      config({ release: { deploymentBranchPolicy: { custom: [main] } } }),
      repo,
      {}
    );
    assert.deepEqual(strategy.calls, [
      { method: "listBranchPolicies", args: ["release"] },
    ]);
    assert.equal(result.message, "No changes needed");
  });

  test("warns about patterns not in config and leaves them in place", async () => {
    const strategy = new MockStrategy();
    strategy.environments = [{ name: "release", deployment_branch_policy: custom }];
    strategy.patterns.set("release", [main, { type: "tag", name: "v*" }]);
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(
      config({ release: { deploymentBranchPolicy: { custom: [main] } } }),
      repo,
      { dryRun: true }
    );
    assert.deepEqual(result.warnings, [
      'me/r: environment "release" has tag "v*" not in config - left in place',
    ]);
  });

  test("re-reads patterns after switching an environment to custom", async () => {
    const strategy = new MockStrategy();
    strategy.environments = [{ name: "release", deployment_branch_policy: null }];
    strategy.patterns.set("release", [main]);
    const processor = new EnvironmentsProcessor(strategy, metadata());
    await processor.process(
      config({
        release: {
          deploymentBranchPolicy: { custom: [main, { type: "tag", name: "v*" }] },
        },
      }),
      repo,
      {}
    );
    assert.deepEqual(strategy.calls, [
      { method: "createOrUpdate", args: ["release", custom] },
      { method: "listBranchPolicies", args: ["release"] },
      {
        method: "createBranchPolicy",
        args: ["release", { type: "tag", name: "v*" }],
      },
    ]);
  });

  test("diffs each environment against its own existing patterns", async () => {
    const strategy = new MockStrategy();
    strategy.environments = [
      { name: "alpha", deployment_branch_policy: custom },
      { name: "beta", deployment_branch_policy: custom },
      { name: "gamma", deployment_branch_policy: custom },
    ];
    const tag: DeploymentBranchPattern = { type: "tag", name: "v*" };
    const releases: DeploymentBranchPattern = {
      type: "branch",
      name: "release/*",
    };
    const hotfixes: DeploymentBranchPattern = {
      type: "branch",
      name: "hotfix/*",
    };
    const dev: DeploymentBranchPattern = { type: "branch", name: "dev" };
    strategy.patterns.set("alpha", [main]);
    strategy.patterns.set("beta", [releases, hotfixes]);
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(
      config({
        alpha: { deploymentBranchPolicy: { custom: [main, tag] } },
        beta: { deploymentBranchPolicy: { custom: [releases] } },
        gamma: { deploymentBranchPolicy: { custom: [dev] } },
      }),
      repo,
      {}
    );
    assert.equal(result.success, true, result.message);
    assert.deepEqual(strategy.calls, [
      { method: "listBranchPolicies", args: ["alpha"] },
      { method: "listBranchPolicies", args: ["beta"] },
      { method: "listBranchPolicies", args: ["gamma"] },
      { method: "createBranchPolicy", args: ["alpha", tag] },
      { method: "createBranchPolicy", args: ["gamma", dev] },
    ]);
    assert.deepEqual(result.warnings, [
      'me/r: environment "beta" has branch "hotfix/*" not in config - left in place',
    ]);
  });

  test("stops reading patterns and writes nothing when a read fails", async () => {
    const strategy = new MockStrategy();
    strategy.environments = [
      { name: "alpha", deployment_branch_policy: custom },
      { name: "beta", deployment_branch_policy: custom },
    ];
    strategy.failListFor = "alpha";
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(
      config({
        alpha: { deploymentBranchPolicy: { custom: [main] } },
        beta: { deploymentBranchPolicy: { custom: [main] } },
      }),
      repo,
      {}
    );
    assert.equal(result.success, false);
    assert.match(result.message, /HTTP 404/);
    assert.deepEqual(strategy.calls, [
      { method: "listBranchPolicies", args: ["alpha"] },
    ]);
  });

  test("skips a private repo with a warning when GitHub reports a billing plan limit", async () => {
    const strategy = new MockStrategy();
    strategy.failOn = "createOrUpdate";
    strategy.failWith = billingError;
    const meta = metadata("private");
    const processor = new EnvironmentsProcessor(strategy, meta);
    const result = await processor.process(config({ release: {} }), repo, {});
    assert.equal(result.success, true);
    assert.equal(result.skipped, true);
    assert.equal(meta.called, 1);
    assert.deepEqual(result.warnings, [
      `me/r: environments on private repos need a paid GitHub plan (Pro, Team or Enterprise) - skipped (${billingError})`,
    ]);
  });

  test("skips a private repo when the first pattern write needs an upgrade", async () => {
    const strategy = new MockStrategy();
    strategy.environments = [{ name: "release", deployment_branch_policy: custom }];
    strategy.failOn = "createBranchPolicy";
    strategy.failWith = upgradeError;
    const processor = new EnvironmentsProcessor(strategy, metadata("private"));
    const result = await processor.process(
      config({ release: { deploymentBranchPolicy: { custom: [main] } } }),
      repo,
      {}
    );
    assert.equal(result.success, true);
    assert.equal(result.skipped, true);
  });

  test("surfaces other errors on a private repo instead of skipping", async () => {
    const strategy = new MockStrategy();
    strategy.failOn = "createOrUpdate";
    const meta = metadata("private");
    const processor = new EnvironmentsProcessor(strategy, meta);
    const result = await processor.process(config({ release: {} }), repo, {});
    assert.equal(result.success, false);
    assert.match(result.message, /HTTP 404/);
    assert.equal(meta.called, 0);
  });

  test("surfaces a 422 that is not a billing plan limit", async () => {
    const strategy = new MockStrategy();
    strategy.failOn = "createOrUpdate";
    strategy.failWith = "gh: Validation Failed (HTTP 422) [name: is invalid]";
    const processor = new EnvironmentsProcessor(strategy, metadata("private"));
    const result = await processor.process(config({ release: {} }), repo, {});
    assert.equal(result.success, false);
    assert.match(result.message, /Validation Failed/);
  });

  test("fails on a public repo when a write fails", async () => {
    const strategy = new MockStrategy();
    strategy.failOn = "createOrUpdate";
    strategy.failWith = billingError;
    const processor = new EnvironmentsProcessor(strategy, metadata("public"));
    const result = await processor.process(config({ release: {} }), repo, {});
    assert.equal(result.success, false);
    assert.match(result.message, /billing plan/);
  });

  test("fails without the plan check once something was written", async () => {
    const strategy = new MockStrategy();
    strategy.failOn = "createBranchPolicy";
    strategy.failWith = upgradeError;
    const meta = metadata("private");
    const processor = new EnvironmentsProcessor(strategy, meta);
    const result = await processor.process(
      config({ release: { deploymentBranchPolicy: { custom: [main] } } }),
      repo,
      {}
    );
    assert.equal(result.success, false);
    assert.equal(meta.called, 0);
  });
});

describe("EnvironmentsProcessor deleteOrphaned", () => {
  const tag: DeploymentBranchPattern = { type: "tag", name: "v*" };
  const pruneRelease = {
    release: {
      deploymentBranchPolicy: { deleteOrphaned: true, custom: [main, tag] },
    },
  };

  function withNpm(): MockStrategy {
    const strategy = new MockStrategy();
    strategy.environments = [
      { name: "release", deployment_branch_policy: null },
      { name: "npm", deployment_branch_policy: null },
    ];
    return strategy;
  }

  function withStaleTag(): MockStrategy {
    const strategy = new MockStrategy();
    strategy.environments = [{ name: "release", deployment_branch_policy: custom }];
    strategy.patterns.set("release", [
      { id: 1, ...main },
      { id: 7, type: "tag", name: "v*.*.*" },
    ]);
    return strategy;
  }

  test("keeps environments not in config by default", async () => {
    const strategy = withNpm();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(config({ release: {} }), repo, {});
    assert.deepEqual(strategy.calls, []);
    assert.equal(result.message, "No changes needed");
  });

  test("deletes environments not in config", async () => {
    const strategy = withNpm();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(pruning({ release: {} }), repo, {});
    assert.equal(result.success, true, result.message);
    assert.deepEqual(strategy.calls, [{ method: "delete", args: ["npm"] }]);
    assert.equal(result.changes?.delete, 1);
    assert.match(result.message, /Applied: 1 deleted/);
    assert.deepEqual(
      result.planOutput?.lines.map((l) =>
        l.replace(new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*m", "g"), "")
      ),
      ['    - environment "npm"', "  Applied: 1 environment (1 deleted)"]
    );
  });

  test("dry run plans the deletion without deleting", async () => {
    const strategy = withNpm();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(pruning({ release: {} }), repo, {
      dryRun: true,
    });
    assert.deepEqual(strategy.calls, []);
    assert.equal(result.changes?.delete, 1);
    assert.deepEqual(result.planOutput?.entries, [
      { name: "npm", action: "delete" },
    ]);
  });

  test("noDelete keeps environments not in config", async () => {
    const strategy = withNpm();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(pruning({ release: {} }), repo, {
      noDelete: true,
    });
    assert.deepEqual(strategy.calls, []);
    assert.equal(result.changes?.delete, 0);
  });

  test("deleteOrphaned with no environments deletes every environment", async () => {
    const strategy = withNpm();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(pruning({}), repo, {});
    assert.equal(result.skipped, undefined);
    assert.deepEqual(strategy.calls, [
      { method: "delete", args: ["release"] },
      { method: "delete", args: ["npm"] },
    ]);
  });

  test("creates and updates before deleting", async () => {
    const strategy = withNpm();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    await processor.process(
      pruning({ release: { deploymentBranchPolicy: { protectedBranches: true } } }),
      repo,
      {}
    );
    assert.deepEqual(
      strategy.calls.map((c) => c.method),
      ["createOrUpdate", "delete"]
    );
  });

  test("deletes patterns not in config by id, after adding missing ones", async () => {
    const strategy = withStaleTag();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(config(pruneRelease), repo, {});
    assert.equal(result.success, true, result.message);
    assert.deepEqual(strategy.calls, [
      { method: "listBranchPolicies", args: ["release"] },
      { method: "createBranchPolicy", args: ["release", tag] },
      { method: "deleteBranchPolicy", args: ["release", 7] },
    ]);
    assert.equal(result.warnings, undefined);
  });

  test("dry run plans pattern deletions without deleting", async () => {
    const strategy = withStaleTag();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(config(pruneRelease), repo, {
      dryRun: true,
    });
    assert.ok(!strategy.calls.some((c) => c.method === "deleteBranchPolicy"));
    assert.deepEqual(result.planOutput?.entries, [
      {
        name: "release",
        action: "update",
        desiredKind: "custom",
        addedPatterns: [tag],
        removedPatterns: [{ type: "tag", name: "v*.*.*" }],
      },
    ]);
  });

  test("noDelete keeps patterns and warns as before", async () => {
    const strategy = withStaleTag();
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(config(pruneRelease), repo, {
      noDelete: true,
    });
    assert.ok(!strategy.calls.some((c) => c.method === "deleteBranchPolicy"));
    assert.deepEqual(result.warnings, [
      'me/r: environment "release" has tag "v*.*.*" not in config - left in place',
    ]);
  });

  test("deletes no patterns it could not plan after switching to custom", async () => {
    const strategy = new MockStrategy();
    strategy.environments = [{ name: "release", deployment_branch_policy: null }];
    strategy.patterns.set("release", [{ id: 7, type: "tag", name: "v*.*.*" }]);
    const processor = new EnvironmentsProcessor(strategy, metadata());
    await processor.process(config(pruneRelease), repo, {});
    assert.ok(!strategy.calls.some((c) => c.method === "deleteBranchPolicy"));
  });

  test("fails naming the Administration permission when an environment delete gets 403", async () => {
    const strategy = withNpm();
    strategy.failOn = "delete";
    strategy.failWith = "gh: Resource not accessible by integration (HTTP 403)";
    const processor = new EnvironmentsProcessor(strategy, metadata("private"));
    const result = await processor.process(pruning({ release: {} }), repo, {});
    assert.equal(result.success, false);
    assert.equal(result.skipped, undefined);
    assert.match(
      result.message,
      /deleting environment "npm" needs the Administration: Read and write permission/
    );
    assert.match(result.message, /HTTP 403/);
  });

  test("fails naming the Administration permission when a pattern delete gets 403", async () => {
    const strategy = withStaleTag();
    strategy.failOn = "deleteBranchPolicy";
    strategy.failWith = "gh: Resource not accessible by integration (HTTP 403)";
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(
      config({
        release: {
          deploymentBranchPolicy: { deleteOrphaned: true, custom: [main] },
        },
      }),
      repo,
      {}
    );
    assert.equal(result.success, false);
    assert.match(
      result.message,
      /deleting tag "v\*\.\*\.\*" from environment "release" needs the Administration: Read and write permission/
    );
  });

  test("surfaces other delete errors unchanged", async () => {
    const strategy = withNpm();
    strategy.failOn = "delete";
    const processor = new EnvironmentsProcessor(strategy, metadata());
    const result = await processor.process(pruning({ release: {} }), repo, {});
    assert.equal(result.success, false);
    assert.equal(result.message, "Failed: HTTP 404: Not Found");
  });
});
