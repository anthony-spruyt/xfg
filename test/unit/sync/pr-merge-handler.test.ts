import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PRMergeHandler } from "../../../src/sync/pr-merge-handler.js";
import { createMockLogger, createMockExecutor } from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/repo/detector.js";
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
        git: mockRepoInfo.gitUrl,
        files: [],
      };

      const result = await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        repoConfig,
        options: {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: true,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles,
        repoName: "test/repo",
      });

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
        git: mockRepoInfo.gitUrl,
        files: [],
        prOptions: { merge: "manual" },
      };

      const result = await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        repoConfig,
        options: {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: true,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles,
        repoName: "test/repo",
      });

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
        git: mockRepoInfo.gitUrl,
        files: [],
        prOptions: { merge: "manual" },
      };
      const diffStats = {
        newCount: 1,
        modifiedCount: 2,
        deletedCount: 0,
        unchangedCount: 0,
      };

      const result = await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        repoConfig,
        options: {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: true,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles,
        repoName: "test/repo",
        diffStats,
      });

      assert.deepEqual(result.diffStats, diffStats);
    });

    test("passes labels to createPR", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor, calls } = createMockExecutor({
        responses: new Map([
          ["gh pr list", ""],
          ["gh pr create", "https://github.com/test/repo/pull/1"],
          ["gh pr merge", ""],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);
      const changedFiles: FileAction[] = [
        { fileName: "config.json", action: "create" },
      ];
      const repoConfig: RepoConfig = {
        git: mockRepoInfo.gitUrl,
        files: [],
        prOptions: {
          labels: ["config-sync", "automated"],
        },
      };

      await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        repoConfig,
        options: {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: false,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles,
        repoName: "test/repo",
      });

      const createCall = calls.find((c) => c.command.includes("gh pr create"));
      assert.ok(createCall, "gh pr create should have been called");
      assert.ok(
        createCall.command.includes("--label"),
        "gh pr create should include --label flag"
      );
    });

    test("warns when merge operation fails", async () => {
      const { mock: mockLogger, warnings } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({
        responses: new Map<string, string | Error>([
          ["gh pr list", ""],
          ["gh pr create", "https://github.com/test/repo/pull/1"],
          ["gh api", "true"],
          ["gh pr merge", new Error("merge conflict")],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);
      const changedFiles: FileAction[] = [
        { fileName: "config.json", action: "create" },
      ];
      const repoConfig: RepoConfig = {
        git: mockRepoInfo.gitUrl,
        files: [],
      };

      const result = await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        repoConfig,
        options: {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: false,
          retries: 0,
          executor: mockExecutor,
        },
        changedFiles,
        repoName: "test/repo",
      });

      assert.equal(result.success, true);
      assert.ok(
        warnings.some((msg) => msg.includes("Merge operation failed")),
        `should warn about merge failure, got warnings: ${JSON.stringify(warnings)}`
      );
      assert.equal(result.mergeResult?.merged, false);
    });
  });
});
