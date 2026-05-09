import { describe, test, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubCodeScanningStrategy } from "../../../../src/settings/code-scanning/github-code-scanning-strategy.js";
import type {
  ICommandExecutor,
  ExecOptions,
} from "../../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../../src/repo/index.js";

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
  cwd: string;
  options?: ExecOptions;
}

class MockExecutor implements ICommandExecutor {
  calls: CallRecord[] = [];
  result = "";

  async exec(
    executable: string,
    args: string[],
    cwd: string,
    options?: ExecOptions
  ): Promise<string> {
    this.calls.push({ executable, args, cwd, options });
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
    assert.strictEqual(executor.calls[0].executable, "gh");
    assert.ok(
      executor.calls[0].args.some((a) =>
        a.includes("/repos/test-org/test-repo/code-scanning/default-setup")
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

    assert.strictEqual(executor.calls[0].executable, "gh");
    assert.ok(
      executor.calls[0].args.some((a) =>
        a.includes("/repos/test-org/test-repo/code-scanning/default-setup")
      )
    );
    assert.ok(
      executor.calls[0].options?.input,
      "Should pass payload via options.input"
    );
  });
});
