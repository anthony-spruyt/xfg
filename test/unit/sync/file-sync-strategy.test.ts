import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { FileSyncStrategy } from "../../../src/sync/file-sync-strategy.js";
import type {
  IFileSyncOrchestrator,
  SessionContext,
} from "../../../src/sync/index.js";
import type { RepoConfig } from "../../../src/config/index.js";
import type { GitHubRepoInfo } from "../../../src/shared/repo-detector.js";
import { createMockAuthenticatedGitOps } from "../../mocks/index.js";

describe("FileSyncStrategy", () => {
  const mockRepoConfig: RepoConfig = {
    git: "git@github.com:test/repo.git",
    files: [{ fileName: "test.txt", content: "test" }],
  };

  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test/repo.git",
    owner: "test",
    repo: "repo",
    host: "github.com",
  };

  test("returns null when no changes", async () => {
    const mockOrchestrator: IFileSyncOrchestrator = {
      async sync() {
        return {
          fileChanges: new Map(),
          diffStats: { additions: 0, deletions: 0, modifications: 0 },
          changedFiles: [],
          hasChanges: false,
        };
      },
    };

    const strategy = new FileSyncStrategy(mockOrchestrator);
    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: false,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      { branchName: "test", workDir: "/tmp", configId: "test" }
    );

    assert.equal(result, null);
  });

  test("returns WorkResult when changes exist", async () => {
    const mockOrchestrator: IFileSyncOrchestrator = {
      async sync() {
        return {
          fileChanges: new Map([
            [
              "test.txt",
              {
                fileName: "test.txt",
                content: "test",
                action: "create" as const,
              },
            ],
          ]),
          diffStats: { additions: 1, deletions: 0, modifications: 0 },
          changedFiles: [{ fileName: "test.txt", action: "create" as const }],
          hasChanges: true,
        };
      },
    };

    const strategy = new FileSyncStrategy(mockOrchestrator);
    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: true,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      { branchName: "test", workDir: "/tmp", configId: "test" }
    );

    assert.ok(result);
    assert.ok(result.fileChanges.has("test.txt"));
    assert.equal(result.changedFiles.length, 1);
    assert.ok(result.commitMessage.length > 0);
    assert.equal(result.fileChangeDetails.length, 1);
    assert.equal(result.fileChangeDetails[0].action, "create");
  });

  test("filters out skip actions from fileChangeDetails", async () => {
    const mockOrchestrator: IFileSyncOrchestrator = {
      async sync() {
        return {
          fileChanges: new Map([
            [
              "test.txt",
              {
                fileName: "test.txt",
                content: "test",
                action: "create" as const,
              },
            ],
          ]),
          diffStats: { additions: 1, deletions: 0, modifications: 0 },
          changedFiles: [
            { fileName: "test.txt", action: "create" as const },
            { fileName: "unchanged.txt", action: "skip" as const },
          ],
          hasChanges: true,
        };
      },
    };

    const strategy = new FileSyncStrategy(mockOrchestrator);
    const { mock: mockGitOps } = createMockAuthenticatedGitOps({
      hasChanges: true,
    });
    const session: SessionContext = {
      gitOps: mockGitOps,
      baseBranch: "main",
      cleanup: () => {},
    };

    const result = await strategy.execute(
      mockRepoConfig,
      mockRepoInfo,
      session,
      { branchName: "test", workDir: "/tmp", configId: "test" }
    );

    assert.ok(result);
    assert.equal(result.fileChangeDetails.length, 1);
    assert.equal(result.fileChangeDetails[0].path, "test.txt");
  });
});
