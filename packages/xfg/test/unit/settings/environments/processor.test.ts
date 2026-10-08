import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EnvironmentsProcessor } from "../../../../src/settings/environments/processor.js";
import type {
  GitHubDeploymentBranchPolicy,
  GitHubEnvironment,
  IEnvironmentsStrategy,
} from "../../../../src/settings/environments/types.js";
import type {
  DeploymentBranchPattern,
  EnvironmentConfig,
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
  patterns = new Map<string, DeploymentBranchPattern[]>();
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
  async listBranchPolicies(
    _r: RepoInfo,
    env: string
  ): Promise<DeploymentBranchPattern[]> {
    this.calls.push({ method: "listBranchPolicies", args: [env] });
    if (this.failListFor === env) throw new Error(this.failWith);
    return this.patterns.get(env) ?? [];
  }
  async createBranchPolicy(
    _r: RepoInfo,
    env: string,
    pattern: DeploymentBranchPattern
  ): Promise<void> {
    if (this.failOn === "createBranchPolicy") throw new Error(this.failWith);
    this.calls.push({ method: "createBranchPolicy", args: [env, pattern] });
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
