import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GitHubCollaboratorsStrategy } from "../../../../src/settings/collaborators/github-collaborators-strategy.js";
import type {
  ICommandExecutor,
  ExecOptions,
} from "../../../../src/shared/command-executor.js";
import type {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../../../src/repo/index.js";

class MockExecutor implements ICommandExecutor {
  calls: { args: string[]; options?: ExecOptions }[] = [];
  response = "";

  async exec(
    _executable: string,
    args: string[],
    _cwd: string,
    options?: ExecOptions
  ): Promise<string> {
    this.calls.push({ args, options });
    return this.response;
  }
}

const repo: GitHubRepoInfo = {
  type: "github",
  owner: "me",
  repo: "r",
  host: "github.com",
  gitUrl: "https://github.com/me/r.git",
};

function make(executor: MockExecutor) {
  return new GitHubCollaboratorsStrategy(executor, { cwd: "/tmp", retries: 0 });
}

describe("GitHubCollaboratorsStrategy", () => {
  test("listCollaborators paginates direct collaborators", async () => {
    const executor = new MockExecutor();
    executor.response = JSON.stringify([{ login: "bot" }]);

    const result = await make(executor).listCollaborators(repo);

    assert.deepEqual(result, [{ login: "bot" }]);
    const args = executor.calls[0].args;
    assert.ok(args.includes("--paginate"));
    assert.ok(args.includes("/repos/me/r/collaborators?affiliation=direct"));
  });

  test("listInvitations paginates invitations", async () => {
    const executor = new MockExecutor();
    executor.response = JSON.stringify([{ id: 1, invitee: { login: "bot" } }]);

    const result = await make(executor).listInvitations(repo);

    assert.deepEqual(result, [{ id: 1, invitee: { login: "bot" } }]);
    assert.ok(executor.calls[0].args.includes("/repos/me/r/invitations"));
  });

  test("add sends PUT to the collaborator endpoint", async () => {
    const executor = new MockExecutor();
    await make(executor).add(repo, "bot");
    const args = executor.calls[0].args;
    assert.deepEqual(args.slice(1, 3), ["-X", "PUT"]);
    assert.ok(args.includes("/repos/me/r/collaborators/bot"));
  });

  test("remove sends DELETE to the collaborator endpoint", async () => {
    const executor = new MockExecutor();
    await make(executor).remove(repo, "bot");
    const args = executor.calls[0].args;
    assert.deepEqual(args.slice(1, 3), ["-X", "DELETE"]);
    assert.ok(args.includes("/repos/me/r/collaborators/bot"));
  });

  test("cancelInvitation sends DELETE to the invitation endpoint", async () => {
    const executor = new MockExecutor();
    await make(executor).cancelInvitation(repo, 42);
    const args = executor.calls[0].args;
    assert.deepEqual(args.slice(1, 3), ["-X", "DELETE"]);
    assert.ok(args.includes("/repos/me/r/invitations/42"));
  });

  test("passes token via env", async () => {
    const executor = new MockExecutor();
    executor.response = "[]";
    await make(executor).listCollaborators(repo, { token: "t" });
    assert.equal(executor.calls[0].options?.env?.GH_TOKEN, "t");
  });

  test("uses the default retry count when none is given", async () => {
    const executor = new MockExecutor();
    executor.response = "[]";
    const strategy = new GitHubCollaboratorsStrategy(executor, { cwd: "/tmp" });
    assert.deepEqual(await strategy.listCollaborators(repo), []);
  });

  test("rejects non-GitHub repos", async () => {
    const executor = new MockExecutor();
    const ado: AzureDevOpsRepoInfo = {
      type: "azure-devops",
      gitUrl: "https://dev.azure.com/o/p/_git/r",
      owner: "o",
      organization: "o",
      project: "p",
      repo: "r",
    };
    await assert.rejects(() => make(executor).listCollaborators(ado));
  });
});
