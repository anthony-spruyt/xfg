import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  GraphQLCommitStrategy,
  MAX_PAYLOAD_SIZE,
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
      // Mock git rev-parse to return HEAD SHA
      mockExecutor.responses.set("git rev-parse HEAD", "abc123def456789");

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

    test("base64 encodes file contents", async () => {
      mockExecutor.responses.set("git rev-parse HEAD", "abc123");
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
      mockExecutor.responses.set("git rev-parse HEAD", "abc123");
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
      mockExecutor.responses.set("git rev-parse HEAD", "abc123");

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
      mockExecutor.responses.set("git rev-parse HEAD", "abc123");
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

    test("retries on expectedHeadOid mismatch", async () => {
      let callCount = 0;

      // Mock git rev-parse to return different SHAs
      mockExecutor.responses.set("git rev-parse HEAD", () => {
        callCount++;
        if (callCount <= 2) {
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
      mockExecutor.responses.set("git rev-parse HEAD", "abc123");
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

    test("throws error when GraphQL response contains errors", async () => {
      mockExecutor.responses.set("git rev-parse HEAD", "abc123");
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
      mockExecutor.responses.set("git rev-parse HEAD", "abc123");
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
  });
});
