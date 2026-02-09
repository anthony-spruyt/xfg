import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BranchManager } from "../../../src/sync/branch-manager.js";
import {
  createMockAuthenticatedGitOps,
  createMockLogger,
  createMockExecutor,
} from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/repo-detector.js";

const testDir = join(tmpdir(), "branch-manager-test-" + Date.now());

describe("BranchManager", () => {
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

  describe("setupBranch", () => {
    test("creates branch for non-direct mode", async () => {
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({});

      const manager = new BranchManager();
      await manager.setupBranch({
        repoInfo: mockRepoInfo,
        branchName: "chore/sync-config",
        baseBranch: "main",
        workDir,
        isDirectMode: false,
        dryRun: false,
        retries: 3,
        gitOps: mockGitOps,
        log: mockLogger,
        executor: mockExecutor,
      });

      assert.equal(calls.createBranch.length, 1);
      assert.equal(calls.createBranch[0].branchName, "chore/sync-config");
    });

    test("skips branch creation for direct mode", async () => {
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({});

      const manager = new BranchManager();
      await manager.setupBranch({
        repoInfo: mockRepoInfo,
        branchName: "chore/sync-config",
        baseBranch: "main",
        workDir,
        isDirectMode: true,
        dryRun: false,
        retries: 3,
        gitOps: mockGitOps,
        log: mockLogger,
        executor: mockExecutor,
      });

      assert.equal(calls.createBranch.length, 0);
    });

    test("skips PR cleanup in dryRun mode", async () => {
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({});

      const manager = new BranchManager();
      await manager.setupBranch({
        repoInfo: mockRepoInfo,
        branchName: "chore/sync-config",
        baseBranch: "main",
        workDir,
        isDirectMode: false,
        dryRun: true,
        retries: 3,
        gitOps: mockGitOps,
        log: mockLogger,
        executor: mockExecutor,
      });

      // Should not have fetched with prune (which happens after PR cleanup)
      const pruneFetches = calls.fetch.filter((c) => c.options?.prune === true);
      assert.equal(pruneFetches.length, 0);
      // Branch should still be created (needed for dry-run diff)
      assert.equal(calls.createBranch.length, 1);
    });
  });
});
