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
import type { GitOpsFactory, GitOpsResult } from "../../../src/sync/types.js";
import type {
  GitAuthOptions,
  ILocalGitOps,
  INetworkGitOps,
} from "../../../src/vcs/authenticated-git-ops.js";

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
      const { localOps, networkOps, localCalls, networkCalls } =
        createMockAuthenticatedGitOps({
          defaultBranch: { branch: "main", method: "mock" },
        });
      const { mock: mockLogger } = createMockLogger();

      const gitOpsFactory: GitOpsFactory = () => ({ localOps, networkOps });
      const session = new RepositorySession(gitOpsFactory, mockLogger);

      const context = await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
      });

      // Verify sequence: clean -> clone
      assert.equal(localCalls.cleanWorkspace.length, 1);
      assert.equal(networkCalls.clone.length, 1);
      assert.equal(networkCalls.clone[0].gitUrl, mockRepoInfo.gitUrl);

      // Verify returned context
      assert.equal(context.baseBranch, "main");
      assert.equal(context.localOps, localOps);
      assert.equal(context.networkOps, networkOps);
      assert.equal(typeof context.cleanup, "function");
    });

    test("passes auth options to factory", async () => {
      const { localOps, networkOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      let receivedAuth: GitAuthOptions | undefined;
      const gitOpsFactory: GitOpsFactory = (_opts, auth) => {
        receivedAuth = auth;
        return { localOps, networkOps };
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
      const { localOps, networkOps, localCalls } =
        createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      const session = new RepositorySession(
        () => ({ localOps, networkOps }),
        mockLogger
      );
      const context = await session.setup(mockRepoInfo, {
        workDir,
        dryRun: false,
        retries: 3,
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

      const mockLocalOps = {
        cleanWorkspace: () => {
          cleanupCallCount++;
          // Only throw on second call (the cleanup call, not the initial setup call)
          if (cleanupCallCount > 1) {
            throw new Error("cleanup failed");
          }
        },
      } as ILocalGitOps;

      const mockNetworkOps = {
        clone: async () => {},
        getDefaultBranch: async () => ({ branch: "main", method: "remote" }),
      } as INetworkGitOps;

      const session = new RepositorySession(
        () => ({
          localOps: mockLocalOps,
          networkOps: mockNetworkOps,
        }),
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
      const { localOps, networkOps } = createMockAuthenticatedGitOps({
        defaultBranch: { branch: "develop", method: "mock" },
      });
      const { mock: mockLogger, messages } = createMockLogger();

      const session = new RepositorySession(
        () => ({ localOps, networkOps }),
        mockLogger
      );
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
