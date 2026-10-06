import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSyncOrchestrator } from "../../../src/sync/file-sync-orchestrator.js";
import {
  createMockAuthenticatedGitOps,
  createMockExecutor,
  createMockLogger,
} from "../../mocks/index.js";
import {
  createDiffStats,
  incrementDiffStats,
} from "../../../src/sync/diff-utils.js";
import type {
  IFileWriter,
  IManifestManager,
  IRenderWriter,
} from "../../../src/sync/types.js";
import type { GitHubRepoInfo } from "../../../src/repo/index.js";
import type { RepoConfig } from "../../../src/config/types.js";

const testDir = join(tmpdir(), "file-sync-orchestrator-test-" + Date.now());

const noopRenderWriter: IRenderWriter = { write: () => {} };

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
    const diffStats = createDiffStats();
    for (const [, info] of fileChanges) {
      if (info.action === "create") incrementDiffStats(diffStats, "NEW");
      else if (info.action === "update")
        incrementDiffStats(diffStats, "MODIFIED");
    }
    return {
      writeFiles: async () => ({
        fileChanges,
        diffStats,
      }),
    };
  }

  function createMockManifestManager(): IManifestManager & {
    calls: {
      detectOrphans: number;
      deleteOrphans: number;
      saveUpdatedManifest: number;
    };
  } {
    const calls = {
      detectOrphans: 0,
      deleteOrphans: 0,
      saveUpdatedManifest: 0,
    };
    return {
      calls,
      detectOrphans: () => {
        calls.detectOrphans++;
        return {
          manifest: { version: 4, configs: {} },
          existingManifest: null,
          filesToDelete: [],
        };
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
      const { gitOps } = createMockAuthenticatedGitOps({});
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
        mockLogger,
        noopRenderWriter
      );

      const repoConfig: RepoConfig = {
        git: mockRepoInfo.gitUrl,
        files: [{ fileName: "config.json", content: {} }],
      };

      const result = await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps, baseBranch: "main", cleanup: () => {} },
        {
          branchName: "chore/sync",
          workDir,
          configId: "test",
          executor: createMockExecutor().mock,
        }
      );

      assert.equal(mockManifestManager.calls.detectOrphans, 1);
      assert.equal(mockManifestManager.calls.deleteOrphans, 1);
      assert.equal(mockManifestManager.calls.saveUpdatedManifest, 1);
      assert.equal(result.hasChanges, true);
      assert.equal(result.changedFiles.length, 1);
    });

    test("returns hasChanges false when all files skipped", async () => {
      const { gitOps } = createMockAuthenticatedGitOps({});
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
        mockLogger,
        noopRenderWriter
      );

      const repoConfig: RepoConfig = {
        git: mockRepoInfo.gitUrl,
        files: [{ fileName: "config.json", content: {} }],
      };

      const result = await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps, baseBranch: "main", cleanup: () => {} },
        {
          branchName: "chore/sync",
          workDir,
          configId: "test",
          executor: createMockExecutor().mock,
        }
      );

      assert.equal(result.hasChanges, false);
    });

    test("logs diff summary in dry-run mode", async () => {
      const { gitOps } = createMockAuthenticatedGitOps({});
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
        mockLogger,
        noopRenderWriter
      );

      const repoConfig: RepoConfig = {
        git: mockRepoInfo.gitUrl,
        files: [{ fileName: "config.json", content: {} }],
      };

      await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps, baseBranch: "main", cleanup: () => {} },
        {
          branchName: "chore/sync",
          workDir,
          configId: "test",
          dryRun: true,
          executor: createMockExecutor().mock,
        }
      );

      assert.equal(diffSummaries.length, 1);
    });

    test("calculates diff stats for non-dry-run", async () => {
      const { gitOps } = createMockAuthenticatedGitOps({});
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
        mockLogger,
        noopRenderWriter
      );

      const repoConfig: RepoConfig = {
        git: mockRepoInfo.gitUrl,
        files: [
          { fileName: "new.json", content: {} },
          { fileName: "updated.json", content: {} },
        ],
      };

      const result = await orchestrator.sync(
        repoConfig,
        mockRepoInfo,
        { gitOps, baseBranch: "main", cleanup: () => {} },
        {
          branchName: "chore/sync",
          workDir,
          configId: "test",
          dryRun: false,
          executor: createMockExecutor().mock,
        }
      );

      assert.equal(result.diffStats.newCount, 1);
      assert.equal(result.diffStats.modifiedCount, 1);
    });

    describe("renderDir", () => {
      function createRecordingRenderWriter(): IRenderWriter & {
        calls: Array<{ renderDir: string; repoName: string; files: string[] }>;
      } {
        const calls: Array<{
          renderDir: string;
          repoName: string;
          files: string[];
        }> = [];
        return {
          calls,
          write: (renderDir, repoName, fileChanges) => {
            calls.push({ renderDir, repoName, files: [...fileChanges.keys()] });
          },
        };
      }

      async function syncWith(
        renderWriter: IRenderWriter,
        options: { dryRun: boolean; renderDir?: string }
      ): Promise<void> {
        const { gitOps } = createMockAuthenticatedGitOps({});
        const { mock: mockLogger } = createMockLogger();
        const manifestManager = createMockManifestManager();
        manifestManager.saveUpdatedManifest = (_w, _m, _e, _d, changes) => {
          changes.set(".xfg.json", {
            fileName: ".xfg.json",
            content: "{}",
            action: "update",
          });
        };
        const orchestrator = new FileSyncOrchestrator(
          createMockFileWriter(
            new Map([
              [
                "config.json",
                {
                  fileName: "config.json",
                  content: "{}",
                  action: "create" as const,
                },
              ],
            ])
          ),
          manifestManager,
          mockLogger,
          renderWriter
        );

        await orchestrator.sync(
          {
            git: mockRepoInfo.gitUrl,
            files: [{ fileName: "config.json", content: {} }],
          },
          mockRepoInfo,
          { gitOps, baseBranch: "main", cleanup: () => {} },
          {
            branchName: "chore/sync",
            workDir,
            configId: "test",
            executor: createMockExecutor().mock,
            ...options,
          }
        );
      }

      test("renders the repo's file changes, manifest included, in dry-run", async () => {
        const renderWriter = createRecordingRenderWriter();

        await syncWith(renderWriter, { dryRun: true, renderDir: "/out" });

        assert.deepEqual(renderWriter.calls, [
          {
            renderDir: "/out",
            repoName: "test/repo",
            files: ["config.json", ".xfg.json"],
          },
        ]);
      });

      test("does not render without renderDir", async () => {
        const renderWriter = createRecordingRenderWriter();

        await syncWith(renderWriter, { dryRun: true });

        assert.equal(renderWriter.calls.length, 0);
      });

      test("does not render outside dry-run", async () => {
        const renderWriter = createRecordingRenderWriter();

        await syncWith(renderWriter, { dryRun: false, renderDir: "/out" });

        assert.equal(renderWriter.calls.length, 0);
      });
    });
  });
});
