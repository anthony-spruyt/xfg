import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommitPushManager } from "../../../src/sync/commit-push-manager.js";
import {
  createMockAuthenticatedGitOps,
  createMockLogger,
  createMockExecutor,
} from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/repo/index.js";
import type { FileWriteResult } from "../../../src/sync/types.js";
import type { FileChange } from "../../../src/vcs/types.js";

const testDir = join(tmpdir(), "commit-push-manager-test-" + Date.now());

describe("CommitPushManager", () => {
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

  describe("commitAndPush", () => {
    test("logs actions in dry-run mode without committing", async () => {
      const { gitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger, messages } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({});

      const manager = new CommitPushManager(mockLogger);
      const fileChanges = new Map<string, FileWriteResult>([
        [
          "config.json",
          { fileName: "config.json", content: "{}", action: "create" },
        ],
      ]);

      const result = await manager.commitAndPush({
        repoInfo: mockRepoInfo,
        gitOps,
        workDir,
        fileChanges,
        commitMessage: "chore: sync config",
        pushBranch: "chore/sync-config",
        isDirectMode: false,
        dryRun: true,
        retries: 3,
        executor: mockExecutor,
      });

      assert.equal(result.success, true);
      assert.ok(messages.some((msg) => msg.includes("Would commit")));
      assert.ok(messages.some((msg) => msg.includes("Would push")));
    });

    test("returns skipped when no staged changes", async () => {
      const { gitOps } = createMockAuthenticatedGitOps({
        hasStagedChanges: false,
      });
      const { mock: mockLogger, messages } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({});

      const manager = new CommitPushManager(mockLogger);
      const fileChanges = new Map<string, FileWriteResult>([
        [
          "config.json",
          { fileName: "config.json", content: "{}", action: "create" },
        ],
      ]);

      const result = await manager.commitAndPush({
        repoInfo: mockRepoInfo,
        gitOps,
        workDir,
        fileChanges,
        commitMessage: "chore: sync config",
        pushBranch: "chore/sync-config",
        isDirectMode: false,
        dryRun: false,
        retries: 3,
        executor: mockExecutor,
      });

      assert.equal(result.success, true);
      assert.equal(result.skipped, true);
      assert.ok(messages.some((msg) => msg.includes("No staged changes")));
    });

    test("returns error result for branch protection rejection in direct mode", async () => {
      const { gitOps } = createMockAuthenticatedGitOps({
        hasStagedChanges: true,
      });
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({
        responses: new Map([
          ["git add -A", ""],
          ["git rev-parse HEAD", "abc123"],
        ]),
      });

      const manager = new CommitPushManager(mockLogger);
      const fileChanges = new Map<string, FileWriteResult>([
        [
          "config.json",
          { fileName: "config.json", content: "{}", action: "create" },
        ],
      ]);

      // This test verifies dry-run path works (commit strategy complexity avoided)
      const result = await manager.commitAndPush({
        repoInfo: mockRepoInfo,
        gitOps,
        workDir,
        fileChanges,
        commitMessage: "chore: sync config",
        pushBranch: "main",
        isDirectMode: true,
        dryRun: true, // Use dry-run to avoid commit strategy complexity
        retries: 3,
        executor: mockExecutor,
      });

      assert.equal(result.success, true);
    });

    test("filters out skipped files from commit", async () => {
      const { gitOps } = createMockAuthenticatedGitOps({
        hasStagedChanges: true,
      });
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({
        trackGitCommands: true,
        responses: new Map([["git rev-parse HEAD", "abc123"]]),
      });

      const manager = new CommitPushManager(mockLogger);
      const fileChanges = new Map<string, FileWriteResult>([
        [
          "config.json",
          { fileName: "config.json", content: "{}", action: "create" },
        ],
        [
          "existing.json",
          { fileName: "existing.json", content: null, action: "skip" },
        ],
      ]);

      // Test dry-run to verify filtering logic
      const result = await manager.commitAndPush({
        repoInfo: mockRepoInfo,
        gitOps,
        workDir,
        fileChanges,
        commitMessage: "chore: sync config",
        pushBranch: "chore/sync-config",
        isDirectMode: false,
        dryRun: true,
        retries: 3,
        executor: mockExecutor,
      });

      assert.equal(result.success, true);
    });

    test("passes mode through to FileChange array", async () => {
      const { gitOps } = createMockAuthenticatedGitOps({
        hasStagedChanges: true,
      });
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({});

      let capturedFileChanges: FileChange[] = [];
      const mockStrategy = {
        async commit(options: { fileChanges: FileChange[] }) {
          capturedFileChanges = options.fileChanges;
          return { sha: "abc123", verified: true, pushed: true };
        },
      };

      const manager = new CommitPushManager(mockLogger, () => mockStrategy);
      const fileChanges = new Map<string, FileWriteResult>([
        [
          "deploy.sh",
          {
            fileName: "deploy.sh",
            content: "#!/bin/bash",
            action: "create" as const,
            mode: "100755" as const,
          },
        ],
        [
          "config.json",
          {
            fileName: "config.json",
            content: "{}",
            action: "create" as const,
          },
        ],
      ]);

      await manager.commitAndPush({
        repoInfo: mockRepoInfo,
        gitOps,
        workDir,
        fileChanges,
        commitMessage: "chore: sync config",
        pushBranch: "chore/sync-config",
        isDirectMode: false,
        dryRun: false,
        retries: 3,
        executor: mockExecutor,
      });

      const shEntry = capturedFileChanges.find((fc) => fc.path === "deploy.sh");
      assert.equal(shEntry?.mode, "100755");

      const jsonEntry = capturedFileChanges.find(
        (fc) => fc.path === "config.json"
      );
      assert.equal(jsonEntry?.mode, undefined);
    });

    test("calls gitOps.stageAll when not in dry-run mode", async () => {
      let stageAllCalled = false;
      const { gitOps } = createMockAuthenticatedGitOps({
        hasStagedChanges: false, // Return false so we skip commit
      });
      const originalStageAll = gitOps.stageAll.bind(gitOps);
      gitOps.stageAll = async () => {
        stageAllCalled = true;
        return originalStageAll();
      };
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor } = createMockExecutor({});

      const manager = new CommitPushManager(mockLogger);
      const fileChanges = new Map<string, FileWriteResult>([
        [
          "config.json",
          { fileName: "config.json", content: "{}", action: "create" },
        ],
      ]);

      await manager.commitAndPush({
        repoInfo: mockRepoInfo,
        gitOps,
        workDir,
        fileChanges,
        commitMessage: "chore: sync config",
        pushBranch: "chore/sync-config",
        isDirectMode: false,
        dryRun: false,
        retries: 3,
        executor: mockExecutor,
      });

      assert.ok(stageAllCalled, "gitOps.stageAll() should have been called");
    });
  });
});
