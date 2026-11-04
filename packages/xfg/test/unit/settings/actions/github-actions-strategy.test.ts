import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubActionsStrategy } from "../../../../src/settings/actions/github-actions-strategy.js";
import { ACTIONS_ENDPOINTS } from "../../../../src/settings/actions/endpoints.js";
import type {
  ICommandExecutor,
  ExecOptions,
} from "../../../../src/shared/command-executor.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../../../src/repo/index.js";

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "https://github.com/test-org/test-repo.git",
  host: "github.com",
  owner: "test-org",
  repo: "test-repo",
};

interface CallRecord {
  executable: string;
  args: string[];
  options?: ExecOptions;
}

class MockExecutor implements ICommandExecutor {
  calls: CallRecord[] = [];
  result = "";

  async exec(
    executable: string,
    args: string[],
    _cwd: string,
    options?: ExecOptions
  ): Promise<string> {
    this.calls.push({ executable, args, options });
    return this.result;
  }
}

describe("GitHubActionsStrategy", () => {
  let executor: MockExecutor;
  let strategy: GitHubActionsStrategy;

  beforeEach(() => {
    executor = new MockExecutor();
    strategy = new GitHubActionsStrategy(executor, { cwd: "/tmp" });
  });

  test("get reads the endpoint and parses the body", async () => {
    executor.result = JSON.stringify({
      enabled: true,
      allowed_actions: "selected",
    });

    const body = await strategy.get(githubRepo, "permissions");

    assert.deepStrictEqual(body, {
      enabled: true,
      allowed_actions: "selected",
    });
    assert.equal(executor.calls[0].executable, "gh");
    assert.ok(!executor.calls[0].args.includes("-X"));
    assert.ok(
      executor.calls[0].args.includes(
        "/repos/test-org/test-repo/actions/permissions"
      )
    );
  });

  test("update PUTs the payload as JSON on stdin", async () => {
    await strategy.update(githubRepo, "selectedActions", {
      patterns_allowed: ["a/b@*"],
    });

    const [call] = executor.calls;
    assert.deepStrictEqual(
      call.args.slice(call.args.indexOf("-X"), call.args.indexOf("-X") + 2),
      ["-X", "PUT"]
    );
    assert.ok(
      call.args.includes(
        "/repos/test-org/test-repo/actions/permissions/selected-actions"
      )
    );
    assert.deepStrictEqual(JSON.parse(call.options?.input ?? ""), {
      patterns_allowed: ["a/b@*"],
    });
  });

  test("each endpoint has its own path", async () => {
    executor.result = "{}";
    for (const endpoint of ACTIONS_ENDPOINTS) {
      await strategy.get(githubRepo, endpoint.name);
    }
    const paths = executor.calls.map((c) => c.args[c.args.length - 1]);
    assert.deepStrictEqual(
      paths,
      ACTIONS_ENDPOINTS.map(
        (e) => `/repos/test-org/test-repo/actions/${e.path}`
      )
    );
  });

  test("passes the token as GH_TOKEN and the GHE host", async () => {
    executor.result = "{}";
    const ghe: GitHubRepoInfo = { ...githubRepo, host: "ghe.example.com" };

    await strategy.get(ghe, "workflow", { token: "tok", host: ghe.host });

    assert.equal(executor.calls[0].options?.env?.GH_TOKEN, "tok");
    assert.ok(executor.calls[0].args.includes("--hostname"));
  });

  test("rejects a non-GitHub repo", async () => {
    const ado: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      gitUrl: "https://dev.azure.com/o/p/_git/r",
      owner: "o",
      organization: "o",
      project: "p",
      repo: "r",
    };
    await assert.rejects(() => strategy.get(ado, "permissions"), /GitHub/);
    await assert.rejects(
      () => strategy.update(ado, "permissions", { enabled: true }),
      /GitHub/
    );
  });

  test("surfaces the API error", async () => {
    executor.exec = async () => {
      throw new Error("gh: Conflict (HTTP 409)");
    };
    strategy = new GitHubActionsStrategy(executor, { cwd: "/tmp", retries: 0 });
    await assert.rejects(
      () => strategy.update(githubRepo, "permissions", { enabled: true }),
      /Conflict/
    );
  });
});
