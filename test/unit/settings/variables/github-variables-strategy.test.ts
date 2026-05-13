import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GitHubVariablesStrategy } from "../../../../src/settings/variables/github-variables-strategy.js";
import type {
  ICommandExecutor,
  ExecOptions,
} from "../../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../../src/repo/index.js";

class MockExecutor implements ICommandExecutor {
  calls: { executable: string; args: string[] }[] = [];
  response = "";

  async exec(
    executable: string,
    args: string[],
    _cwd: string,
    _options?: ExecOptions
  ): Promise<string> {
    this.calls.push({ executable, args });
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

describe("GitHubVariablesStrategy", () => {
  test("list calls correct API endpoint", async () => {
    const executor = new MockExecutor();
    executor.response = JSON.stringify({
      total_count: 1,
      variables: [
        {
          name: "MY_VAR",
          value: "my-value",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    const strategy = new GitHubVariablesStrategy(executor, { cwd: "/tmp" });

    const result = await strategy.list(mockRepo);

    assert.equal(result.length, 1);
    assert.equal(result[0].name, "MY_VAR");
    const apiCall = executor.calls[0];
    assert.equal(apiCall.args[0], "api");
    assert.ok(
      apiCall.args[2].startsWith("/repos/test-org/test-repo/actions/variables")
    );
  });

  test("create calls POST with name and value", async () => {
    const executor = new MockExecutor();
    executor.response = "{}";
    const strategy = new GitHubVariablesStrategy(executor, { cwd: "/tmp" });

    await strategy.create(mockRepo, "NEW_VAR", "new-value");

    const call = executor.calls[0];
    assert.equal(call.args[1], "-X");
    assert.equal(call.args[2], "POST");
    assert.equal(call.args[4], "/repos/test-org/test-repo/actions/variables");
  });

  test("update calls PATCH with value", async () => {
    const executor = new MockExecutor();
    executor.response = "";
    const strategy = new GitHubVariablesStrategy(executor, { cwd: "/tmp" });

    await strategy.update(mockRepo, "MY_VAR", "updated-value");

    const call = executor.calls[0];
    assert.equal(call.args[1], "-X");
    assert.equal(call.args[2], "PATCH");
    assert.equal(
      call.args[4],
      "/repos/test-org/test-repo/actions/variables/MY_VAR"
    );
  });

  test("delete calls DELETE endpoint", async () => {
    const executor = new MockExecutor();
    executor.response = "";
    const strategy = new GitHubVariablesStrategy(executor, { cwd: "/tmp" });

    await strategy.delete(mockRepo, "MY_VAR");

    const call = executor.calls[0];
    assert.equal(call.args[1], "-X");
    assert.equal(call.args[2], "DELETE");
    assert.ok(
      call.args.some((a) =>
        a.includes("/repos/test-org/test-repo/actions/variables/MY_VAR")
      )
    );
  });
});
