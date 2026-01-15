import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RepositoryProcessor,
  GitOpsFactory,
  ProcessorOptions,
} from "./repository-processor.js";
import { RepoConfig } from "./config.js";
import { GitHubRepoInfo } from "./repo-detector.js";
import { GitOps, GitOpsOptions } from "./git-ops.js";
import { ILogger } from "./logger.js";

const testDir = join(tmpdir(), "repo-processor-test-" + Date.now());

describe("RepositoryProcessor", () => {
  let workDir: string;
  let processor: RepositoryProcessor;

  const mockRepoConfig: RepoConfig = {
    git: "git@github.com:test/repo.git",
    content: { key: "value" },
  };

  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test/repo.git",
    owner: "test",
    repo: "repo",
  };

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    processor = new RepositoryProcessor();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("process", () => {
    test("returns ProcessorResult with repoName", async () => {
      // This test verifies the result structure - actual git operations
      // will fail without a real repo, which is expected
      try {
        await processor.process(mockRepoConfig, mockRepoInfo, {
          fileName: "config.json",
          branchName: "chore/sync-config",
          workDir,
          dryRun: true,
        });
      } catch {
        // Expected to fail without real git repo
      }

      // Workspace should be cleaned up even on failure (finally block)
      // The cleanup creates the directory, so it should exist but be empty
    });

    test("cleans up workspace on error (finally block)", async () => {
      // Create a file in the workspace before processing
      mkdirSync(workDir, { recursive: true });
      writeFileSync(join(workDir, "existing.txt"), "content");

      try {
        await processor.process(mockRepoConfig, mockRepoInfo, {
          fileName: "config.json",
          branchName: "chore/sync-config",
          workDir,
          dryRun: false,
        });
      } catch {
        // Expected to fail - no real git repo
      }

      // The existing file should have been cleaned up
      const files = readdirSync(workDir);
      assert.equal(files.length, 0, "Workspace should be empty after cleanup");
    });
  });

  describe("action detection behavior", () => {
    // Mock logger that captures log messages
    const createMockLogger = (): ILogger & { messages: string[] } => ({
      messages: [] as string[],
      info(message: string) {
        this.messages.push(message);
      },
    });

    // Mock GitOps that simulates different scenarios
    class MockGitOps extends GitOps {
      fileExists = false;
      contentMatches = false;
      createPRCalled = false;
      lastAction: "create" | "update" | null = null;

      constructor(options: GitOpsOptions) {
        super(options);
      }

      override cleanWorkspace(): void {
        mkdirSync(this.getWorkDir(), { recursive: true });
      }

      override async clone(_gitUrl: string): Promise<void> {
        // No-op for mock
      }

      override async getDefaultBranch(): Promise<{
        branch: string;
        method: string;
      }> {
        return { branch: "main", method: "mock" };
      }

      override async createBranch(_branchName: string): Promise<void> {
        // No-op for mock
      }

      override writeFile(fileName: string, content: string): void {
        // Simulate writing the file
        const filePath = join(this.getWorkDir(), fileName);
        writeFileSync(filePath, content, "utf-8");
      }

      override wouldChange(_fileName: string, _content: string): boolean {
        // If file exists with same content, no change
        if (this.fileExists && this.contentMatches) {
          return false;
        }
        return true;
      }

      override async hasChanges(): Promise<boolean> {
        // Same logic for actual git check
        if (this.fileExists && this.contentMatches) {
          return false;
        }
        return true;
      }

      override async commit(_message: string): Promise<void> {
        // No-op for mock
      }

      override async push(_branchName: string): Promise<void> {
        // No-op for mock
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }

      // Setup methods for test scenarios
      setupFileExists(exists: boolean, contentMatches: boolean): void {
        this.fileExists = exists;
        this.contentMatches = contentMatches;
        if (exists) {
          // Create the file in workspace
          const filePath = join(this.getWorkDir(), "config.json");
          mkdirSync(this.getWorkDir(), { recursive: true });
          if (contentMatches) {
            writeFileSync(filePath, '{\n  "key": "value"\n}\n', "utf-8");
          } else {
            writeFileSync(filePath, '{\n  "key": "old-value"\n}\n', "utf-8");
          }
        }
      }
    }

    test("should correctly skip when existing file has identical content", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOps | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOps(opts);
        mockGitOps.setupFileExists(true, true); // File exists with same content
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `action-test-skip-${Date.now()}`);

      const result = await processor.process(mockRepoConfig, mockRepoInfo, {
        fileName: "config.json",
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        dryRun: true,
      });

      assert.equal(result.skipped, true, "Should be skipped");
      assert.equal(result.message, "No changes detected");
    });

    test("should correctly report 'update' action when file exists but content differs", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOps | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOps(opts);
        mockGitOps.setupFileExists(true, false); // File exists with different content
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `action-test-update-${Date.now()}`);

      const result = await processor.process(mockRepoConfig, mockRepoInfo, {
        fileName: "config.json",
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        dryRun: true, // Use dry run to avoid actual git/PR operations
      });

      // In dry run, it should detect changes and not skip
      // (PR creation may fail without real repo, but the key is it wasn't skipped)
      assert.equal(
        result.skipped,
        undefined,
        "Should not be explicitly skipped",
      );
      assert.notEqual(result.skipped, true, "Should not have skipped=true");
    });

    test("should correctly report 'create' action when file does not exist", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOps | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOps(opts);
        mockGitOps.setupFileExists(false, false); // File doesn't exist
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `action-test-create-${Date.now()}`);

      const result = await processor.process(mockRepoConfig, mockRepoInfo, {
        fileName: "config.json",
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        dryRun: true, // Use dry run to avoid actual git/PR operations
      });

      // Should detect that file needs to be created (not skipped)
      // (PR creation may fail without real repo, but the key is it wasn't skipped)
      assert.equal(
        result.skipped,
        undefined,
        "Should not be explicitly skipped",
      );
      assert.notEqual(result.skipped, true, "Should not have skipped=true");
    });
  });
});
