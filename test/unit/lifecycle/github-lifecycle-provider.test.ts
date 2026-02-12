import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubLifecycleProvider } from "../../../src/lifecycle/github-lifecycle-provider.js";
import { createMockExecutor } from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";

describe("GitHubLifecycleProvider", () => {
  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test-org/test-repo.git",
    owner: "test-org",
    repo: "test-repo",
    host: "github.com",
  };

  describe("exists()", () => {
    test("returns true when repo exists", async () => {
      const { mock: executor } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider(executor);
      const result = await provider.exists(mockRepoInfo);

      assert.equal(result, true);
    });

    test("returns false when repo does not exist (404)", async () => {
      const notFoundError = new Error("Could not resolve to a Repository");
      (notFoundError as Error & { stderr?: string }).stderr =
        "gh: Could not resolve to a Repository";
      const { mock: executor } = createMockExecutor({
        responses: new Map([["gh api", notFoundError]]),
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      const result = await provider.exists(mockRepoInfo);

      assert.equal(result, false);
    });

    test("throws on network/auth error (not repo-not-found)", async () => {
      const networkError = new Error("Network timeout");
      (networkError as Error & { stderr?: string }).stderr = "Network timeout";
      const { mock: executor } = createMockExecutor({
        responses: new Map([["gh api", networkError]]),
      });

      const provider = new GitHubLifecycleProvider(executor, 0);

      await assert.rejects(() => provider.exists(mockRepoInfo), /Network/);
    });

    test("uses correct gh api command", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider(executor);
      await provider.exists(mockRepoInfo);

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("gh api"));
      assert.ok(calls[0].command.includes("repos/'test-org'/'test-repo'"));
    });

    test("handles GHE hostname", async () => {
      const gheRepoInfo: GitHubRepoInfo = {
        type: "github",
        gitUrl: "git@github.mycompany.com:test-org/test-repo.git",
        owner: "test-org",
        repo: "test-repo",
        host: "github.mycompany.com",
      };

      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: '{"id": 123}',
      });

      const provider = new GitHubLifecycleProvider(executor);
      await provider.exists(gheRepoInfo);

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("--hostname"));
      assert.ok(calls[0].command.includes("github.mycompany.com"));
    });
  });

  describe("create()", () => {
    test("creates repo with gh repo create", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      await provider.create(mockRepoInfo);

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("gh repo create"));
      assert.ok(calls[0].command.includes("'test-org/test-repo'"));
    });

    test("applies visibility setting - private", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      await provider.create(mockRepoInfo, { visibility: "private" });

      assert.ok(calls[0].command.includes("--private"));
    });

    test("applies visibility setting - internal", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      await provider.create(mockRepoInfo, { visibility: "internal" });

      assert.ok(calls[0].command.includes("--internal"));
    });

    test("defaults to public visibility", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      await provider.create(mockRepoInfo);

      assert.ok(calls[0].command.includes("--public"));
    });

    test("applies description setting", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      await provider.create(mockRepoInfo, { description: "Test repo" });

      assert.ok(calls[0].command.includes("--description"));
      assert.ok(calls[0].command.includes("Test repo"));
    });

    test("throws on failure", async () => {
      const { mock: executor } = createMockExecutor({
        responses: new Map([
          ["gh repo create", new Error("Permission denied")],
        ]),
      });

      const provider = new GitHubLifecycleProvider(executor, 0);

      await assert.rejects(
        () => provider.create(mockRepoInfo),
        /Permission denied/
      );
    });
  });

  describe("fork()", () => {
    const upstreamRepoInfo: GitHubRepoInfo = {
      type: "github",
      gitUrl: "git@github.com:opensource/cool-tool.git",
      owner: "opensource",
      repo: "cool-tool",
      host: "github.com",
    };

    test("forks repo with gh repo fork", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      await provider.fork!(upstreamRepoInfo, mockRepoInfo);

      assert.equal(calls.length, 1);
      assert.ok(calls[0].command.includes("gh repo fork"));
      assert.ok(calls[0].command.includes("'opensource/cool-tool'"));
      assert.ok(calls[0].command.includes("--org"));
      assert.ok(calls[0].command.includes("'test-org'"));
      assert.ok(calls[0].command.includes("--fork-name"));
      assert.ok(calls[0].command.includes("'test-repo'"));
    });

    test("includes --clone=false flag", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      await provider.fork!(upstreamRepoInfo, mockRepoInfo);

      assert.ok(calls[0].command.includes("--clone=false"));
    });

    test("throws on failure", async () => {
      const { mock: executor } = createMockExecutor({
        responses: new Map([
          ["gh repo fork", new Error("Cannot fork private repo")],
        ]),
      });

      const provider = new GitHubLifecycleProvider(executor, 0);

      await assert.rejects(
        () => provider.fork!(upstreamRepoInfo, mockRepoInfo),
        /Cannot fork private repo/
      );
    });
  });

  describe("receiveMigration()", () => {
    test("creates repo then pushes mirror", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      await provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror");

      // Should create repo first, then push mirror
      assert.ok(calls.length >= 2);
      assert.ok(calls[0].command.includes("gh repo create"));
      assert.ok(calls[1].command.includes("git push --mirror"));
    });

    test("pushes to correct git URL", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      await provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror");

      const pushCall = calls.find((c) => c.command.includes("git push"));
      assert.ok(pushCall);
      assert.ok(pushCall.command.includes(mockRepoInfo.gitUrl));
    });

    test("uses sourceDir as cwd for push", async () => {
      const { mock: executor, calls } = createMockExecutor({
        defaultResponse: "",
      });

      const provider = new GitHubLifecycleProvider(executor, 0);
      await provider.receiveMigration(mockRepoInfo, "/tmp/source-mirror");

      const pushCall = calls.find((c) => c.command.includes("git push"));
      assert.ok(pushCall);
      assert.equal(pushCall.cwd, "/tmp/source-mirror");
    });
  });
});
