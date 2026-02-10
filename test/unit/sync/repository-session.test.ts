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
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import type { GitOpsFactory } from "../../../src/sync/types.js";
import type { GitAuthOptions } from "../../../src/vcs/authenticated-git-ops.js";
import type { IAuthenticatedGitOps } from "../../../src/vcs/authenticated-git-ops.js";

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
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        defaultBranch: { branch: "main", method: "mock" },
      });
      const { mock: mockLogger } = createMockLogger();

      const gitOpsFactory = () => mockGitOps;
      const session = new RepositorySession(gitOpsFactory, mockLogger);

      const context = await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
      });

      // Verify sequence: clean -> clone
      assert.equal(calls.cleanWorkspace.length, 1);
      assert.equal(calls.clone.length, 1);
      assert.equal(calls.clone[0].gitUrl, mockRepoInfo.gitUrl);

      // Verify returned context
      assert.equal(context.baseBranch, "main");
      assert.equal(context.gitOps, mockGitOps);
      assert.equal(typeof context.cleanup, "function");
    });

    test("passes auth options to factory", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      let receivedAuth: GitAuthOptions | undefined;
      const gitOpsFactory: GitOpsFactory = (_opts, auth) => {
        receivedAuth = auth;
        return mockGitOps;
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
        authOptions,
      });

      assert.deepEqual(receivedAuth, authOptions);
    });

    test("cleanup function calls cleanWorkspace", async () => {
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      const session = new RepositorySession(() => mockGitOps, mockLogger);
      const context = await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
      });

      // Reset call count
      calls.cleanWorkspace.length = 0;

      // Call cleanup
      context.cleanup();

      assert.equal(calls.cleanWorkspace.length, 1);
    });

    test("cleanup function ignores errors", async () => {
      const { mock: mockLogger } = createMockLogger();
      let cleanupCallCount = 0;

      const mockGitOps = {
        cleanWorkspace: () => {
          cleanupCallCount++;
          // Only throw on second call (the cleanup call, not the initial setup call)
          if (cleanupCallCount > 1) {
            throw new Error("cleanup failed");
          }
        },
        clone: async () => {},
        getDefaultBranch: async () => ({ branch: "main", method: "remote" }),
      };

      const session = new RepositorySession(
        () => mockGitOps as IAuthenticatedGitOps,
        mockLogger
      );
      const context = await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
      });

      // Should not throw even when cleanWorkspace throws
      assert.doesNotThrow(() => context.cleanup());
      assert.equal(cleanupCallCount, 2); // Called during setup and cleanup
    });

    test("logs workspace operations", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        defaultBranch: { branch: "develop", method: "mock" },
      });
      const { mock: mockLogger, messages } = createMockLogger();

      const session = new RepositorySession(() => mockGitOps, mockLogger);
      await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
      });

      assert.ok(messages.some((msg) => msg.includes("Cleaning")));
      assert.ok(messages.some((msg) => msg.includes("Cloning")));
      assert.ok(messages.some((msg) => msg.includes("develop")));
    });
  });
});
