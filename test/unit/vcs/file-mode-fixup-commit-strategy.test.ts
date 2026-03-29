import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  FileModeFixupCommitStrategy,
  type GhApiClientFactory,
} from "../../../src/vcs/file-mode-fixup-commit-strategy.js";
import type { ICommitStrategy, CommitResult } from "../../../src/vcs/types.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import { GhApiClient } from "../../../src/shared/gh-api-utils.js";

const githubRepoInfo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "git@github.com:owner/repo.git",
  owner: "owner",
  repo: "repo",
  host: "github.com",
};

const mockExecutor: ICommandExecutor = {
  async exec(): Promise<string> {
    return "";
  },
};

function createMockInnerStrategy(result: CommitResult): ICommitStrategy {
  return {
    async commit(): Promise<CommitResult> {
      return result;
    },
  };
}

interface ApiCall {
  method: string;
  endpoint: string;
  payload?: unknown;
}

function createMockClientFactory(
  responses: Map<string, string>,
  calls: ApiCall[] = []
): GhApiClientFactory {
  return (executor, retries, cwd) => {
    const client = new GhApiClient(executor, retries, cwd);
    client.call = async (method, endpoint, params) => {
      calls.push({ method, endpoint, payload: params?.payload });
      for (const [pattern, response] of responses) {
        if (endpoint.includes(pattern)) {
          return response;
        }
      }
      return "{}";
    };
    return client;
  };
}

