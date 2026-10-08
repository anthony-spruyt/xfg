import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GitHubEnvironmentsStrategy } from "../../../../src/settings/environments/github-environments-strategy.js";
import type {
  ICommandExecutor,
  ExecOptions,
} from "../../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../../src/repo/index.js";

class MockExecutor implements ICommandExecutor {
  calls: { executable: string; args: string[]; options?: ExecOptions }[] = [];
  response = "";

  async exec(
    executable: string,
    args: string[],
    _cwd: string,
    options?: ExecOptions
  ): Promise<string> {
    this.calls.push({ executable, args, options });
    return this.response;
  }
}

const mockRepo: GitHubRepoInfo = {
  type: "github",
  owner: "test-org",
  repo: "test-repo",
  host: "github.com",
  gitUrl: "https://github.com/test-org/test-repo.git",
};

const adoRepo = {
  type: "azure-devops" as const,
  owner: "org",
  repo: "repo",
  organization: "org",
  project: "proj",
  gitUrl: "https://dev.azure.com/org/proj/_git/repo",
};

function setup(response = "") {
  const executor = new MockExecutor();
  executor.response = response;
  const strategy = new GitHubEnvironmentsStrategy(executor, { cwd: "/tmp" });
  return { executor, strategy };
}

function endpointOf(args: string[]): string | undefined {
  return args.find((a) => a.startsWith("/repos/"));
}

describe("GitHubEnvironmentsStrategy", () => {
  test("list reads environments with their branch policy", async () => {
    const { executor, strategy } = setup(
      JSON.stringify({
        total_count: 1,
        environments: [
          {
            name: "release",
            deployment_branch_policy: {
              protected_branches: false,
              custom_branch_policies: true,
            },
          },
        ],
      })
    );
    const envs = await strategy.list(mockRepo, { token: "t", host: "github.com" });
    assert.deepEqual(envs, [
      {
        name: "release",
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      },
    ]);
    const call = executor.calls[0];
    assert.equal(
      endpointOf(call.args),
      "/repos/test-org/test-repo/environments?per_page=100"
    );
    assert.ok(call.args.includes("--paginate"));
    assert.equal(call.options?.env?.GH_TOKEN, "t");
  });

  test("list returns [] when the response has no environments", async () => {
    const { strategy } = setup(JSON.stringify({ total_count: 0 }));
    assert.deepEqual(await strategy.list(mockRepo), []);
  });

  test("list rejects non-GitHub repos", async () => {
    const { strategy } = setup();
    await assert.rejects(() => strategy.list(adoRepo));
  });

  test("createOrUpdate PUTs the branch policy under an encoded name", async () => {
    const { executor, strategy } = setup("{}");
    await strategy.createOrUpdate(mockRepo, "prod/eu", {
      protected_branches: false,
      custom_branch_policies: true,
    });
    const call = executor.calls[0];
    assert.equal(call.args[1], "-X");
    assert.equal(call.args[2], "PUT");
    assert.equal(
      endpointOf(call.args),
      "/repos/test-org/test-repo/environments/prod%2Feu"
    );
    assert.deepEqual(JSON.parse(call.options?.input ?? "{}"), {
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    });
  });

  test("createOrUpdate sends a null policy to let any branch deploy", async () => {
    const { executor, strategy } = setup("{}");
    await strategy.createOrUpdate(mockRepo, "release", null);
    assert.deepEqual(JSON.parse(executor.calls[0].options?.input ?? "{}"), {
      deployment_branch_policy: null,
    });
  });

  test("listBranchPolicies maps name and type", async () => {
    const { executor, strategy } = setup(
      JSON.stringify({
        total_count: 2,
        branch_policies: [
          { id: 1, name: "main", type: "branch" },
          { id: 2, name: "v*", type: "tag" },
        ],
      })
    );
    const policies = await strategy.listBranchPolicies(mockRepo, "release");
    assert.deepEqual(policies, [
      { type: "branch", name: "main" },
      { type: "tag", name: "v*" },
    ]);
    assert.equal(
      endpointOf(executor.calls[0].args),
      "/repos/test-org/test-repo/environments/release/deployment-branch-policies?per_page=100"
    );
  });

  test("listBranchPolicies treats a missing type as branch", async () => {
    const { strategy } = setup(
      JSON.stringify({ branch_policies: [{ id: 1, name: "main" }] })
    );
    assert.deepEqual(await strategy.listBranchPolicies(mockRepo, "release"), [
      { type: "branch", name: "main" },
    ]);
  });

  test("createBranchPolicy POSTs name and type", async () => {
    const { executor, strategy } = setup("{}");
    await strategy.createBranchPolicy(mockRepo, "release", {
      type: "tag",
      name: "v*.*.*",
    });
    const call = executor.calls[0];
    assert.equal(call.args[2], "POST");
    assert.equal(
      endpointOf(call.args),
      "/repos/test-org/test-repo/environments/release/deployment-branch-policies"
    );
    assert.deepEqual(JSON.parse(call.options?.input ?? "{}"), {
      name: "v*.*.*",
      type: "tag",
    });
  });

  test("listSecrets reads environment secret names", async () => {
    const { executor, strategy } = setup(
      JSON.stringify({
        total_count: 1,
        secrets: [{ name: "KEY", created_at: "x", updated_at: "y" }],
      })
    );
    const secrets = await strategy.listSecrets(mockRepo, "release");
    assert.deepEqual(
      secrets.map((s) => s.name),
      ["KEY"]
    );
    assert.equal(
      endpointOf(executor.calls[0].args),
      "/repos/test-org/test-repo/environments/release/secrets?per_page=100"
    );
  });

  test("getSecretsPublicKey reads the environment's key", async () => {
    const { executor, strategy } = setup(
      JSON.stringify({ key_id: "k1", key: "pub==" })
    );
    const key = await strategy.getSecretsPublicKey(mockRepo, "release");
    assert.deepEqual(key, { key_id: "k1", key: "pub==" });
    assert.equal(
      endpointOf(executor.calls[0].args),
      "/repos/test-org/test-repo/environments/release/secrets/public-key"
    );
  });

  test("upsertSecret PUTs the sealed value and key id", async () => {
    const { executor, strategy } = setup("");
    await strategy.upsertSecret(mockRepo, "release", "KEY", "sealed==", "k1");
    const call = executor.calls[0];
    assert.equal(call.args[2], "PUT");
    assert.equal(
      endpointOf(call.args),
      "/repos/test-org/test-repo/environments/release/secrets/KEY"
    );
    assert.deepEqual(JSON.parse(call.options?.input ?? "{}"), {
      encrypted_value: "sealed==",
      key_id: "k1",
    });
  });
});
