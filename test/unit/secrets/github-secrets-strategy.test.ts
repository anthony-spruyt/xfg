import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GitHubSecretsStrategy } from "../../../src/secrets/github-secrets-strategy.js";
import type {
  ICommandExecutor,
  ExecOptions,
} from "../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../src/repo/index.js";

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

describe("GitHubSecretsStrategy", () => {
  test("list calls correct API endpoint", async () => {
    const executor = new MockExecutor();
    executor.response = JSON.stringify({
      total_count: 1,
      secrets: [
        {
          name: "MY_SECRET",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    const strategy = new GitHubSecretsStrategy(executor, { cwd: "/tmp" });
    const result = await strategy.list(mockRepo);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "MY_SECRET");
    assert.ok(
      executor.calls[0].args.some((a) =>
        a.startsWith("/repos/test-org/test-repo/actions/secrets")
      )
    );
  });

  test("getPublicKey calls correct endpoint and parses response", async () => {
    const executor = new MockExecutor();
    executor.response = JSON.stringify({
      key_id: "key-123",
      key: "base64pubkey==",
    });
    const strategy = new GitHubSecretsStrategy(executor, { cwd: "/tmp" });
    const result = await strategy.getPublicKey(mockRepo);
    assert.equal(result.key_id, "key-123");
    assert.equal(result.key, "base64pubkey==");
    assert.ok(
      executor.calls[0].args.some((a) =>
        a.includes("/repos/test-org/test-repo/actions/secrets/public-key")
      ),
      "Should call public-key endpoint"
    );
  });

  test("getPublicKey throws on malformed JSON", async () => {
    const executor = new MockExecutor();
    executor.response = "not-json";
    const strategy = new GitHubSecretsStrategy(executor, { cwd: "/tmp" });
    await assert.rejects(() => strategy.getPublicKey(mockRepo));
  });

  test("list throws on non-GitHub repo", async () => {
    const executor = new MockExecutor();
    const strategy = new GitHubSecretsStrategy(executor, { cwd: "/tmp" });
    const adoRepo = {
      type: "azure-devops" as const,
      owner: "org",
      repo: "repo",
      organization: "org",
      project: "proj",
      gitUrl: "https://dev.azure.com/org/proj/_git/repo",
    };
    await assert.rejects(() => strategy.list(adoRepo));
  });

  test("upsert calls PUT with encrypted value and key_id", async () => {
    const executor = new MockExecutor();
    executor.response = "";
    const strategy = new GitHubSecretsStrategy(executor, { cwd: "/tmp" });
    await strategy.upsert(mockRepo, "MY_SECRET", "encrypted-base64", "key-123");
    const call = executor.calls[0];
    assert.equal(call.args[1], "-X");
    assert.equal(call.args[2], "PUT");
    assert.ok(
      call.args.some((a) =>
        a.includes("/repos/test-org/test-repo/actions/secrets/MY_SECRET")
      )
    );
  });

  test("delete calls DELETE endpoint", async () => {
    const executor = new MockExecutor();
    executor.response = "";
    const strategy = new GitHubSecretsStrategy(executor, { cwd: "/tmp" });
    await strategy.delete(mockRepo, "MY_SECRET");
    const call = executor.calls[0];
    assert.equal(call.args[1], "-X");
    assert.equal(call.args[2], "DELETE");
    assert.ok(
      call.args.some((a) =>
        a.includes("/repos/test-org/test-repo/actions/secrets/MY_SECRET")
      )
    );
  });
});
