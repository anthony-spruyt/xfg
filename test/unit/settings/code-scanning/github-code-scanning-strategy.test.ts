import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubCodeScanningStrategy } from "../../../../src/settings/code-scanning/github-code-scanning-strategy.js";
import type { ICommandExecutor } from "../../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../../src/repo/index.js";

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "https://github.com/test-org/test-repo.git",
  host: "github.com",
  owner: "test-org",
  repo: "test-repo",
};

class MockExecutor implements ICommandExecutor {
  lastCommand = "";
  result = "";

  async exec(command: string, _cwd: string): Promise<string> {
    this.lastCommand = command;
    return this.result;
  }
}

describe("GitHubCodeScanningStrategy", () => {
  let executor: MockExecutor;
  let strategy: GitHubCodeScanningStrategy;

  beforeEach(() => {
    executor = new MockExecutor();
    strategy = new GitHubCodeScanningStrategy(executor, { cwd: "/tmp" });
  });

  test("get calls correct endpoint", async () => {
    executor.result = JSON.stringify({
      state: "configured",
      query_suite: "default",
      languages: ["javascript-typescript"],
    });

    const result = await strategy.get(githubRepo);

    assert.equal(result.state, "configured");
    assert.equal(result.query_suite, "default");
    assert.deepStrictEqual(result.languages, ["javascript-typescript"]);
    assert.ok(
      executor.lastCommand.includes(
        "/repos/test-org/test-repo/code-scanning/default-setup"
      )
    );
  });

  test("update calls correct endpoint with payload", async () => {
    executor.result = "";

    await strategy.update(githubRepo, {
      state: "configured",
      query_suite: "extended",
      languages: ["python"],
    });

    assert.ok(
      executor.lastCommand.includes(
        "/repos/test-org/test-repo/code-scanning/default-setup"
      )
    );
  });
});
