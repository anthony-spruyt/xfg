import { describe, test, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  GraphQLCommitStrategy,
  MAX_PAYLOAD_SIZE,
  SAFE_BRANCH_NAME_PATTERN,
  validateSafeBranchName,
} from "../../../src/vcs/graphql-commit-strategy.js";
import {
  GitHubRepoInfo,
  AzureDevOpsRepoInfo,
} from "../../../src/repo/index.js";
import { CommitOptions } from "../../../src/vcs/types.js";
import type { INetworkGitOps } from "../../../src/vcs/types.js";
import {
  createMockExecutor,
  type ExecutorMockResult,
} from "../../mocks/executor.mock.js";

// Create a mock INetworkGitOps for testing
function createMockGitOps(): INetworkGitOps & {
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    async fetchBranch(branchName: string) {
      calls.push({ method: "fetchBranch", args: [branchName] });
    },
  } as unknown as INetworkGitOps & {
    calls: Array<{ method: string; args: unknown[] }>;
  };
}

const testDir = join(tmpdir(), "test-graphql-commit-strategy-tmp");

describe("SAFE_BRANCH_NAME_PATTERN", () => {
  test("accepts valid branch names", () => {
    const validNames = [
      "main",
      "master",
      "feature/add-login",
      "fix/bug-123",
      "chore/sync-config",
      "release/v1.0.0",
      "hotfix/critical-fix",
      "user/john/feature",
      "feature_underscore",
      "feature-hyphen",
      "feature.dot",
      "Feature123",
      "v1.2.3",
    ];
    for (const name of validNames) {
      assert.ok(SAFE_BRANCH_NAME_PATTERN.test(name), `Should accept: ${name}`);
    }
  });

  test("rejects branch names with shell-dangerous characters", () => {
    const dangerousNames = [
      "branch name", // space
      "branch;rm -rf", // semicolon
      "branch`whoami`", // backtick
      "branch$(cmd)", // command substitution
      "branch|pipe", // pipe
      "branch&background", // ampersand
      "branch>redirect", // redirect
      "branch<input", // input redirect
      "'quoted'", // single quotes
      '"doublequoted"', // double quotes
      "-start-with-hyphen", // starts with hyphen
      ".start-with-dot", // starts with dot
    ];
    for (const name of dangerousNames) {
      assert.ok(!SAFE_BRANCH_NAME_PATTERN.test(name), `Should reject: ${name}`);
    }
  });
});

describe("validateSafeBranchName", () => {
  test("does not throw for valid branch names", () => {
    assert.doesNotThrow(() => validateSafeBranchName("main"));
    assert.doesNotThrow(() => validateSafeBranchName("feature/login"));
    assert.doesNotThrow(() => validateSafeBranchName("fix-bug-123"));
  });

  test("throws for invalid branch names", () => {
    assert.throws(
      () => validateSafeBranchName("branch name"),
      /Invalid branch name/
    );
    assert.throws(
      () => validateSafeBranchName("branch;rm -rf"),
      /Invalid branch name/
    );
    assert.throws(
      () => validateSafeBranchName("-invalid"),
      /Invalid branch name/
    );
  });
});

