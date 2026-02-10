import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSyncOrchestrator } from "../../../src/sync/file-sync-orchestrator.js";
import {
  createMockAuthenticatedGitOps,
  createMockLogger,
} from "../../mocks/index.js";
import { createDiffStats } from "../../../src/sync/diff-utils.js";
import type { IFileWriter, IManifestManager } from "../../../src/sync/types.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import type { RepoConfig } from "../../../src/config/types.js";

const testDir = join(tmpdir(), "file-sync-orchestrator-test-" + Date.now());

describe("FileSyncOrchestrator", () => {
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

  function createMockFileWriter(
    fileChanges: Map<
      string,
      {
        fileName: string;
        content: string | null;
        action: "create" | "update" | "delete" | "skip";
      }
    >
  ): IFileWriter {
    return {
      writeFiles: async () => ({
        fileChanges,
        diffStats: createDiffStats(),
      }),
    };
  }

  function createMockManifestManager(): IManifestManager & {
    calls: {
      processOrphans: number;
      deleteOrphans: number;
      saveUpdatedManifest: number;
    };
  } {
    const calls = {
      processOrphans: 0,
      deleteOrphans: 0,
      saveUpdatedManifest: 0,
    };
    return {
      calls,
      processOrphans: () => {
        calls.processOrphans++;
        return { manifest: { version: 3, configs: {} }, filesToDelete: [] };
      },
      deleteOrphans: async () => {
        calls.deleteOrphans++;
      },
      saveUpdatedManifest: () => {
        calls.saveUpdatedManifest++;
      },
    };
  }

  describe("sync", () => {
    test("orchestrates file writing and manifest handling", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      const fileChanges = new Map([
        [
          "config.json",
          { fileName: "config.json", content: "{}", action: "create" as const },
        ],
      ]);
      const mockFileWriter = createMockFileWriter(fileChanges);
      const mockManifestManager = createMockManifestManager();

      const orchestrator = new FileSyncOrchestrator(
        mockFileWriter,
        mockManifestManager,
        mockLogger
      );

      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [{ fileName: "config.json", content: {} }],
      };

      const result = await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps: mockGitOps, baseBranch: "main", cleanup: () => {} },
        { branchName: "chore/sync", workDir, configId: "test" }
      );

      assert.equal(mockManifestManager.calls.processOrphans, 1);
      assert.equal(mockManifestManager.calls.deleteOrphans, 1);
      assert.equal(mockManifestManager.calls.saveUpdatedManifest, 1);
      assert.equal(result.hasChanges, true);
      assert.equal(result.changedFiles.length, 1);
    });

    test("returns hasChanges false when all files skipped", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      const fileChanges = new Map([
        [
          "config.json",
          { fileName: "config.json", content: null, action: "skip" as const },
        ],
      ]);
      const mockFileWriter = createMockFileWriter(fileChanges);
      const mockManifestManager = createMockManifestManager();

      const orchestrator = new FileSyncOrchestrator(
        mockFileWriter,
        mockManifestManager,
        mockLogger
      );

      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [{ fileName: "config.json", content: {} }],
      };

      const result = await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps: mockGitOps, baseBranch: "main", cleanup: () => {} },
        { branchName: "chore/sync", workDir, configId: "test" }
      );

      assert.equal(result.hasChanges, false);
    });

    test("logs diff summary in dry-run mode", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger, diffSummaries } = createMockLogger();

      const fileChanges = new Map([
        [
          "config.json",
          { fileName: "config.json", content: "{}", action: "create" as const },
        ],
      ]);
      const mockFileWriter = createMockFileWriter(fileChanges);
      const mockManifestManager = createMockManifestManager();

      const orchestrator = new FileSyncOrchestrator(
        mockFileWriter,
        mockManifestManager,
        mockLogger
      );

      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [{ fileName: "config.json", content: {} }],
      };

      await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps: mockGitOps, baseBranch: "main", cleanup: () => {} },
        { branchName: "chore/sync", workDir, configId: "test", dryRun: true }
      );

      assert.equal(diffSummaries.length, 1);
    });

    test("calculates diff stats for non-dry-run", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({});
      const { mock: mockLogger } = createMockLogger();

      const fileChanges = new Map([
        [
          "new.json",
          { fileName: "new.json", content: "{}", action: "create" as const },
        ],
        [
          "updated.json",
          {
            fileName: "updated.json",
            content: "{}",
            action: "update" as const,
          },
        ],
      ]);
      const mockFileWriter = createMockFileWriter(fileChanges);
      const mockManifestManager = createMockManifestManager();

      const orchestrator = new FileSyncOrchestrator(
        mockFileWriter,
        mockManifestManager,
        mockLogger
      );

      const repoConfig: RepoConfig = {
        gitUrl: mockRepoInfo.gitUrl,
        files: [
          { fileName: "new.json", content: {} },
          { fileName: "updated.json", content: {} },
        ],
      };

      const result = await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps: mockGitOps, baseBranch: "main", cleanup: () => {} },
        { branchName: "chore/sync", workDir, configId: "test", dryRun: false }
      );

      assert.equal(result.diffStats.newCount, 1);
      assert.equal(result.diffStats.modifiedCount, 1);
    });
  });
});