describe("FileModeFixupCommitStrategy", () => {
  test("returns inner result when no files have mode 100755", async () => {
    const innerResult: CommitResult = {
      sha: "abc123",
      verified: true,
      pushed: true,
    };
    const inner = createMockInnerStrategy(innerResult);

    const strategy = new FileModeFixupCommitStrategy(inner, mockExecutor);

    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "chore/sync-config",
      message: "chore: sync",
      fileChanges: [
        { path: "config.json", content: "{}" },
        { path: "readme.md", content: "# Hello" },
      ],
      workDir: "/tmp/test",
    });

    assert.equal(result.sha, "abc123");
    assert.equal(result.verified, true);
  });

  test("creates fixup commit when files have mode 100755", async () => {
    const innerResult: CommitResult = {
      sha: "content-commit-sha",
      verified: true,
      pushed: true,
    };
    const inner = createMockInnerStrategy(innerResult);

    const apiCalls: ApiCall[] = [];
    const responses = new Map<string, string>([
      [
        "/git/commits/content-commit-sha",
        JSON.stringify({
          sha: "content-commit-sha",
          tree: { sha: "tree-sha-1" },
        }),
      ],
      [
        "/git/trees/tree-sha-1",
        JSON.stringify({
          sha: "tree-sha-1",
          tree: [
            {
              path: "deploy.sh",
              mode: "100644",
              type: "blob",
              sha: "blob-sha-deploy",
            },
            {
              path: "config.json",
              mode: "100644",
              type: "blob",
              sha: "blob-sha-config",
            },
          ],
        }),
      ],
      ["/git/trees", JSON.stringify({ sha: "tree-sha-2" })],
      ["/git/commits", JSON.stringify({ sha: "fixup-commit-sha" })],
      [
        "/git/refs/heads/",
        JSON.stringify({
          ref: "refs/heads/chore/sync-config",
          object: { sha: "fixup-commit-sha" },
        }),
      ],
    ]);

    const factory = createMockClientFactory(responses, apiCalls);
    const strategy = new FileModeFixupCommitStrategy(
      inner,
      mockExecutor,
      factory
    );

    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "chore/sync-config",
      message: "chore: sync",
      fileChanges: [
        {
          path: "deploy.sh",
          content: "#!/bin/bash\necho hello",
          mode: "100755",
        },
        { path: "config.json", content: "{}" },
      ],
      workDir: "/tmp/test",
      token: "ghs_test",
    });

    assert.equal(result.sha, "fixup-commit-sha");
    assert.equal(result.verified, true);
    assert.equal(result.pushed, true);

    // Verify REST API calls were made in order
    assert.ok(
      apiCalls.some(
        (c) =>
          c.method === "GET" &&
          c.endpoint.includes("/git/commits/content-commit-sha")
      ),
      "Should GET the commit to get tree SHA"
    );
    assert.ok(
      apiCalls.some(
        (c) =>
          c.method === "GET" && c.endpoint.includes("/git/trees/tree-sha-1")
      ),
      "Should GET the tree to find blob SHAs"
    );
    assert.ok(
      apiCalls.some(
        (c) => c.method === "POST" && c.endpoint.includes("/git/trees")
      ),
      "Should POST a new tree"
    );
    assert.ok(
      apiCalls.some(
        (c) => c.method === "PATCH" && c.endpoint.includes("/git/refs/heads/")
      ),
      "Should PATCH the branch ref"
    );
  });

  test("propagates error from inner strategy", async () => {
    const inner: ICommitStrategy = {
      async commit(): Promise<CommitResult> {
        throw new Error("GraphQL mutation failed");
      },
    };

    const strategy = new FileModeFixupCommitStrategy(inner, mockExecutor);

    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "chore/sync-config",
          message: "chore: sync",
          fileChanges: [
            { path: "deploy.sh", content: "#!/bin/bash", mode: "100755" },
          ],
          workDir: "/tmp/test",
        }),
      { message: "GraphQL mutation failed" }
    );
  });

  test("propagates error from fixup REST API call", async () => {
    const innerResult: CommitResult = {
      sha: "content-sha",
      verified: true,
      pushed: true,
    };
    const inner = createMockInnerStrategy(innerResult);

    const failingFactory: GhApiClientFactory = (executor, retries, cwd) => {
      const client = new GhApiClient(executor, retries, cwd);
      client.call = async () => {
        throw new Error("HTTP 500 Internal Server Error");
      };
      return client;
    };

    const strategy = new FileModeFixupCommitStrategy(
      inner,
      mockExecutor,
      failingFactory
    );

    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "chore/sync-config",
          message: "chore: sync",
          fileChanges: [
            { path: "deploy.sh", content: "#!/bin/bash", mode: "100755" },
          ],
          workDir: "/tmp/test",
        }),
      { message: /HTTP 500/ }
    );
  });

  test("passes host option for GitHub Enterprise", async () => {
    const gheRepoInfo: GitHubRepoInfo = {
      type: "github",
      gitUrl: "git@github.example.com:owner/repo.git",
      owner: "owner",
      repo: "repo",
      host: "github.example.com",
    };

    const innerResult: CommitResult = {
      sha: "content-sha",
      verified: true,
      pushed: true,
    };
    const inner = createMockInnerStrategy(innerResult);

    const apiCalls: ApiCall[] = [];
    const capturedOptions: Array<{ host?: string }> = [];
    const responses = new Map<string, string>([
      [
        "/git/commits/content-sha",
        JSON.stringify({ sha: "content-sha", tree: { sha: "tree-1" } }),
      ],
      [
        "/git/trees/tree-1",
        JSON.stringify({
          sha: "tree-1",
          tree: [
            {
              path: "deploy.sh",
              mode: "100644",
              type: "blob",
              sha: "blob-1",
            },
          ],
        }),
      ],
      ["/git/trees", JSON.stringify({ sha: "tree-2" })],
      ["/git/commits", JSON.stringify({ sha: "fixup-sha" })],
      [
        "/git/refs/heads/",
        JSON.stringify({
          ref: "refs/heads/test",
          object: { sha: "fixup-sha" },
        }),
      ],
    ]);

    const factory: GhApiClientFactory = (executor, retries, cwd) => {
      const client = new GhApiClient(executor, retries, cwd);
      client.call = async (method, endpoint, params) => {
        apiCalls.push({ method, endpoint, payload: params?.payload });
        capturedOptions.push({ host: params?.options?.host });
        for (const [pattern, response] of responses) {
          if (endpoint.includes(pattern)) {
            return response;
          }
        }
        return "{}";
      };
      return client;
    };

    const strategy = new FileModeFixupCommitStrategy(
      inner,
      mockExecutor,
      factory
    );

    await strategy.commit({
      repoInfo: gheRepoInfo,
      branchName: "test",
      message: "chore: sync",
      fileChanges: [
        { path: "deploy.sh", content: "#!/bin/bash", mode: "100755" },
      ],
      workDir: "/tmp/test",
      token: "ghs_test",
    });

    // All API calls should have GHE host in options
    for (const opts of capturedOptions) {
      assert.equal(
        opts.host,
        "github.example.com",
        "Should pass GHE host to GhApiClient"
      );
    }
  });

  test("creates tree entries for multiple executable files", async () => {
    const innerResult: CommitResult = {
      sha: "content-sha",
      verified: true,
      pushed: true,
    };
    const inner = createMockInnerStrategy(innerResult);

    let capturedTreePayload: unknown = null;
    const responses = new Map<string, string>([
      [
        "/git/commits/content-sha",
        JSON.stringify({ sha: "content-sha", tree: { sha: "tree-1" } }),
      ],
      [
        "/git/trees/tree-1",
        JSON.stringify({
          sha: "tree-1",
          tree: [
            {
              path: "deploy.sh",
              mode: "100644",
              type: "blob",
              sha: "blob-deploy",
            },
            {
              path: "scripts/setup.sh",
              mode: "100644",
              type: "blob",
              sha: "blob-setup",
            },
            {
              path: "config.json",
              mode: "100644",
              type: "blob",
              sha: "blob-config",
            },
          ],
        }),
      ],
      ["/git/trees", JSON.stringify({ sha: "tree-2" })],
      ["/git/commits", JSON.stringify({ sha: "fixup-sha" })],
      [
        "/git/refs/heads/",
        JSON.stringify({
          ref: "refs/heads/test",
          object: { sha: "fixup-sha" },
        }),
      ],
    ]);

    const factory: GhApiClientFactory = (executor, retries, cwd) => {
      const client = new GhApiClient(executor, retries, cwd);
      client.call = async (method, endpoint, params) => {
        if (method === "POST" && endpoint.includes("/git/trees")) {
          capturedTreePayload = params?.payload;
        }
        for (const [pattern, response] of responses) {
          if (endpoint.includes(pattern)) {
            return response;
          }
        }
        return "{}";
      };
      return client;
    };

    const strategy = new FileModeFixupCommitStrategy(
      inner,
      mockExecutor,
      factory
    );

    await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "test",
      message: "chore: sync",
      fileChanges: [
        { path: "deploy.sh", content: "#!/bin/bash", mode: "100755" },
        { path: "scripts/setup.sh", content: "#!/bin/bash", mode: "100755" },
        { path: "config.json", content: "{}" },
      ],
      workDir: "/tmp/test",
    });

    const payload = capturedTreePayload as {
      tree: Array<{ path: string; mode: string; sha: string }>;
    };
    assert.equal(payload.tree.length, 2, "Should have 2 executable entries");
    assert.ok(
      payload.tree.some((e) => e.path === "deploy.sh" && e.mode === "100755"),
      "Should include deploy.sh with 100755"
    );
    assert.ok(
      payload.tree.some(
        (e) => e.path === "scripts/setup.sh" && e.mode === "100755"
      ),
      "Should include scripts/setup.sh with 100755"
    );
  });

  test("skips fixup commit when file is already 100755 on remote", async () => {
    const innerResult: CommitResult = {
      sha: "content-sha",
      verified: true,
      pushed: true,
    };
    const inner = createMockInnerStrategy(innerResult);

    const apiCalls: ApiCall[] = [];
    const responses = new Map<string, string>([
      [
        "/git/commits/content-sha",
        JSON.stringify({ sha: "content-sha", tree: { sha: "tree-1" } }),
      ],
      [
        "/git/trees/tree-1",
        JSON.stringify({
          sha: "tree-1",
          tree: [
            {
              path: "deploy.sh",
              mode: "100755",
              type: "blob",
              sha: "blob-1",
            },
          ],
        }),
      ],
    ]);

    const factory = createMockClientFactory(responses, apiCalls);
    const strategy = new FileModeFixupCommitStrategy(
      inner,
      mockExecutor,
      factory
    );

    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "test",
      message: "chore: sync",
      fileChanges: [
        {
          path: "deploy.sh",
          content: "#!/bin/bash\nupdated",
          mode: "100755",
        },
      ],
      workDir: "/tmp/test",
    });

    // Should return inner result — no fixup needed
    assert.equal(result.sha, "content-sha");

    // Should NOT have created a tree or commit
    assert.ok(
      !apiCalls.some((c) => c.method === "POST"),
      "Should not POST when file is already 100755"
    );
  });

  test("returns inner result when executable file not found in tree", async () => {
    const innerResult: CommitResult = {
      sha: "content-sha",
      verified: true,
      pushed: true,
    };
    const inner = createMockInnerStrategy(innerResult);

    const responses = new Map<string, string>([
      [
        "/git/commits/content-sha",
        JSON.stringify({ sha: "content-sha", tree: { sha: "tree-1" } }),
      ],
      [
        "/git/trees/tree-1",
        JSON.stringify({
          sha: "tree-1",
          tree: [
            {
              path: "other-file.txt",
              mode: "100644",
              type: "blob",
              sha: "blob-1",
            },
          ],
        }),
      ],
    ]);

    const factory = createMockClientFactory(responses);
    const strategy = new FileModeFixupCommitStrategy(
      inner,
      mockExecutor,
      factory
    );

    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "test",
      message: "chore: sync",
      fileChanges: [
        { path: "deploy.sh", content: "#!/bin/bash", mode: "100755" },
      ],
      workDir: "/tmp/test",
    });

    // Should fall back to inner result since file not found in tree
    assert.equal(result.sha, "content-sha");
  });
});