describe("GraphQLCommitStrategy", () => {
  const githubRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
    host: "github.com",
  };

  const gheRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.enterprise.com:owner/repo.git",
    owner: "owner",
    repo: "repo",
    host: "github.enterprise.com",
  };

  const azureRepoInfo: AzureDevOpsRepoInfo = {
    type: "azure-devops",
    gitUrl: "git@ssh.dev.azure.com:v3/org/project/repo",
    owner: "org",
    repo: "repo",
    organization: "org",
    project: "project",
  };

  let mockExecutor: ExecutorMockResult;

  beforeEach(() => {
    mockExecutor = createMockExecutor();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("MAX_PAYLOAD_SIZE", () => {
    test("is 50MB", () => {
      assert.equal(MAX_PAYLOAD_SIZE, 50 * 1024 * 1024);
    });
  });

  describe("commit", () => {
    test("calls GraphQL API with createCommitOnBranch mutation", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123def456789");

      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          data: {
            createCommitOnBranch: {
              commit: { oid: "newcommitsha123" },
            },
          },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "test-branch",
        message: "Test commit message",
        fileChanges: [{ path: "file1.txt", content: "content1" }],
        workDir: testDir,
      };

      const result = await strategy.commit(options);

      // Verify result
      assert.equal(result.sha, "newcommitsha123");
      assert.equal(result.verified, true);
      assert.equal(result.pushed, true);

      // Verify GraphQL was called with correct mutation structure
      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      // Find the createCommitOnBranch call (not queryRemoteRef)
      const commitCall = graphqlCalls.find((c) =>
        c.command.includes("createCommitOnBranch")
      );
      assert.ok(commitCall, "Should have called createCommitOnBranch");
      assert.ok(
        commitCall.command.includes("owner/repo"),
        "Should include repositoryNameWithOwner"
      );
      assert.ok(
        commitCall.command.includes("test-branch"),
        "Should include branch name"
      );
      assert.ok(
        commitCall.command.includes("abc123def456789"),
        "Should include expectedHeadOid"
      );

      // Verify commit message is passed in the mutation variables
      assert.ok(
        commitCall.command.includes("Test commit message"),
        "Should include commit message headline in mutation variables"
      );

      // Verify file additions are base64-encoded in the payload
      const expectedBase64 = Buffer.from("content1").toString("base64");
      assert.ok(
        commitCall.command.includes(expectedBase64),
        "Should include base64-encoded file content"
      );
      assert.ok(
        commitCall.command.includes("file1.txt"),
        "Should include file path in additions"
      );

      // Verify the mutation uses the correct GraphQL mutation signature
      assert.ok(
        commitCall.command.includes("CreateCommitOnBranchInput"),
        "Should use CreateCommitOnBranchInput type in mutation"
      );
    });

    test("does not include empty deletions array in payload", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Add file",
        fileChanges: [{ path: "test.txt", content: "content" }], // Only additions, no deletions
        workDir: testDir,
      };

      await strategy.commit(options);

      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("createCommitOnBranch")
      );
      assert.ok(graphqlCall, "Should have called createCommitOnBranch");

      // Verify deletions key is not in the payload
      assert.ok(
        !graphqlCall.command.includes('"deletions"'),
        "Should not include deletions key when there are no deletions"
      );

      // Verify additions are included
      assert.ok(
        graphqlCall.command.includes('"additions"'),
        "Should include additions key"
      );
    });

    test("includes deletions when files need to be deleted", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Delete file",
        fileChanges: [{ path: "to-delete.txt", content: null }], // Deletion
        workDir: testDir,
      };

      await strategy.commit(options);

      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("createCommitOnBranch")
      );
      assert.ok(graphqlCall, "Should have called createCommitOnBranch");

      // Verify deletions is included
      assert.ok(
        graphqlCall.command.includes('"deletions"'),
        "Should include deletions key when there are deletions"
      );
      assert.ok(
        graphqlCall.command.includes("to-delete.txt"),
        "Should include the file path in deletions"
      );
    });

    test("base64 encodes file contents", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Add file",
        fileChanges: [{ path: "test.txt", content: "Hello, World!" }],
        workDir: testDir,
      };

      await strategy.commit(options);

      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("createCommitOnBranch")
      );
      assert.ok(graphqlCall, "Should have called createCommitOnBranch");

      // "Hello, World!" in base64 is "SGVsbG8sIFdvcmxkIQ=="
      const expectedBase64 = Buffer.from("Hello, World!").toString("base64");
      assert.ok(
        graphqlCall.command.includes(expectedBase64),
        `Should include base64 encoded content. Expected: ${expectedBase64}`
      );
    });

    test("handles file deletions", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Delete file",
        fileChanges: [
          { path: "keep.txt", content: "keep this" },
          { path: "delete.txt", content: null }, // null means deletion
        ],
        workDir: testDir,
      };

      await strategy.commit(options);

      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("createCommitOnBranch")
      );
      assert.ok(graphqlCall, "Should have called createCommitOnBranch");

      // Should include additions and deletions
      assert.ok(
        graphqlCall.command.includes("additions"),
        "Should include additions"
      );
      assert.ok(
        graphqlCall.command.includes("deletions"),
        "Should include deletions"
      );
      assert.ok(
        graphqlCall.command.includes("delete.txt"),
        "Should include deleted file path"
      );
    });

    test("throws error when payload exceeds size limit (50MB)", async () => {
      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);

      // Create content that exceeds 50MB when base64 encoded
      // Base64 adds ~33%, so we need ~37.5MB of raw content to get 50MB encoded
      // For testing, we'll mock the size check to trigger the error
      const largeContent = "x".repeat(40 * 1024 * 1024); // 40MB

      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Large file",
        fileChanges: [{ path: "large.txt", content: largeContent }],
        workDir: testDir,
      };

      await assert.rejects(
        () => strategy.commit(options),
        /payload.*exceeds.*50\s*MB/i,
        "Should throw error about payload size limit"
      );
    });

    test("supports GitHub Enterprise with custom host", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: gheRepoInfo,
        branchName: "main",
        message: "GHE commit",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
      };

      await strategy.commit(options);

      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      // All GraphQL calls should include GHE hostname
      for (const call of graphqlCalls) {
        assert.ok(
          call.command.includes("--hostname"),
          "Should include --hostname flag"
        );
        assert.ok(
          call.command.includes("github.enterprise.com"),
          "Should include GHE hostname"
        );
      }
    });

    test("retries on expectedHeadOid mismatch", async () => {
      let revParseCallCount = 0;

      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", () => {
        revParseCallCount++;
        if (revParseCallCount <= 1) {
          return "oldsha123";
        }
        return "newsha456";
      });

      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse; // queryRemoteRef
        if (graphqlCallCount === 2) {
          throw new Error(
            "Expected branch to point to abc123 but it points to xyz789"
          );
        }
        return JSON.stringify({
          data: {
            createCommitOnBranch: {
              commit: { oid: "successsha" },
            },
          },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
        retries: 3,
      };

      const result = await strategy.commit(options);

      assert.equal(result.sha, "successsha");
      assert.ok(graphqlCallCount >= 3, "Should have retried GraphQL call");
    });

    test("throws descriptive error for permission denied", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        throw new Error(
          "GraphQL: Resource not accessible by integration (createCommitOnBranch)"
        );
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
      };

      await assert.rejects(
        () => strategy.commit(options),
        /permission|access|not accessible/i,
        "Should throw descriptive permission error"
      );
    });

    test("throws error for non-GitHub repos", async () => {
      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: azureRepoInfo,
        branchName: "main",
        message: "Test",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
      };

      await assert.rejects(
        () => strategy.commit(options),
        /GitHub.*only|not.*supported|requires.*github/i,
        "Should throw error for non-GitHub repos"
      );
    });

    test("throws error for invalid branch names (shell injection prevention)", async () => {
      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const invalidBranchNames = [
        "branch name", // space
        "branch;rm", // semicolon
        "$(whoami)", // command substitution
        "-invalid", // starts with hyphen
      ];

      for (const branchName of invalidBranchNames) {
        const options: CommitOptions = {
          repoInfo: githubRepoInfo,
          branchName,
          message: "Test",
          fileChanges: [{ path: "test.txt", content: "content" }],
          workDir: testDir,
        };

        await assert.rejects(
          () => strategy.commit(options),
          /Invalid branch name/,
          `Should reject branch name: ${branchName}`
        );
      }
    });

    test("throws error when GraphQL response contains errors", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          errors: [
            { message: "Validation failed" },
            { message: "Branch not found" },
          ],
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
      };

      await assert.rejects(
        () => strategy.commit(options),
        /Validation failed.*Branch not found/,
        "Should throw error with all GraphQL error messages"
      );
    });

    test("throws error when GraphQL response missing commit OID", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          data: {
            createCommitOnBranch: {
              commit: null, // Missing OID
            },
          },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
      };

      await assert.rejects(
        () => strategy.commit(options),
        /missing commit OID/i,
        "Should throw error when OID is missing"
      );
    });

    test("uses token parameter for authorization when provided", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123def456789");
      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          data: {
            createCommitOnBranch: { commit: { oid: "newsha123" } },
          },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "test-branch",
        message: "Test commit",
        fileChanges: [{ path: "file.txt", content: "content" }],
        workDir: testDir,
        token: "ghs_test_token_from_parameter",
      };

      await strategy.commit(options);

      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      // All GraphQL calls should pass token via env, not in command string
      for (const call of graphqlCalls) {
        assert.ok(
          !call.command.includes("GH_TOKEN"),
          "GraphQL command should not have token in command string"
        );
        assert.strictEqual(
          call.options?.env?.GH_TOKEN,
          "ghs_test_token_from_parameter",
          "GraphQL command should pass token via env option"
        );
      }
    });

    test("uses gitOps.fetchBranch during commit (GitHub App auth)", async () => {
      mockExecutor.responses.set("rev-parse origin", "abc123");

      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
        });
      });

      const mockGitOps = createMockGitOps();
      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await strategy.commit({
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test commit",
        fileChanges: [{ path: "file.txt", content: "content" }],
        workDir: testDir,
        token: "ghs_app_token_123",
        gitOps: mockGitOps,
      });

      // fetchBranch is still used (OID mismatch retry loop)
      const fetchCalls = mockGitOps.calls.filter(
        (c) => c.method === "fetchBranch"
      );
      assert.ok(
        fetchCalls.length >= 1,
        `Should have called gitOps.fetchBranch. Got: ${fetchCalls.length}`
      );

      // lsRemote is no longer used (replaced by queryRemoteRef GraphQL)
      const lsRemoteCalls = mockGitOps.calls.filter(
        (c) => c.method === "lsRemote"
      );
      assert.equal(
        lsRemoteCalls.length,
        0,
        "Should NOT call gitOps.lsRemote (replaced by GraphQL)"
      );
    });

    test("should retry GraphQL API call on transient network error", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");

      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse; // queryRemoteRef
        if (graphqlCallCount === 2) throw new Error("Connection timed out"); // transient on createCommitOnBranch
        return JSON.stringify({
          data: {
            createCommitOnBranch: {
              commit: { oid: "retrysha123" },
            },
          },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test retry",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
      };

      const result = await strategy.commit(options);

      assert.equal(result.sha, "retrysha123");
      assert.ok(
        graphqlCallCount >= 3,
        `Expected at least 3 GraphQL calls, got ${graphqlCallCount}`
      );
    });

    test("should not retry GraphQL API call on permanent error", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");

      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse; // queryRemoteRef
        throw new Error("gh: Authentication failed (HTTP 401)"); // createCommitOnBranch
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test no retry",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
      };

      await assert.rejects(() => strategy.commit(options), /401/);

      assert.equal(
        graphqlCallCount,
        2,
        `Expected exactly 2 GraphQL calls (queryRemoteRef + failed createCommitOnBranch), got ${graphqlCallCount}`
      );
    });

    test("should not waste inner retries on OID mismatch errors", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");

      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse; // queryRemoteRef
        if (graphqlCallCount === 2) {
          throw new Error(
            "Expected branch to point to abc123 but it points to xyz789"
          );
        }
        return JSON.stringify({
          data: {
            createCommitOnBranch: {
              commit: { oid: "successsha" },
            },
          },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test OID mismatch",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
        retries: 1,
      };

      const result = await strategy.commit(options);

      assert.equal(result.sha, "successsha");
      assert.equal(
        graphqlCallCount,
        3,
        `Expected exactly 3 GraphQL calls (queryRemoteRef + 1 OID mismatch + 1 success), got ${graphqlCallCount}`
      );
    });

    test("sanitizes error messages to exclude GraphQL payload", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");

      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      const hugePayload = "x".repeat(100_000);
      const errorMessage = `Command failed: echo '${hugePayload}' | gh api graphql --input -\ngh: Resource not accessible by integration (createCommitOnBranch)`;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse; // queryRemoteRef
        throw new Error(errorMessage); // createCommitOnBranch
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
      };

      try {
        await strategy.commit(options);
        assert.fail("Should have thrown");
      } catch (error) {
        const err = error as Error;
        // Error should NOT contain the huge payload
        assert.ok(
          err.message.length < 1000,
          `Error message should be concise, got ${err.message.length} chars`
        );
        // Error should contain the meaningful stderr
        assert.ok(
          err.message.includes("Resource not accessible by integration"),
          `Should include meaningful error. Got: ${err.message}`
        );
        // Error should identify the repo
        assert.ok(
          err.message.includes("owner/repo"),
          `Should identify the repo. Got: ${err.message}`
        );
      }
    });

    test("sanitized OID mismatch errors are still retryable by outer loop", async () => {
      let revParseCallCount = 0;

      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", () => {
        revParseCallCount++;
        if (revParseCallCount <= 1) {
          return "oldsha123";
        }
        return "newsha456";
      });

      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      const hugePayload = "y".repeat(50_000);
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse; // queryRemoteRef
        if (graphqlCallCount === 2) {
          throw new Error(
            `Command failed: echo '${hugePayload}' | gh api graphql --input -\nExpected branch to point to abc123 but it points to xyz789`
          );
        }
        return JSON.stringify({
          data: {
            createCommitOnBranch: {
              commit: { oid: "successsha" },
            },
          },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test OID retry with sanitization",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
        retries: 3,
      };

      const result = await strategy.commit(options);

      assert.equal(result.sha, "successsha");
      assert.ok(
        graphqlCallCount >= 3,
        "Should have retried after sanitized OID mismatch error"
      );
    });

    test("does not include GH_TOKEN prefix when no token is provided", async () => {
      // When no token is provided, rely on gh CLI's default authentication
      const queryRefResponse = JSON.stringify({
        data: {
          repository: {
            id: "R_repo123",
            ref: { id: "REF_existing", target: { oid: "abc123" } },
          },
        },
      });
      const commitResponse = JSON.stringify({
        data: {
          createCommitOnBranch: { commit: { oid: "newsha123" } },
        },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return commitResponse;
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "test-branch",
        message: "Test commit",
        fileChanges: [{ path: "file.txt", content: "content" }],
        workDir: testDir,
        // No token provided
      };

      await strategy.commit(options);

      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      assert.ok(
        graphqlCalls.length >= 2,
        "Should have called gh api graphql at least twice"
      );

      // No command should include GH_TOKEN and env should not have it
      for (const call of graphqlCalls) {
        assert.ok(
          !call.command.includes("GH_TOKEN"),
          "GraphQL command should not have token in command string"
        );
        assert.strictEqual(
          call.options?.env,
          undefined,
          "GraphQL command should not pass env when no token provided"
        );
      }
    });

    test("skips modeOnly entries from GraphQL payload", async () => {
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const queryRefResponse = JSON.stringify({
        data: { repository: { id: "R_test", ref: { id: "REF_test" } } },
      });
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryRefResponse;
        return JSON.stringify({
          data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const result = await strategy.commit({
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Mixed commit",
        fileChanges: [
          { path: "normal.txt", content: "hello" },
          {
            path: "scripts/run",
            content: null,
            mode: "100755" as const,
            modeOnly: true as const,
          },
        ],
        workDir: testDir,
      });

      assert.equal(result.sha, "sha123");
      const commitCall = mockExecutor.calls.find((c) =>
        c.command.includes("createCommitOnBranch")
      );
      assert.ok(commitCall);
      assert.ok(
        !commitCall.command.includes("scripts/run"),
        "modeOnly entry should not appear in GraphQL payload"
      );
      assert.ok(
        commitCall.command.includes("normal.txt"),
        "content entry should appear in GraphQL payload"
      );
    });

    test("throws when all entries are modeOnly", async () => {
      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await assert.rejects(
        () =>
          strategy.commit({
            repoInfo: githubRepoInfo,
            branchName: "main",
            message: "Mode-only commit",
            fileChanges: [
              {
                path: "scripts/run",
                content: null,
                mode: "100755" as const,
                modeOnly: true as const,
              },
            ],
            workDir: testDir,
          }),
        /no content changes to commit/i
      );
      // Should not have made any GraphQL API calls
      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      assert.equal(
        graphqlCalls.length,
        0,
        "Should not call GraphQL API when all entries are modeOnly"
      );
    });
  });

  describe("ensureBranchExistsOnRemote (GraphQL ref operations)", () => {
    test("creates branch via GraphQL createRef when branch does not exist", async () => {
      const queryResponse = JSON.stringify({
        data: {
          repository: { id: "R_repo123", ref: null },
        },
      });
      const createRefResponse = JSON.stringify({
        data: { createRef: { clientMutationId: null } },
      });
      const commitResponse = JSON.stringify({
        data: { createCommitOnBranch: { commit: { oid: "newcommitsha" } } },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "abc123def456");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "abc123def456");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        if (graphqlCallCount === 2) return createRefResponse;
        return commitResponse;
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const result = await strategy.commit({
        repoInfo: githubRepoInfo,
        branchName: "feature-branch",
        message: "Test",
        fileChanges: [{ path: "file.txt", content: "content" }],
        workDir: testDir,
        token: "ghs_test_token",
      });

      assert.equal(result.sha, "newcommitsha");

      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      assert.ok(
        graphqlCalls.length >= 3,
        `Expected >= 3 GraphQL calls, got ${graphqlCalls.length}`
      );
      assert.ok(
        graphqlCalls[0].command.includes("repository(owner:"),
        "First call should be queryRemoteRef"
      );
      assert.ok(
        graphqlCalls[1].command.includes("createRef"),
        "Second call should be createRef"
      );

      // No git push or git ls-remote calls
      const pushCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("git push")
      );
      assert.equal(pushCalls.length, 0, "Should NOT use git push");
      const lsRemoteCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("git ls-remote")
      );
      assert.equal(lsRemoteCalls.length, 0, "Should NOT use git ls-remote");
    });

    test("deletes and recreates branch via GraphQL when force=true and branch exists", async () => {
      const queryResponse = JSON.stringify({
        data: {
          repository: { id: "R_repo123", ref: { id: "REF_existing456" } },
        },
      });
      const deleteRefResponse = JSON.stringify({
        data: { deleteRef: { clientMutationId: null } },
      });
      const createRefResponse = JSON.stringify({
        data: { createRef: { clientMutationId: null } },
      });
      const commitResponse = JSON.stringify({
        data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "headsha123");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "headsha123");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        if (graphqlCallCount === 2) return deleteRefResponse;
        if (graphqlCallCount === 3) return createRefResponse;
        return commitResponse;
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const result = await strategy.commit({
        repoInfo: githubRepoInfo,
        branchName: "feature-branch",
        message: "Test",
        fileChanges: [{ path: "file.txt", content: "content" }],
        workDir: testDir,
        force: true,
        token: "ghs_test_token",
      });

      assert.equal(result.sha, "sha123");
      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      assert.ok(
        graphqlCalls.length >= 4,
        `Expected >= 4 GraphQL calls, got ${graphqlCalls.length}`
      );
      assert.ok(
        graphqlCalls[1].command.includes("deleteRef"),
        "Second call should be deleteRef"
      );
      assert.ok(
        graphqlCalls[2].command.includes("createRef"),
        "Third call should be createRef"
      );
      const pushCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("git push")
      );
      assert.equal(pushCalls.length, 0, "Should NOT use git push");
    });

    test("does not delete or create ref when force=false and branch exists", async () => {
      const queryResponse = JSON.stringify({
        data: {
          repository: { id: "R_repo123", ref: { id: "REF_existing456" } },
        },
      });
      const commitResponse = JSON.stringify({
        data: { createCommitOnBranch: { commit: { oid: "sha123" } } },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "abc123");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        return commitResponse;
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const result = await strategy.commit({
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Direct commit",
        fileChanges: [{ path: "file.txt", content: "content" }],
        workDir: testDir,
        force: false,
        token: "ghs_test_token",
      });

      assert.equal(result.sha, "sha123");
      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      assert.equal(
        graphqlCalls.length,
        2,
        `Expected 2 GraphQL calls, got ${graphqlCalls.length}`
      );
      assert.ok(
        !graphqlCalls.some((c) => c.command.includes("deleteRef")),
        "Should NOT call deleteRef"
      );
      assert.ok(
        !graphqlCalls.some((c) => c.command.includes("createRef")),
        "Should NOT call createRef"
      );
    });

    test("includes --hostname flag for GitHub Enterprise in ref operations", async () => {
      const queryResponse = JSON.stringify({
        data: { repository: { id: "R_ghe_repo", ref: null } },
      });
      const createRefResponse = JSON.stringify({
        data: { createRef: { clientMutationId: null } },
      });
      const commitResponse = JSON.stringify({
        data: { createCommitOnBranch: { commit: { oid: "ghesha" } } },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "gheheadsha");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "gheheadsha");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        if (graphqlCallCount === 2) return createRefResponse;
        return commitResponse;
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await strategy.commit({
        repoInfo: gheRepoInfo,
        branchName: "feature",
        message: "GHE commit",
        fileChanges: [{ path: "file.txt", content: "content" }],
        workDir: testDir,
        token: "ghs_ghe_token",
      });

      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      for (const call of graphqlCalls) {
        assert.ok(
          call.command.includes("--hostname") &&
            call.command.includes("github.enterprise.com"),
          `GraphQL call should include GHE hostname: ${call.command.substring(0, 100)}...`
        );
      }
    });

    test("propagates GraphQL query error from queryRemoteRef", async () => {
      mockExecutor.responses.set("gh api graphql", () => {
        throw new Error(
          "Command failed: gh api graphql\nGraphQL: Could not resolve to a Repository"
        );
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await assert.rejects(
        () =>
          strategy.commit({
            repoInfo: githubRepoInfo,
            branchName: "feature",
            message: "Test",
            fileChanges: [{ path: "f.txt", content: "c" }],
            workDir: testDir,
            token: "ghs_token",
          }),
        /Could not resolve|GraphQL|failed/i,
        "Should propagate queryRemoteRef errors"
      );
    });

    test("propagates createRef failure after deleteRef success", async () => {
      const queryResponse = JSON.stringify({
        data: { repository: { id: "R_repo123", ref: { id: "REF_existing" } } },
      });
      const deleteRefResponse = JSON.stringify({
        data: { deleteRef: { clientMutationId: null } },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "headsha");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "headsha");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        if (graphqlCallCount === 2) return deleteRefResponse;
        // createRef fails
        throw new Error(
          "Command failed: gh api graphql\nGraphQL: Name already exists"
        );
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await assert.rejects(
        () =>
          strategy.commit({
            repoInfo: githubRepoInfo,
            branchName: "feature-branch",
            message: "Test",
            fileChanges: [{ path: "f.txt", content: "c" }],
            workDir: testDir,
            force: true,
            token: "ghs_token",
          }),
        /Name already exists|GraphQL|failed/i,
        "Should propagate createRef error even after successful deleteRef"
      );
    });

    test("throws when queryRemoteRef response contains GraphQL errors", async () => {
      // queryRemoteRef returns a successful HTTP response but with GraphQL errors in the body
      mockExecutor.responses.set("gh api graphql", () => {
        return JSON.stringify({
          errors: [
            { message: "Field 'repository' doesn't exist on type 'Query'" },
          ],
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await assert.rejects(
        () =>
          strategy.commit({
            repoInfo: githubRepoInfo,
            branchName: "feature",
            message: "Test",
            fileChanges: [{ path: "f.txt", content: "c" }],
            workDir: testDir,
            token: "ghs_token",
          }),
        /Field 'repository'/,
        "Should throw error with GraphQL error messages from queryRemoteRef"
      );
    });

    test("throws when queryRemoteRef response is missing repositoryId", async () => {
      // queryRemoteRef returns a valid response but without repository.id
      mockExecutor.responses.set("gh api graphql", () => {
        return JSON.stringify({
          data: { repository: null },
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await assert.rejects(
        () =>
          strategy.commit({
            repoInfo: githubRepoInfo,
            branchName: "feature",
            message: "Test",
            fileChanges: [{ path: "f.txt", content: "c" }],
            workDir: testDir,
            token: "ghs_token",
          }),
        /missing repository ID.*owner\/repo/,
        "Should throw error about missing repository ID"
      );
    });

    test("throws when createRemoteRef response contains GraphQL errors", async () => {
      // queryRemoteRef succeeds (branch doesn't exist), but createRef returns GraphQL errors
      const queryResponse = JSON.stringify({
        data: { repository: { id: "R_repo123", ref: null } },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "headsha123");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "headsha123");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        // createRef returns GraphQL errors in body (not thrown)
        return JSON.stringify({
          errors: [{ message: "Name already exists on this repository" }],
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await assert.rejects(
        () =>
          strategy.commit({
            repoInfo: githubRepoInfo,
            branchName: "feature-branch",
            message: "Test",
            fileChanges: [{ path: "f.txt", content: "c" }],
            workDir: testDir,
            token: "ghs_token",
          }),
        /Name already exists/,
        "Should throw GraphQL error from createRemoteRef response body"
      );
    });

    test("succeeds when createRef fails with 'already exists' (fork race condition)", async () => {
      // Simulates: queryRemoteRef returns null (fork not propagated),
      // createRef fails with "already exists" — should succeed, not throw
      const queryResponse = JSON.stringify({
        data: { repository: { id: "R_fork123", ref: null } },
      });
      const commitResponse = JSON.stringify({
        data: { createCommitOnBranch: { commit: { oid: "forkcommitsha" } } },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "headsha");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "headsha");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        if (graphqlCallCount === 2) {
          // createRef fails — branch appeared between query and create
          throw new Error(
            'A ref named "refs/heads/main" already exists in the repository.'
          );
        }
        return commitResponse;
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      const result = await strategy.commit({
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test fork sync",
        fileChanges: [{ path: "f.txt", content: "content" }],
        workDir: testDir,
        token: "ghs_token",
      });

      // Should succeed — "already exists" is treated as the branch being ready
      assert.equal(result.sha, "forkcommitsha");
    });

    test("re-throws non-'already exists' errors from createRef", async () => {
      const queryResponse = JSON.stringify({
        data: { repository: { id: "R_repo123", ref: null } },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "headsha");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        throw new Error("Internal server error");
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await assert.rejects(
        () =>
          strategy.commit({
            repoInfo: githubRepoInfo,
            branchName: "feature",
            message: "Test",
            fileChanges: [{ path: "f.txt", content: "c" }],
            workDir: testDir,
            token: "ghs_token",
          }),
        /Internal server error/,
        "Should re-throw non-'already exists' errors"
      );
    });

    test("deleteRemoteRef uses --hostname for GitHub Enterprise", async () => {
      // force=true with existing branch triggers deleteRef + createRef
      const queryResponse = JSON.stringify({
        data: {
          repository: { id: "R_ghe_repo", ref: { id: "REF_ghe_existing" } },
        },
      });
      const deleteRefResponse = JSON.stringify({
        data: { deleteRef: { clientMutationId: null } },
      });
      const createRefResponse = JSON.stringify({
        data: { createRef: { clientMutationId: null } },
      });
      const commitResponse = JSON.stringify({
        data: { createCommitOnBranch: { commit: { oid: "ghesha" } } },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "gheheadsha");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "gheheadsha");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        if (graphqlCallCount === 2) return deleteRefResponse;
        if (graphqlCallCount === 3) return createRefResponse;
        return commitResponse;
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await strategy.commit({
        repoInfo: gheRepoInfo,
        branchName: "feature",
        message: "GHE force commit",
        fileChanges: [{ path: "file.txt", content: "content" }],
        workDir: testDir,
        force: true,
        token: "ghs_ghe_token",
      });

      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      // The deleteRef call (second graphql call) should include --hostname
      assert.ok(
        graphqlCalls[1].command.includes("deleteRef"),
        "Second call should be deleteRef"
      );
      assert.ok(
        graphqlCalls[1].command.includes("--hostname") &&
          graphqlCalls[1].command.includes("github.enterprise.com"),
        "deleteRef call should include GHE hostname"
      );
    });

    test("deleteRemoteRef sanitizes and rethrows executor errors", async () => {
      // force=true with existing branch triggers deleteRef, which throws
      const queryResponse = JSON.stringify({
        data: {
          repository: { id: "R_repo123", ref: { id: "REF_existing" } },
        },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "headsha");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "headsha");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        // deleteRef call throws (executor error)
        const hugePayload = "z".repeat(50_000);
        throw new Error(
          `Command failed: echo '${hugePayload}' | gh api graphql --input -\ngh: Permission denied (HTTP 403)`
        );
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      try {
        await strategy.commit({
          repoInfo: githubRepoInfo,
          branchName: "feature-branch",
          message: "Test",
          fileChanges: [{ path: "f.txt", content: "c" }],
          workDir: testDir,
          force: true,
          token: "ghs_token",
        });
        assert.fail("Should have thrown");
      } catch (error) {
        const err = error as Error;
        // Error should be sanitized (no huge payload)
        assert.ok(
          err.message.length < 1000,
          `Error should be concise, got ${err.message.length} chars`
        );
        // Error should contain the meaningful part
        assert.ok(
          err.message.includes("Permission denied") ||
            err.message.includes("403"),
          `Should include meaningful error. Got: ${err.message}`
        );
        assert.ok(
          err.message.includes("owner/repo"),
          `Should identify the repo. Got: ${err.message}`
        );
      }
    });

    test("throws when deleteRemoteRef response contains GraphQL errors", async () => {
      // force=true with existing branch triggers deleteRef, which returns GraphQL errors in body
      const queryResponse = JSON.stringify({
        data: {
          repository: { id: "R_repo123", ref: { id: "REF_existing" } },
        },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "headsha");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "headsha");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        // deleteRef returns GraphQL errors in body (not thrown)
        return JSON.stringify({
          errors: [{ message: "Cannot delete a protected ref" }],
        });
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await assert.rejects(
        () =>
          strategy.commit({
            repoInfo: githubRepoInfo,
            branchName: "main",
            message: "Test",
            fileChanges: [{ path: "f.txt", content: "c" }],
            workDir: testDir,
            force: true,
            token: "ghs_token",
          }),
        /Cannot delete a protected ref/,
        "Should throw GraphQL error from deleteRemoteRef response body"
      );
    });

    test("uses token in GraphQL ref operation commands", async () => {
      const queryResponse = JSON.stringify({
        data: { repository: { id: "R_repo", ref: null } },
      });
      const createRefResponse = JSON.stringify({
        data: { createRef: { clientMutationId: null } },
      });
      const commitResponse = JSON.stringify({
        data: { createCommitOnBranch: { commit: { oid: "sha" } } },
      });

      let graphqlCallCount = 0;
      mockExecutor.responses.set("git rev-parse HEAD", "headsha");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin/", "headsha");
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) return queryResponse;
        if (graphqlCallCount === 2) return createRefResponse;
        return commitResponse;
      });

      const strategy = new GraphQLCommitStrategy(mockExecutor.mock);
      await strategy.commit({
        repoInfo: githubRepoInfo,
        branchName: "feature",
        message: "Test",
        fileChanges: [{ path: "f.txt", content: "c" }],
        workDir: testDir,
        token: "ghs_my_secret_token",
      });

      const graphqlCalls = mockExecutor.calls.filter((c) =>
        c.command.includes("gh api graphql")
      );
      // First two calls are ref operations (query + create)
      for (let i = 0; i < 2; i++) {
        assert.ok(
          !graphqlCalls[i].command.includes("GH_TOKEN"),
          `GraphQL ref call ${i} should not have token in command string`
        );
        assert.strictEqual(
          graphqlCalls[i].options?.env?.GH_TOKEN,
          "ghs_my_secret_token",
          `GraphQL ref call ${i} should pass token via env`
        );
      }
    });
  });
});
