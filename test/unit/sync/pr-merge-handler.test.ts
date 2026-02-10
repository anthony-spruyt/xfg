import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PRMergeHandler } from "../../../src/sync/pr-merge-handler.js";
import { createMockLogger, createMockExecutor } from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import type { RepoConfig } from "../../../src/config/types.js";
import type { FileAction } from "../../../src/vcs/pr-creator.js";

const testDir = join(tmpdir(), "pr-merge-handler-test-" + Date.now());

describe("PRMergeHandler", () => {
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

  describe("createAndMerge", () => {
    test("returns success result with PR URL", async () => {
      const { mock: mockLogger, messages } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({
        responses: new Map([
          // gh pr create returns the PR URL
          ["gh pr create", "https://github.com/test/repo/pull/1"],
          // gh pr merge succeeds
          ["gh pr merge", ""],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);
      const changedFiles: FileAction[] = [
        { fileName: "config.json", action: "create" },
      ];
      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [],
      };

      const result = await handler.createAndMerge(
        mockRepoInfo,
        repoConfig,
        {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: true,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles,
        "test/repo"
      );

      assert.equal(result.success, true);
      assert.ok(messages.some((msg) => msg.includes("Creating pull request")));
    });

    test("skips merge when mode is manual", async () => {
      const { mock: mockLogger, messages } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({
        responses: new Map([
          ["gh pr create", "https://github.com/test/repo/pull/1"],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);
      const changedFiles: FileAction[] = [
        { fileName: "config.json", action: "create" },
      ];
      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [],
        prOptions: { merge: "manual" },
      };

      const result = await handler.createAndMerge(
        mockRepoInfo,
        repoConfig,
        {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: true,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles,
        "test/repo"
      );

      assert.equal(result.success, true);
      // Should not see "Handling merge" message
      assert.ok(!messages.some((msg) => msg.includes("Handling merge")));
    });

    test("passes diffStats through to result", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({
        responses: new Map([
          ["gh pr create", "https://github.com/test/repo/pull/1"],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);
      const changedFiles: FileAction[] = [];
      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [],
        prOptions: { merge: "manual" },
      };
      const diffStats = {
        newCount: 1,
        modifiedCount: 2,
        deletedCount: 0,
        unchangedCount: 0,
      };

      const result = await handler.createAndMerge(
        mockRepoInfo,
        repoConfig,
        {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: true,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles,
        "test/repo",
        diffStats
      );

      assert.deepEqual(result.diffStats, diffStats);
    });
  });
});
