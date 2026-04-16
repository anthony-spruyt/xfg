import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepositorySession } from "../../../src/sync/repository-session.js";
import {
  createMockAuthenticatedGitOps,
  createMockLogger,
} from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/repo/detector.js";
import type { GitOpsFactory } from "../../../src/sync/types.js";
import type { GitAuthOptions } from "../../../src/vcs/types.js";
import type { ICommandExecutor } from "../../../src/shared/command-executor.js";

const mockExecutor: ICommandExecutor = { exec: async () => "" };

const testDir = join(tmpdir(), "repository-session-test-" + Date.now());

describe("RepositorySession", () => {
  let workDir: string;

  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test/repo.git",
    owner: "test",
    repo: "repo",
    host: "github.com",
  };

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("setup", () => {
    test("cleans, clones, and returns context with baseBranch", async () => {
      const { gitOps, localCalls, networkCalls } =
        createMockAuthenticatedGitOps({
          defaultBranch: { branch: "main", method: "mock" },
        });
      const { mock: mockLogger } = createMockLogger();

      const gitOpsFactory: GitOpsFactory = () => gitOps;
      const session = new RepositorySession(gitOpsFactory, mockLogger);

      const context = await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
        executor: mockExecutor,
      });

      // Verify sequence: clean -> clone
      assert.equal(localCalls.cleanWorkspace.length, 1);
      assert.equal(networkCalls.clone.length, 1);
      assert.equal(networkCalls.clone[0].gitUrl, mockRepoInfo.gitUrl);

      // Verify returned context
      assert.equal(context.baseBranch, "main");
      assert.equal(context.gitOps, gitOps);
      assert.equal(typeof context.cleanup, "function");
    });

    test("passes auth options to factory", async () => {
      const { gitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      let receivedAuth: GitAuthOptions | undefined;
      const gitOpsFactory: GitOpsFactory = (_opts, auth) => {
        receivedAuth = auth;
        return gitOps;
      };

      const session = new RepositorySession(gitOpsFactory, mockLogger);
      const authOptions = {
        token: "test-token",
        host: "github.com",
        owner: "test",
        repo: "repo",
      };

      await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
        executor: mockExecutor,
        authOptions,
      });

      assert.deepEqual(receivedAuth, authOptions);
    });

    test("cleanup function calls cleanWorkspace", async () => {
      const { gitOps, localCalls } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      const session = new RepositorySession(() => gitOps, mockLogger);
      const context = await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
        executor: mockExecutor,
      });

      // Reset call count
      localCalls.cleanWorkspace.length = 0;

      // Call cleanup
      context.cleanup();

      assert.equal(localCalls.cleanWorkspace.length, 1);
    });

    test("cleanup function ignores errors", async () => {
      const { mock: mockLogger } = createMockLogger();
      let cleanupCallCount = 0;

      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
        cleanupError: (callCount: number) => {
          cleanupCallCount = callCount;
          // Only throw on second call (the cleanup call, not the initial setup call)
          if (callCount > 1) {
            return new Error("cleanup failed");
          }
          return undefined;
        },
      });

      const session = new RepositorySession(() => mockGitOps, mockLogger);
      const context = await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
        executor: mockExecutor,
      });

      // Should not throw even when cleanWorkspace throws
      assert.doesNotThrow(() => context.cleanup());
      assert.equal(cleanupCallCount, 2); // Called during setup and cleanup
    });

    test("logs workspace operations", async () => {
      const { gitOps } = createMockAuthenticatedGitOps({
        defaultBranch: { branch: "develop", method: "mock" },
      });
      const { mock: mockLogger, messages } = createMockLogger();

      const session = new RepositorySession(() => gitOps, mockLogger);
      await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
        executor: mockExecutor,
      });

      assert.ok(messages.some((msg) => msg.includes("Cleaning")));
      assert.ok(messages.some((msg) => msg.includes("Cloning")));
      assert.ok(messages.some((msg) => msg.includes("develop")));
    });
  });
});
