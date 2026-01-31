import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  GraphQLCommitStrategy,
  MAX_PAYLOAD_SIZE,
  SAFE_BRANCH_NAME_PATTERN,
  validateBranchName,
} from "./graphql-commit-strategy.js";
import { GitHubRepoInfo, AzureDevOpsRepoInfo } from "../repo-detector.js";
import { CommitOptions } from "./commit-strategy.js";
import { CommandExecutor } from "../command-executor.js";

const testDir = join(process.cwd(), "test-graphql-commit-strategy-tmp");

// Mock executor for testing - implements CommandExecutor interface
function createMockExecutor(): CommandExecutor & {
  calls: Array<{ command: string; cwd: string }>;
  responses: Map<string, string | Error | (() => string | Error)>;
  reset: () => void;
} {
  const calls: Array<{ command: string; cwd: string }> = [];
  const responses = new Map<string, string | Error | (() => string | Error)>();

  return {
    calls,
    responses,
    async exec(command: string, cwd: string): Promise<string> {
      calls.push({ command, cwd });

      // Check for matching response
      for (const [pattern, response] of responses) {
        if (command.includes(pattern)) {
          const result = typeof response === "function" ? response() : response;
          if (result instanceof Error) {
            throw result;
          }
          return result;
        }
      }

      // Default: return empty string
      return "";
    },
    reset(): void {
      calls.length = 0;
      responses.clear();
    },
  };
}

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

