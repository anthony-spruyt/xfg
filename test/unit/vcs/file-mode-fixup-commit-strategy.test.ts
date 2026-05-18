import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  FileModeFixupCommitStrategy,
  type GhApiClientFactory,
} from "../../../src/vcs/commit/file-mode-fixup-commit-strategy.js";
import type { ICommitStrategy, CommitResult } from "../../../src/vcs/types.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";
import type { GitHubRepoInfo } from "../../../src/repo/index.js";
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

type MockResponse = string | { status: number; body: string };

function createMockClientFactory(
  responses: Map<string, MockResponse | MockResponse[]>,
  calls: ApiCall[] = []
): GhApiClientFactory {
  const responseQueues = new Map<string, MockResponse[]>();
  for (const [key, val] of responses) {
    responseQueues.set(key, Array.isArray(val) ? [...val] : [val]);
  }

  return (_executor, retries, cwd) => {
    const client = new GhApiClient(_executor, retries, cwd);
    client.call = async (method, endpoint, params) => {
      calls.push({ method, endpoint, payload: params?.payload });
      let bestMatch = "";
      let bestQueue: MockResponse[] = ["{}"];
      for (const [pattern, queue] of responseQueues) {
        if (endpoint.includes(pattern) && pattern.length > bestMatch.length) {
          bestMatch = pattern;
          bestQueue = queue;
        }
      }
      const resp = bestQueue.length > 1 ? bestQueue.shift()! : bestQueue[0];
      if (typeof resp === "string") return resp;
      if (resp.status >= 400) {
        throw new Error(resp.body);
      }
      return resp.body;
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

  test("throws when tree is truncated and executable file not found", async () => {
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
          truncated: true,
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

    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "test",
          message: "chore: sync",
          fileChanges: [
            { path: "deploy.sh", content: "#!/bin/bash", mode: "100755" },
          ],
          workDir: "/tmp/test",
        }),
      { message: /truncated.*deploy\.sh/ }
    );
  });

  test("throws when tree is truncated and some executable files are missing", async () => {
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
          truncated: true,
          tree: [
            {
              path: "deploy.sh",
              mode: "100644",
              type: "blob",
              sha: "blob-deploy",
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

    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "test",
          message: "chore: sync",
          fileChanges: [
            { path: "deploy.sh", content: "#!/bin/bash", mode: "100755" },
            {
              path: "scripts/setup.sh",
              content: "#!/bin/bash",
              mode: "100755",
            },
          ],
          workDir: "/tmp/test",
        }),
      { message: /truncated.*scripts\/setup\.sh/ }
    );
  });

  test("succeeds when tree is truncated but all executable files were found", async () => {
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
          truncated: true,
          tree: [
            { path: "deploy.sh", mode: "100755", type: "blob", sha: "blob-1" },
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

    // File already 100755, no fixup needed — should succeed despite truncation
    assert.equal(result.sha, "content-sha");
  });

  test("throws when tree is truncated with some files already 100755 and others missing", async () => {
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
          truncated: true,
          tree: [
            {
              path: "deploy.sh",
              mode: "100755",
              type: "blob",
              sha: "blob-deploy",
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

    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "test",
          message: "chore: sync",
          fileChanges: [
            { path: "deploy.sh", content: "#!/bin/bash", mode: "100755" },
            {
              path: "scripts/setup.sh",
              content: "#!/bin/bash",
              mode: "100755",
            },
          ],
          workDir: "/tmp/test",
        }),
      { message: /truncated.*scripts\/setup\.sh/ }
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

  test("passes retries option through to client factory", async () => {
    const innerResult: CommitResult = {
      sha: "content-sha",
      verified: true,
      pushed: true,
    };
    const inner = createMockInnerStrategy(innerResult);

    let capturedRetries: number | undefined;
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
      capturedRetries = retries;
      const client = new GhApiClient(executor, retries, cwd);
      client.call = async (_method, endpoint) => {
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
      ],
      workDir: "/tmp/test",
      retries: 7,
    });

    assert.equal(
      capturedRetries,
      7,
      "Should pass retries option to client factory"
    );
  });

  test("mode-only changes: skips inner commit and builds fixup from branch HEAD", async () => {
    let innerCalled = false;
    const inner: ICommitStrategy = {
      async commit(): Promise<CommitResult> {
        innerCalled = true;
        throw new Error("inner should NOT be called for mode-only changes");
      },
    };

    const calls: ApiCall[] = [];
    const responses = new Map<string, MockResponse>([
      [
        "/git/ref/heads/chore/sync-config",
        JSON.stringify({ object: { sha: "branch-head-sha" } }),
      ],
      [
        "/git/commits/branch-head-sha",
        JSON.stringify({
          sha: "branch-head-sha",
          tree: { sha: "tree-sha" },
        }),
      ],
      [
        "/git/trees/tree-sha",
        JSON.stringify({
          sha: "tree-sha",
          tree: [
            {
              path: "scripts/run",
              mode: "100644",
              type: "blob",
              sha: "blob-sha",
            },
          ],
        }),
      ],
      ["/git/trees", JSON.stringify({ sha: "new-tree-sha" })],
      ["/git/commits", JSON.stringify({ sha: "new-commit-sha" })],
      ["/git/refs/heads/chore/sync-config", JSON.stringify({})],
    ]);
    const clientFactory = createMockClientFactory(responses, calls);

    const strategy = new FileModeFixupCommitStrategy(
      inner,
      mockExecutor,
      clientFactory
    );
    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "chore/sync-config",
      message: "chore: sync",
      fileChanges: [
        { path: "scripts/run", content: null, mode: "100755", modeOnly: true },
      ],
      workDir: "/tmp/repo",
    });

    assert.equal(innerCalled, false);
    assert.equal(result.sha, "new-commit-sha");
    assert.ok(
      calls.some(
        (c) => c.method === "GET" && c.endpoint.includes("/git/ref/heads/")
      ),
      "expected GET on git/ref/heads/<branch>"
    );
  });

  test("mixed content + mode-only: inner runs, fixup includes mode-only entries", async () => {
    const innerResult: CommitResult = {
      sha: "inner-sha",
      verified: true,
      pushed: true,
    };
    const inner = createMockInnerStrategy(innerResult);
    const responses = new Map<string, MockResponse>([
      [
        "/git/commits/inner-sha",
        JSON.stringify({
          sha: "inner-sha",
          tree: { sha: "tree-sha" },
        }),
      ],
      [
        "/git/trees/tree-sha",
        JSON.stringify({
          sha: "tree-sha",
          tree: [
            {
              path: "scripts/run",
              mode: "100644",
              type: "blob",
              sha: "blob-sha",
            },
            {
              path: "normal.txt",
              mode: "100644",
              type: "blob",
              sha: "normal-sha",
            },
          ],
        }),
      ],
      ["/git/trees", JSON.stringify({ sha: "new-tree-sha" })],
      ["/git/commits", JSON.stringify({ sha: "new-commit-sha" })],
      ["/git/refs/heads/chore/sync-config", JSON.stringify({})],
    ]);

    const strategy = new FileModeFixupCommitStrategy(
      inner,
      mockExecutor,
      createMockClientFactory(responses)
    );
    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "chore/sync-config",
      message: "chore: sync",
      fileChanges: [
        { path: "normal.txt", content: "hi\n" },
        { path: "scripts/run", content: null, mode: "100755", modeOnly: true },
      ],
      workDir: "/tmp/repo",
    });

    assert.equal(result.sha, "new-commit-sha");
  });

  test("content-change downgrade: fixup patches tree mode from 100755 to 100644", async () => {
    const innerResult: CommitResult = {
      sha: "inner-sha",
      verified: true,
      pushed: true,
    };
    const inner = createMockInnerStrategy(innerResult);
    const calls: ApiCall[] = [];
    const responses = new Map<string, MockResponse>([
      [
        "/git/commits/inner-sha",
        JSON.stringify({
          sha: "inner-sha",
          tree: { sha: "tree-sha" },
        }),
      ],
      [
        "/git/trees/tree-sha",
        JSON.stringify({
          sha: "tree-sha",
          tree: [
            {
              path: "scripts/run",
              mode: "100755",
              type: "blob",
              sha: "blob-sha",
            },
          ],
        }),
      ],
      ["/git/trees", JSON.stringify({ sha: "new-tree-sha" })],
      ["/git/commits", JSON.stringify({ sha: "new-commit-sha" })],
      ["/git/refs/heads/chore/sync-config", JSON.stringify({})],
    ]);
    const strategy = new FileModeFixupCommitStrategy(
      inner,
      mockExecutor,
      createMockClientFactory(responses, calls)
    );
    await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "chore/sync-config",
      message: "chore: sync",
      fileChanges: [
        { path: "scripts/run", content: "new content\n", mode: "100644" },
      ],
      workDir: "/tmp/repo",
    });
    const createTreeCall = calls.find(
      (c) => c.method === "POST" && c.endpoint.endsWith("/git/trees")
    );
    assert.ok(createTreeCall);
    assert.match(JSON.stringify(createTreeCall!.payload), /"mode":"100644"/);
  });

  test("mode-only when branch does not exist on remote: creates branch from base and applies fixup", async () => {
    const calls: ApiCall[] = [];
    const get404: MockResponse = {
      status: 404,
      body: JSON.stringify({ message: "Not Found" }),
    };
    const responses = new Map<string, MockResponse | MockResponse[]>([
      ["/git/ref/heads/chore/sync-config", get404],
      ["/git/ref/heads/main", JSON.stringify({ object: { sha: "base-sha" } })],
      [
        "/git/refs",
        JSON.stringify({
          ref: "refs/heads/chore/sync-config",
          object: { sha: "base-sha" },
        }),
      ],
      [
        "/git/commits/base-sha",
        JSON.stringify({
          sha: "base-sha",
          tree: { sha: "tree-sha" },
        }),
      ],
      [
        "/git/trees/tree-sha",
        JSON.stringify({
          sha: "tree-sha",
          tree: [
            {
              path: "scripts/run",
              mode: "100644",
              type: "blob",
              sha: "blob-sha",
            },
          ],
        }),
      ],
      ["/git/trees", JSON.stringify({ sha: "new-tree-sha" })],
      ["/git/commits", JSON.stringify({ sha: "new-commit-sha" })],
    ]);
    const strategy = new FileModeFixupCommitStrategy(
      {
        async commit() {
          throw new Error("inner should NOT be called");
        },
      },
      mockExecutor,
      createMockClientFactory(responses, calls)
    );
    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "chore/sync-config",
      baseBranch: "main",
      message: "chore: sync",
      fileChanges: [
        { path: "scripts/run", content: null, mode: "100755", modeOnly: true },
      ],
      workDir: "/tmp/repo",
    });
    assert.equal(result.sha, "new-commit-sha");
    assert.ok(
      calls.some(
        (c) => c.method === "POST" && c.endpoint.endsWith("/git/refs")
      ),
      "expected branch creation via POST /git/refs"
    );
  });

  test("mode-only downgrade (100755 -> 100644) writes 100644 to the fixup tree", async () => {
    const responses = new Map<string, MockResponse>([
      [
        "/git/ref/heads/chore/sync-config",
        JSON.stringify({ object: { sha: "branch-head-sha" } }),
      ],
      [
        "/git/commits/branch-head-sha",
        JSON.stringify({
          sha: "branch-head-sha",
          tree: { sha: "tree-sha" },
        }),
      ],
      [
        "/git/trees/tree-sha",
        JSON.stringify({
          sha: "tree-sha",
          tree: [
            {
              path: "scripts/run",
              mode: "100755",
              type: "blob",
              sha: "blob-sha",
            },
          ],
        }),
      ],
      ["/git/trees", JSON.stringify({ sha: "new-tree-sha" })],
      ["/git/commits", JSON.stringify({ sha: "new-commit-sha" })],
      ["/git/refs/heads/chore/sync-config", JSON.stringify({})],
    ]);
    const calls: ApiCall[] = [];
    const clientFactory = createMockClientFactory(responses, calls);

    const strategy = new FileModeFixupCommitStrategy(
      createMockInnerStrategy({
        sha: "ignored",
        verified: true,
        pushed: true,
      }),
      mockExecutor,
      clientFactory
    );
    await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "chore/sync-config",
      message: "chore: sync",
      fileChanges: [
        { path: "scripts/run", content: null, mode: "100644", modeOnly: true },
      ],
      workDir: "/tmp/repo",
    });

    const createTreeCall = calls.find(
      (c) => c.method === "POST" && c.endpoint.endsWith("/git/trees")
    );
    assert.ok(createTreeCall);
    assert.match(JSON.stringify(createTreeCall!.payload), /"mode":"100644"/);
  });

  test("rejects unsafe branch name before making any REST call", async () => {
    const calls: ApiCall[] = [];
    const clientFactory = createMockClientFactory(new Map(), calls);
    const strategy = new FileModeFixupCommitStrategy(
      {
        async commit() {
          throw new Error("inner should NOT be called");
        },
      },
      mockExecutor,
      clientFactory
    );
    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "../../evil",
          message: "chore: sync",
          fileChanges: [
            {
              path: "scripts/run",
              content: null,
              mode: "100755",
              modeOnly: true,
            },
          ],
          workDir: "/tmp/repo",
        }),
      /Invalid branch name/
    );
    assert.equal(
      calls.length,
      0,
      "no REST calls should be made for an unsafe branch name"
    );
  });

  test("mode-only without baseBranch: rethrows 404 from branch ref lookup", async () => {
    const get404: MockResponse = {
      status: 404,
      body: JSON.stringify({ message: "Not Found" }),
    };
    const responses = new Map<string, MockResponse>([
      ["/git/ref/heads/chore/sync-config", get404],
    ]);
    const strategy = new FileModeFixupCommitStrategy(
      {
        async commit() {
          throw new Error("inner should NOT be called");
        },
      },
      mockExecutor,
      createMockClientFactory(responses)
    );
    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "chore/sync-config",
          message: "chore: sync",
          fileChanges: [
            {
              path: "scripts/run",
              content: null,
              mode: "100755",
              modeOnly: true,
            },
          ],
          workDir: "/tmp/repo",
        }),
      /Not Found/
    );
  });

  test("mode-only: rethrows non-404 error from branch ref lookup", async () => {
    const get500: MockResponse = {
      status: 500,
      body: "Internal Server Error",
    };
    const responses = new Map<string, MockResponse>([
      ["/git/ref/heads/chore/sync-config", get500],
    ]);
    const strategy = new FileModeFixupCommitStrategy(
      {
        async commit() {
          throw new Error("inner should NOT be called");
        },
      },
      mockExecutor,
      createMockClientFactory(responses)
    );
    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "chore/sync-config",
          baseBranch: "main",
          message: "chore: sync",
          fileChanges: [
            {
              path: "scripts/run",
              content: null,
              mode: "100755",
              modeOnly: true,
            },
          ],
          workDir: "/tmp/repo",
        }),
      /Internal Server Error/
    );
  });

  test("404 fallback race: POST /git/refs 422 -> re-GET branch ref", async () => {
    const calls: ApiCall[] = [];
    const get404: MockResponse = {
      status: 404,
      body: JSON.stringify({ message: "Not Found" }),
    };
    const post422: MockResponse = {
      status: 422,
      body: JSON.stringify({ message: "Reference already exists" }),
    };
    const responses = new Map<string, MockResponse | MockResponse[]>([
      [
        "/git/ref/heads/chore/sync-config",
        [get404, JSON.stringify({ object: { sha: "race-winner-sha" } })],
      ],
      ["/git/ref/heads/main", JSON.stringify({ object: { sha: "base-sha" } })],
      ["/git/refs", post422],
      [
        "/git/commits/race-winner-sha",
        JSON.stringify({
          sha: "race-winner-sha",
          tree: { sha: "tree-sha" },
        }),
      ],
      [
        "/git/trees/tree-sha",
        JSON.stringify({
          sha: "tree-sha",
          tree: [
            {
              path: "scripts/run",
              mode: "100644",
              type: "blob",
              sha: "blob-sha",
            },
          ],
        }),
      ],
      ["/git/trees", JSON.stringify({ sha: "new-tree-sha" })],
      ["/git/commits", JSON.stringify({ sha: "new-commit-sha" })],
      ["/git/refs/heads/chore/sync-config", JSON.stringify({})],
    ]);
    const strategy = new FileModeFixupCommitStrategy(
      {
        async commit() {
          throw new Error("inner should NOT be called");
        },
      },
      mockExecutor,
      createMockClientFactory(responses, calls)
    );
    const result = await strategy.commit({
      repoInfo: githubRepoInfo,
      branchName: "chore/sync-config",
      baseBranch: "main",
      message: "chore: sync",
      fileChanges: [
        {
          path: "scripts/run",
          content: null,
          mode: "100755",
          modeOnly: true,
        },
      ],
      workDir: "/tmp/repo",
    });
    assert.equal(result.sha, "new-commit-sha");
    const getBranchRefCalls = calls.filter(
      (c) =>
        c.method === "GET" &&
        c.endpoint.includes("/git/ref/heads/chore/sync-config")
    );
    assert.equal(
      getBranchRefCalls.length,
      2,
      "expected re-GET after POST raced"
    );
  });

  test("404 fallback: rethrows non-422 POST error", async () => {
    const get404: MockResponse = {
      status: 404,
      body: JSON.stringify({ message: "Not Found" }),
    };
    const post500: MockResponse = {
      status: 500,
      body: "Internal Server Error",
    };
    const responses = new Map<string, MockResponse>([
      ["/git/ref/heads/chore/sync-config", get404],
      ["/git/ref/heads/main", JSON.stringify({ object: { sha: "base-sha" } })],
      ["/git/refs", post500],
    ]);
    const strategy = new FileModeFixupCommitStrategy(
      {
        async commit() {
          throw new Error("inner should NOT be called");
        },
      },
      mockExecutor,
      createMockClientFactory(responses)
    );
    await assert.rejects(
      () =>
        strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "chore/sync-config",
          baseBranch: "main",
          message: "chore: sync",
          fileChanges: [
            {
              path: "scripts/run",
              content: null,
              mode: "100755",
              modeOnly: true,
            },
          ],
          workDir: "/tmp/repo",
        }),
      /Internal Server Error/
    );
  });
});