describe("validateBranchName", () => {
  test("does not throw for valid branch names", () => {
    assert.doesNotThrow(() => validateBranchName("main"));
    assert.doesNotThrow(() => validateBranchName("feature/login"));
    assert.doesNotThrow(() => validateBranchName("fix-bug-123"));
  });

  test("throws for invalid branch names", () => {
    assert.throws(
      () => validateBranchName("branch name"),
      /Invalid branch name/
    );
    assert.throws(
      () => validateBranchName("branch;rm -rf"),
      /Invalid branch name/
    );
    assert.throws(() => validateBranchName("-invalid"), /Invalid branch name/);
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

  let mockExecutor: ReturnType<typeof createMockExecutor>;

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
      // Mock git ls-remote to indicate branch exists
      mockExecutor.responses.set(
        "git ls-remote",
        "abc123\trefs/heads/test-branch"
      );
      // Mock git fetch
      mockExecutor.responses.set("git fetch", "");
      // Mock git rev-parse origin/branch to return remote HEAD SHA
      mockExecutor.responses.set("git rev-parse origin", "abc123def456789");

      // Mock successful GraphQL response
      const graphqlResponse = JSON.stringify({
        data: {
          createCommitOnBranch: {
            commit: {
              oid: "newcommitsha123",
            },
          },
        },
      });
      mockExecutor.responses.set("gh api graphql", graphqlResponse);

      const strategy = new GraphQLCommitStrategy(mockExecutor);
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
      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("gh api graphql")
      );
      assert.ok(graphqlCall, "Should have called gh api graphql");
      assert.ok(
        graphqlCall.command.includes("createCommitOnBranch"),
        "Should use createCommitOnBranch mutation"
      );
      assert.ok(
        graphqlCall.command.includes("owner/repo"),
        "Should include repositoryNameWithOwner"
      );
      assert.ok(
        graphqlCall.command.includes("test-branch"),
        "Should include branch name"
      );
      assert.ok(
        graphqlCall.command.includes("abc123def456789"),
        "Should include expectedHeadOid"
      );
    });

    test("does not include empty deletions array in payload", async () => {
      mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/main");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const graphqlResponse = JSON.stringify({
        data: {
          createCommitOnBranch: {
            commit: { oid: "sha123" },
          },
        },
      });
      mockExecutor.responses.set("gh api graphql", graphqlResponse);

      const strategy = new GraphQLCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Add file",
        fileChanges: [{ path: "test.txt", content: "content" }], // Only additions, no deletions
        workDir: testDir,
      };

      await strategy.commit(options);

      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("gh api graphql")
      );
      assert.ok(graphqlCall, "Should have called gh api graphql");

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
      mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/main");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const graphqlResponse = JSON.stringify({
        data: {
          createCommitOnBranch: {
            commit: { oid: "sha123" },
          },
        },
      });
      mockExecutor.responses.set("gh api graphql", graphqlResponse);

      const strategy = new GraphQLCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Delete file",
        fileChanges: [{ path: "to-delete.txt", content: null }], // Deletion
        workDir: testDir,
      };

      await strategy.commit(options);

      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("gh api graphql")
      );
      assert.ok(graphqlCall, "Should have called gh api graphql");

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
      mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/main");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const graphqlResponse = JSON.stringify({
        data: {
          createCommitOnBranch: {
            commit: { oid: "sha123" },
          },
        },
      });
      mockExecutor.responses.set("gh api graphql", graphqlResponse);

      const strategy = new GraphQLCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Add file",
        fileChanges: [{ path: "test.txt", content: "Hello, World!" }],
        workDir: testDir,
      };

      await strategy.commit(options);

      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("gh api graphql")
      );
      assert.ok(graphqlCall, "Should have called gh api graphql");

      // "Hello, World!" in base64 is "SGVsbG8sIFdvcmxkIQ=="
      const expectedBase64 = Buffer.from("Hello, World!").toString("base64");
      assert.ok(
        graphqlCall.command.includes(expectedBase64),
        `Should include base64 encoded content. Expected: ${expectedBase64}`
      );
    });

    test("handles file deletions", async () => {
      mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/main");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const graphqlResponse = JSON.stringify({
        data: {
          createCommitOnBranch: {
            commit: { oid: "sha123" },
          },
        },
      });
      mockExecutor.responses.set("gh api graphql", graphqlResponse);

      const strategy = new GraphQLCommitStrategy(mockExecutor);
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
        c.command.includes("gh api graphql")
      );
      assert.ok(graphqlCall, "Should have called gh api graphql");

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
      mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/main");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");

      const strategy = new GraphQLCommitStrategy(mockExecutor);

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
      mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/main");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      const graphqlResponse = JSON.stringify({
        data: {
          createCommitOnBranch: {
            commit: { oid: "sha123" },
          },
        },
      });
      mockExecutor.responses.set("gh api graphql", graphqlResponse);

      const strategy = new GraphQLCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: gheRepoInfo,
        branchName: "main",
        message: "GHE commit",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
      };

      await strategy.commit(options);

      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("gh api graphql")
      );
      assert.ok(graphqlCall, "Should have called gh api graphql");
      assert.ok(
        graphqlCall.command.includes("--hostname"),
        "Should include --hostname flag"
      );
      assert.ok(
        graphqlCall.command.includes("--hostname 'github.enterprise.com'"),
        "Should include GHE hostname"
      );
    });

    test("pushes branch to remote if it does not exist", async () => {
      // Mock git ls-remote to fail (branch doesn't exist)
      mockExecutor.responses.set(
        "git ls-remote",
        new Error("fatal: could not read from remote")
      );
      // Mock git push to create branch
      mockExecutor.responses.set("git push", "");
      // Mock git fetch
      mockExecutor.responses.set("git fetch", "");
      // Mock git rev-parse origin/branch
      mockExecutor.responses.set("git rev-parse origin", "abc123");

      const graphqlResponse = JSON.stringify({
        data: {
          createCommitOnBranch: {
            commit: { oid: "sha123" },
          },
        },
      });
      mockExecutor.responses.set("gh api graphql", graphqlResponse);

      const strategy = new GraphQLCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "feature-branch",
        message: "Add feature",
        fileChanges: [{ path: "feature.txt", content: "feature" }],
        workDir: testDir,
      };

      const result = await strategy.commit(options);
      assert.equal(result.sha, "sha123");

      // Verify push was called to create the branch
      const pushCall = mockExecutor.calls.find((c) =>
        c.command.includes("git push")
      );
      assert.ok(pushCall, "Should have pushed the branch to create it");
      assert.ok(
        pushCall.command.includes("origin HEAD:feature-branch"),
        "Should push to the correct branch"
      );
    });

    test("retries on expectedHeadOid mismatch", async () => {
      let revParseCallCount = 0;

      // Mock git ls-remote to indicate branch exists
      mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/main");
      // Mock git fetch
      mockExecutor.responses.set("git fetch", "");
      // Mock git rev-parse origin/branch to return different SHAs on each call
      mockExecutor.responses.set("git rev-parse origin", () => {
        revParseCallCount++;
        if (revParseCallCount <= 1) {
          return "oldsha123";
        }
        return "newsha456";
      });

      // First GraphQL call fails with OID mismatch, second succeeds
      let graphqlCallCount = 0;
      mockExecutor.responses.set("gh api graphql", () => {
        graphqlCallCount++;
        if (graphqlCallCount === 1) {
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

      const strategy = new GraphQLCommitStrategy(mockExecutor);
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
      assert.ok(graphqlCallCount >= 2, "Should have retried GraphQL call");
    });

    test("throws descriptive error for permission denied", async () => {
      mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/main");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      mockExecutor.responses.set(
        "gh api graphql",
        new Error(
          "GraphQL: Resource not accessible by integration (createCommitOnBranch)"
        )
      );

      const strategy = new GraphQLCommitStrategy(mockExecutor);
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
      const strategy = new GraphQLCommitStrategy(mockExecutor);
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
      const strategy = new GraphQLCommitStrategy(mockExecutor);
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
      mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/main");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      mockExecutor.responses.set(
        "gh api graphql",
        JSON.stringify({
          errors: [
            { message: "Validation failed" },
            { message: "Branch not found" },
          ],
        })
      );

      const strategy = new GraphQLCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "main",
        message: "Test",
        fileChanges: [{ path: "test.txt", content: "content" }],
        workDir: testDir,
      };

      await assert.rejects(
        () => strategy.commit(options),
        /GraphQL error.*Validation failed.*Branch not found/,
        "Should throw error with all GraphQL error messages"
      );
    });

    test("throws error when GraphQL response missing commit OID", async () => {
      mockExecutor.responses.set("git ls-remote", "abc123\trefs/heads/main");
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123");
      mockExecutor.responses.set(
        "gh api graphql",
        JSON.stringify({
          data: {
            createCommitOnBranch: {
              commit: null, // Missing OID
            },
          },
        })
      );

      const strategy = new GraphQLCommitStrategy(mockExecutor);
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
      // This test verifies that when a token is passed via the options parameter,
      // it is used in the Authorization header for the GraphQL API call.
      mockExecutor.responses.set(
        "git ls-remote",
        "abc123\trefs/heads/test-branch"
      );
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123def456789");
      mockExecutor.responses.set(
        "gh api graphql",
        JSON.stringify({
          data: {
            createCommitOnBranch: { commit: { oid: "newsha123" } },
          },
        })
      );

      const strategy = new GraphQLCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "test-branch",
        message: "Test commit",
        fileChanges: [{ path: "file.txt", content: "content" }],
        workDir: testDir,
        token: "ghs_test_token_from_parameter",
      };

      await strategy.commit(options);

      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("gh api graphql")
      );
      assert.ok(graphqlCall, "Should have called gh api graphql");

      // The command should include explicit authorization with the provided token
      assert.ok(
        graphqlCall.command.includes("ghs_test_token_from_parameter"),
        "GraphQL command should use the token from options parameter. " +
          `Got: ${graphqlCall.command.substring(0, 200)}...`
      );
      assert.ok(
        graphqlCall.command.includes("Authorization"),
        "GraphQL command should include Authorization header"
      );
    });

    test("does not include Authorization header when no token is provided", async () => {
      // When no token is provided, rely on gh CLI's default authentication
      mockExecutor.responses.set(
        "git ls-remote",
        "abc123\trefs/heads/test-branch"
      );
      mockExecutor.responses.set("git fetch", "");
      mockExecutor.responses.set("git rev-parse origin", "abc123def456789");
      mockExecutor.responses.set(
        "gh api graphql",
        JSON.stringify({
          data: {
            createCommitOnBranch: { commit: { oid: "newsha123" } },
          },
        })
      );

      const strategy = new GraphQLCommitStrategy(mockExecutor);
      const options: CommitOptions = {
        repoInfo: githubRepoInfo,
        branchName: "test-branch",
        message: "Test commit",
        fileChanges: [{ path: "file.txt", content: "content" }],
        workDir: testDir,
        // No token provided
      };

      await strategy.commit(options);

      const graphqlCall = mockExecutor.calls.find((c) =>
        c.command.includes("gh api graphql")
      );
      assert.ok(graphqlCall, "Should have called gh api graphql");

      // The command should NOT include explicit Authorization header
      assert.ok(
        !graphqlCall.command.includes("Authorization"),
        "GraphQL command should not include Authorization header when no token. " +
          `Got: ${graphqlCall.command.substring(0, 200)}...`
      );
    });
  });
});
