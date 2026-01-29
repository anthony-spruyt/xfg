import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepositoryProcessor, GitOpsFactory } from "./repository-processor.js";
import { RepoConfig } from "./config.js";
import { GitHubRepoInfo } from "./repo-detector.js";
import { GitOps, GitOpsOptions } from "./git-ops.js";
import { ILogger } from "./logger.js";
import { CommandExecutor } from "./command-executor.js";

const testDir = join(tmpdir(), "repo-processor-test-" + Date.now());

// Mock executor that returns empty results for all commands (prevents real CLI calls during tests)
function createMockExecutor(): CommandExecutor {
  return {
    async exec(): Promise<string> {
      return "";
    },
  };
}

// Mock executor that tracks commit messages for tests verifying commit behavior
function createTrackingMockExecutor(): CommandExecutor & {
  lastCommitMessage: string | null;
  pushBranch: string | null;
  pushForce: boolean | undefined;
} {
  const tracker = {
    lastCommitMessage: null as string | null,
    pushBranch: null as string | null,
    pushForce: undefined as boolean | undefined,
    async exec(command: string): Promise<string> {
      // Track commit message from git commit command
      if (command.includes("git commit")) {
        const match = command.match(/-m ['"](.+)['"]/);
        if (match) {
          tracker.lastCommitMessage = match[1];
        } else {
          // Handle shell escaping - look for -m followed by escaped content
          const msgMatch = command.match(/-m \$'([^']+)'/);
          if (msgMatch) {
            tracker.lastCommitMessage = msgMatch[1].replace(/\\'/g, "'");
          }
        }
      }
      // Track push branch and force flag
      if (command.includes("git push")) {
        tracker.pushForce = command.includes("--force-with-lease");
        // Branch name may be shell-escaped with single quotes
        const branchMatch = command.match(
          /git push.*origin\s+'?([^'\s]+)'?(?:\s|$)/
        );
        if (branchMatch) {
          tracker.pushBranch = branchMatch[1];
        }
      }
      // Return HEAD SHA for commit strategy
      if (command.includes("git rev-parse HEAD")) {
        return "abc123def456";
      }
      return "";
    },
  };
  return tracker;
}

describe("RepositoryProcessor", () => {
  let workDir: string;
  let processor: RepositoryProcessor;

  const mockRepoConfig: RepoConfig = {
    git: "git@github.com:test/repo.git",
    files: [
      {
        fileName: "config.json",
        content: { key: "value" },
      },
    ],
  };

  const mockRepoInfo: GitHubRepoInfo = {
    type: "github",
    gitUrl: "git@github.com:test/repo.git",
    owner: "test",
    repo: "repo",
    host: "github.com",
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
          branchName: "chore/sync-config",
          workDir,
          configId: "test-config",
          dryRun: true,
          executor: createMockExecutor(),
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
          branchName: "chore/sync-config",
          workDir,
          configId: "test-config",
          dryRun: false,
          executor: createMockExecutor(),
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
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number
      ) {
        // No-op for mock
      },
    });

    // Mock GitOps that simulates different scenarios
    class MockGitOps extends GitOps {
      mockFileExists = false;
      contentMatches = false;
      createPRCalled = false;
      lastAction: "create" | "update" | null = null;

      override fileExists(_fileName: string): boolean {
        return this.mockFileExists;
      }

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
        if (this.mockFileExists && this.contentMatches) {
          return false;
        }
        return true;
      }

      override async hasChanges(): Promise<boolean> {
        // Same logic for actual git check
        if (this.mockFileExists && this.contentMatches) {
          return false;
        }
        return true;
      }

      override async fileExistsOnBranch(
        _fileName: string,
        _branch: string
      ): Promise<boolean> {
        // For tests, assume file doesn't exist on base branch unless specified
        return false;
      }

      override async commit(_message: string): Promise<boolean> {
        // Return true to indicate commit was made
        return true;
      }

      override async push(_branchName: string): Promise<void> {
        // No-op for mock
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }

      // Setup methods for test scenarios
      setupFileExists(exists: boolean, contentMatches: boolean): void {
        this.mockFileExists = exists;
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
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
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
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true, // Use dry run to avoid actual git/PR operations
      });

      // In dry run, it should detect changes and not skip
      // (PR creation may fail without real repo, but the key is it wasn't skipped)
      assert.equal(
        result.skipped,
        undefined,
        "Should not be explicitly skipped"
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
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true, // Use dry run to avoid actual git/PR operations
      });

      // Should detect that file needs to be created (not skipped)
      // (PR creation may fail without real repo, but the key is it wasn't skipped)
      assert.equal(
        result.skipped,
        undefined,
        "Should not be explicitly skipped"
      );
      assert.notEqual(result.skipped, true, "Should not have skipped=true");
    });

    test("should skip when commit returns false (no staged changes after git add)", async () => {
      const mockLogger = createMockLogger();

      // Extend MockGitOps to return false from hasStagedChanges
      class MockGitOpsNoStagedChanges extends MockGitOps {
        override async getChangedFiles(): Promise<string[]> {
          // Report that files changed (so we proceed to commit step)
          return ["config.json"];
        }

        override async hasStagedChanges(): Promise<boolean> {
          // Return false to indicate no staged changes after git add -A
          return false;
        }
      }

      const mockFactory: GitOpsFactory = (opts) => {
        const mockGitOps = new MockGitOpsNoStagedChanges(opts);
        mockGitOps.setupFileExists(false, false); // File doesn't exist, so it will try to create
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `action-test-no-staged-${Date.now()}`);

      const result = await processor.process(mockRepoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false, // Need non-dry run to hit the commit path
        executor: createMockExecutor(),
      });

      assert.equal(result.success, true, "Should succeed");
      assert.equal(result.skipped, true, "Should be skipped");
      assert.equal(
        result.message,
        "No changes detected after staging",
        "Should have correct message"
      );
    });
  });

  describe("executable file handling", () => {
    // Mock logger that captures log messages
    const createMockLogger = (): ILogger & { messages: string[] } => ({
      messages: [] as string[],
      info(message: string) {
        this.messages.push(message);
      },
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number
      ) {
        // No-op for mock
      },
    });

    // Mock GitOps that tracks setExecutable calls
    class MockGitOpsWithExecutable extends GitOps {
      mockFileExists = false;
      contentMatches = false;
      setExecutableCalls: string[] = [];

      constructor(options: GitOpsOptions) {
        super(options);
      }

      override fileExists(_fileName: string): boolean {
        return this.mockFileExists;
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
        const filePath = join(this.getWorkDir(), fileName);
        mkdirSync(join(this.getWorkDir()), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }

      override wouldChange(_fileName: string, _content: string): boolean {
        return true;
      }

      override async hasChanges(): Promise<boolean> {
        return true;
      }

      override async commit(_message: string): Promise<boolean> {
        // Return true to indicate commit was made
        return true;
      }

      override async push(_branchName: string): Promise<void> {
        // No-op for mock
      }

      override async setExecutable(fileName: string): Promise<void> {
        this.setExecutableCalls.push(fileName);
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }

      setupFileExists(exists: boolean, contentMatches: boolean): void {
        this.mockFileExists = exists;
        this.contentMatches = contentMatches;
      }
    }

    test("should call setExecutable for .sh files by default", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsWithExecutable | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsWithExecutable(opts);
        mockGitOps.setupFileExists(false, false);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `exec-test-sh-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "deploy.sh", content: "#!/bin/bash" }],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
      });

      assert.ok(mockGitOps!.setExecutableCalls.includes("deploy.sh"));
    });

    test("should not call setExecutable for non-.sh files by default", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsWithExecutable | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsWithExecutable(opts);
        mockGitOps.setupFileExists(false, false);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `exec-test-json-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
      });

      assert.ok(!mockGitOps!.setExecutableCalls.includes("config.json"));
    });

    test("should respect executable: false for .sh files", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsWithExecutable | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsWithExecutable(opts);
        mockGitOps.setupFileExists(false, false);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `exec-test-false-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          { fileName: "script.sh", content: "#!/bin/bash", executable: false },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
      });

      assert.ok(!mockGitOps!.setExecutableCalls.includes("script.sh"));
    });

    test("should call setExecutable for non-.sh files when executable: true", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsWithExecutable | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsWithExecutable(opts);
        mockGitOps.setupFileExists(false, false);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `exec-test-true-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "run", content: "#!/bin/bash", executable: true }],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
      });

      assert.ok(mockGitOps!.setExecutableCalls.includes("run"));
    });
  });

  describe("prOptions defaults", () => {
    // These tests verify that the default prOptions values are correctly applied
    // when processing repositories. The defaults are:
    // - merge: "auto" (instead of "manual")
    // - mergeStrategy: "squash" (instead of "merge")
    // - deleteBranch: true (instead of false)
    //
    // Note: Full integration tests of the merge flow require mocking the PR
    // creator module, which is tested via integration tests. These unit tests
    // verify the config handling at the normalization level.

    test("prOptions with undefined values should allow defaults to be applied", () => {
      // This test verifies that RepoConfig can have prOptions undefined
      // and the processor code will apply defaults via ?? operator
      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        // prOptions is undefined - processor will use defaults
      };

      assert.strictEqual(repoConfig.prOptions, undefined);

      // The processor applies defaults like this - demonstrate the pattern works
      // Use type assertion to avoid TypeScript narrowing after the undefined check
      const config = repoConfig as RepoConfig;
      const mergeMode = config.prOptions?.merge ?? "auto";
      assert.equal(mergeMode, "auto", "Default merge mode should be 'auto'");

      const strategy = config.prOptions?.mergeStrategy ?? "squash";
      assert.equal(strategy, "squash", "Default strategy should be 'squash'");

      const deleteBranch = config.prOptions?.deleteBranch ?? true;
      assert.equal(deleteBranch, true, "Default deleteBranch should be true");
    });

    test("explicit prOptions.merge: manual should override default", () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { merge: "manual" },
      };

      const mergeMode = repoConfig.prOptions?.merge ?? "auto";
      assert.equal(mergeMode, "manual", "Explicit merge mode should override");
    });

    test("explicit mergeStrategy should override default", () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { mergeStrategy: "rebase" },
      };

      const strategy = repoConfig.prOptions?.mergeStrategy ?? "squash";
      assert.equal(strategy, "rebase", "Explicit strategy should override");
    });

    test("explicit deleteBranch: false should override default true", () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { deleteBranch: false },
      };

      const deleteBranch = repoConfig.prOptions?.deleteBranch ?? true;
      assert.equal(
        deleteBranch,
        false,
        "Explicit deleteBranch should override"
      );
    });

    test("partial prOptions should allow other defaults to apply", () => {
      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { merge: "force" }, // Only merge is set
      };

      const mergeMode = repoConfig.prOptions?.merge ?? "auto";
      const strategy = repoConfig.prOptions?.mergeStrategy ?? "squash";
      const deleteBranch = repoConfig.prOptions?.deleteBranch ?? true;

      assert.equal(mergeMode, "force", "Explicit merge should be used");
      assert.equal(strategy, "squash", "Default strategy should apply");
      assert.equal(deleteBranch, true, "Default deleteBranch should apply");
    });
  });

  describe("direct mode", () => {
    // Mock logger that captures log messages
    const createMockLogger = (): ILogger & { messages: string[] } => ({
      messages: [] as string[],
      info(message: string) {
        this.messages.push(message);
      },
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number
      ) {
        // No-op for mock
      },
    });

    // Mock GitOps for direct mode testing
    class MockGitOpsForDirectMode extends GitOps {
      createBranchCalled = false;
      pushBranch: string | null = null;
      pushForce: boolean | undefined = undefined;
      shouldRejectPush = false;

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
        this.createBranchCalled = true;
      }

      override writeFile(fileName: string, content: string): void {
        const filePath = join(this.getWorkDir(), fileName);
        mkdirSync(this.getWorkDir(), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }

      override wouldChange(_fileName: string, _content: string): boolean {
        return true;
      }

      override async hasChanges(): Promise<boolean> {
        return true;
      }

      override async getChangedFiles(): Promise<string[]> {
        return ["config.json"];
      }

      override async commit(_message: string): Promise<boolean> {
        return true;
      }

      override async push(
        branchName: string,
        options?: { force?: boolean }
      ): Promise<void> {
        this.pushBranch = branchName;
        this.pushForce = options?.force;
        if (this.shouldRejectPush) {
          throw new Error("Push rejected (branch protection)");
        }
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }
    }

    test("direct mode should not create a sync branch", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForDirectMode | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForDirectMode(opts);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `direct-mode-no-branch-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { merge: "direct" },
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
      });

      assert.equal(
        mockGitOps!.createBranchCalled,
        false,
        "Should not create a sync branch in direct mode"
      );
    });

    test("direct mode should push to default branch", async () => {
      const mockLogger = createMockLogger();

      const mockFactory: GitOpsFactory = (opts) => {
        return new MockGitOpsForDirectMode(opts);
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `direct-mode-push-${Date.now()}`);
      const trackingExecutor = createTrackingMockExecutor();

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { merge: "direct" },
      };

      const result = await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      assert.equal(
        trackingExecutor.pushBranch,
        "main",
        "Should push to default branch (main)"
      );
      assert.equal(result.success, true, "Should succeed");
      assert.ok(
        result.message.includes("Pushed directly to main"),
        "Message should indicate direct push"
      );
      assert.equal(result.prUrl, undefined, "Should not have a PR URL");
    });

    test("direct mode should return helpful error on branch protection", async () => {
      const mockLogger = createMockLogger();

      const mockFactory: GitOpsFactory = (opts) => {
        return new MockGitOpsForDirectMode(opts);
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(
        testDir,
        `direct-mode-protection-${Date.now()}`
      );

      // Create executor that rejects push commands
      const rejectingExecutor: CommandExecutor = {
        async exec(command: string): Promise<string> {
          if (command.includes("git push")) {
            throw new Error("Push rejected (branch protection)");
          }
          if (command.includes("git rev-parse HEAD")) {
            return "abc123";
          }
          return "";
        },
      };

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { merge: "direct" },
      };

      const result = await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: rejectingExecutor,
      });

      assert.equal(result.success, false, "Should fail");
      assert.ok(
        result.message.includes("rejected"),
        "Message should mention rejection"
      );
      assert.ok(
        result.message.includes("branch protection"),
        "Message should mention branch protection"
      );
      assert.ok(
        result.message.includes("merge: force"),
        "Message should suggest using force mode"
      );
    });

    test("direct mode should log warning when mergeStrategy is set", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForDirectMode | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForDirectMode(opts);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `direct-mode-warning-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { merge: "direct", mergeStrategy: "squash" },
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
      });

      const warningMessage = mockLogger.messages.find(
        (m) => m.includes("mergeStrategy") && m.includes("ignored")
      );
      assert.ok(
        warningMessage,
        "Should log warning about mergeStrategy being ignored"
      );
    });

    test("direct mode should use force: false for push (issue #183)", async () => {
      const mockLogger = createMockLogger();

      const mockFactory: GitOpsFactory = (opts) => {
        return new MockGitOpsForDirectMode(opts);
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `direct-mode-force-${Date.now()}`);
      const trackingExecutor = createTrackingMockExecutor();

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { merge: "direct" },
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      assert.equal(
        trackingExecutor.pushForce,
        false,
        "Direct mode should use force: false (never force push to default branch)"
      );
    });

    test("PR mode should use force: true for push (issue #183)", async () => {
      const mockLogger = createMockLogger();

      const mockFactory: GitOpsFactory = (opts) => {
        return new MockGitOpsForDirectMode(opts);
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `pr-mode-force-${Date.now()}`);
      const trackingExecutor = createTrackingMockExecutor();

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        // Default mode is 'auto' (PR mode)
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      assert.equal(
        trackingExecutor.pushForce,
        true,
        "PR mode should use force: true (--force-with-lease for sync branch)"
      );
    });
  });

  describe("PR creation with executor", () => {
    class MockGitOpsForPR extends GitOps {
      override cleanWorkspace(): void {
        mkdirSync(this.getWorkDir(), { recursive: true });
      }
      override async clone(): Promise<void> {}
      override async getDefaultBranch() {
        return { branch: "main", method: "mock" };
      }
      override async createBranch(): Promise<void> {}
      override writeFile(fileName: string, content: string): void {
        const filePath = join(this.getWorkDir(), fileName);
        mkdirSync(this.getWorkDir(), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }
      override async hasChanges(): Promise<boolean> {
        return true;
      }
      override async getChangedFiles(): Promise<string[]> {
        return ["config.json"];
      }
      override async commit(): Promise<boolean> {
        return true;
      }
      override async push(): Promise<void> {}
      override async fetch(): Promise<void> {}

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }
    }

    test("should pass executor to createPR when not in direct mode", async () => {
      const mockLogger: ILogger & { messages: string[] } = {
        messages: [] as string[],
        info(message: string) {
          this.messages.push(message);
        },
        fileDiff() {},
        diffSummary() {},
      };

      const mockFactory: GitOpsFactory = (opts) => new MockGitOpsForPR(opts);

      const mockExecutor = {
        async exec(): Promise<string> {
          return "https://github.com/test/repo/pull/123";
        },
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `pr-executor-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        // Not using direct mode - should create PR
      };

      const result = await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: mockExecutor,
      });

      assert.equal(result.success, true);
      assert.ok(result.prUrl?.includes("pull/123"), "Should have PR URL");
    });
  });

  describe("createOnly handling", () => {
    const createMockLogger = (): ILogger & { messages: string[] } => ({
      messages: [] as string[],
      info(message: string) {
        this.messages.push(message);
      },
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number
      ) {
        // No-op for mock
      },
    });

    class MockGitOpsForCreateOnly extends GitOps {
      fileExistsOnBaseBranch = false;

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
        const filePath = join(this.getWorkDir(), fileName);
        mkdirSync(this.getWorkDir(), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }

      override wouldChange(_fileName: string, _content: string): boolean {
        return true;
      }

      override async hasChanges(): Promise<boolean> {
        return !this.fileExistsOnBaseBranch;
      }

      override async fileExistsOnBranch(
        _fileName: string,
        _branch: string
      ): Promise<boolean> {
        return this.fileExistsOnBaseBranch;
      }

      override async commit(_message: string): Promise<boolean> {
        return true;
      }

      override async push(_branchName: string): Promise<void> {
        // No-op for mock
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }
    }

    test("should skip file with createOnly when file exists on base branch", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForCreateOnly | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForCreateOnly(opts);
        mockGitOps.fileExistsOnBaseBranch = true;
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `createonly-exists-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "config.json",
            content: { key: "value" },
            createOnly: true,
          },
        ],
      };

      const result = await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
      });

      // Should be skipped because file exists and createOnly is true
      assert.equal(result.skipped, true, "Should be skipped");
      const skipMessage = mockLogger.messages.find(
        (m) => m.includes("Skipping") && m.includes("createOnly")
      );
      assert.ok(skipMessage, "Should log skip message for createOnly");
    });

    test("should create file with createOnly when file does not exist on base branch", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForCreateOnly | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForCreateOnly(opts);
        mockGitOps.fileExistsOnBaseBranch = false;
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `createonly-new-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "config.json",
            content: { key: "value" },
            createOnly: true,
          },
        ],
      };

      const result = await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
      });

      // Should not be skipped because file doesn't exist
      assert.notEqual(result.skipped, true, "Should not be skipped");
    });

    test("should not delete createOnly file when tracked in manifest and exists on base branch (issue #199)", async () => {
      const mockLogger = createMockLogger();

      // Extended mock that tracks deletion behavior
      class MockGitOpsForCreateOnlyDeletion extends MockGitOpsForCreateOnly {
        deletedFiles: string[] = [];
        existingLocalFiles: Set<string> = new Set();

        override fileExists(fileName: string): boolean {
          return this.existingLocalFiles.has(fileName);
        }

        override deleteFile(fileName: string): void {
          this.deletedFiles.push(fileName);
          this.existingLocalFiles.delete(fileName);
        }

        setupExistingLocalFile(fileName: string): void {
          this.existingLocalFiles.add(fileName);
        }
      }

      let mockGitOps: MockGitOpsForCreateOnlyDeletion | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForCreateOnlyDeletion(opts);
        mockGitOps.fileExistsOnBaseBranch = true; // File exists on base branch
        mockGitOps.setupExistingLocalFile("config.json"); // File exists locally too
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `createonly-no-delete-${Date.now()}`);

      // Create manifest file tracking config.json (simulating previous sync)
      mkdirSync(localWorkDir, { recursive: true });
      writeFileSync(
        join(localWorkDir, ".xfg.json"),
        JSON.stringify({
          version: 2,
          configs: { "test-config": ["config.json"] },
        })
      );

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "config.json",
            content: { key: "value" },
            createOnly: true,
            deleteOrphaned: true, // Would delete if orphaned, but shouldn't be orphaned
          },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: createMockExecutor(),
      });

      // The file should NOT be deleted - it's still in the config, just skipped due to createOnly
      assert.equal(
        mockGitOps!.deletedFiles.length,
        0,
        `Should not delete createOnly file that exists on base branch, but deleted: ${mockGitOps!.deletedFiles.join(", ")}`
      );

      // Verify the skip message was logged
      const skipMessage = mockLogger.messages.find(
        (m) => m.includes("Skipping") && m.includes("createOnly")
      );
      assert.ok(skipMessage, "Should log skip message for createOnly");
    });
  });

  describe("template handling", () => {
    const createMockLogger = (): ILogger & { messages: string[] } => ({
      messages: [] as string[],
      info(message: string) {
        this.messages.push(message);
      },
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number
      ) {
        // No-op for mock
      },
    });

    class MockGitOpsForTemplate extends GitOps {
      writtenContent: Map<string, string> = new Map();

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
        const filePath = join(this.getWorkDir(), fileName);
        mkdirSync(this.getWorkDir(), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
        this.writtenContent.set(fileName, content);
      }

      override getFileContent(_fileName: string): string | null {
        return null;
      }

      override wouldChange(_fileName: string, _content: string): boolean {
        return true;
      }

      override async hasChanges(): Promise<boolean> {
        return true;
      }

      override async getChangedFiles(): Promise<string[]> {
        return Array.from(this.writtenContent.keys());
      }

      override async commit(_message: string): Promise<boolean> {
        return true;
      }

      override async push(_branchName: string): Promise<void> {
        // No-op for mock
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }
    }

    test("should interpolate xfg template variables when template is enabled", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForTemplate | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForTemplate(opts);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `template-test-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "README.md",
            content: "# ${xfg:repo.name}\n\nOwner: ${xfg:repo.owner}",
            template: true,
          },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: createMockExecutor(),
      });

      const writtenContent = mockGitOps!.writtenContent.get("README.md");
      assert.ok(writtenContent, "Should have written README.md");
      assert.ok(
        writtenContent.includes("# repo"),
        "Should interpolate repo.name"
      );
      assert.ok(
        writtenContent.includes("Owner: test"),
        "Should interpolate repo.owner"
      );
    });

    test("should use custom vars in template when provided", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForTemplate | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForTemplate(opts);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `template-vars-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "config.txt",
            content: "Team: ${xfg:team}",
            template: true,
            vars: { team: "Platform" },
          },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: createMockExecutor(),
      });

      const writtenContent = mockGitOps!.writtenContent.get("config.txt");
      assert.ok(writtenContent, "Should have written config.txt");
      assert.ok(
        writtenContent.includes("Team: Platform"),
        "Should interpolate custom var"
      );
    });
  });

  describe("commit message formatting", () => {
    const createMockLogger = (): ILogger & { messages: string[] } => ({
      messages: [] as string[],
      info(message: string) {
        this.messages.push(message);
      },
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number
      ) {
        // No-op for mock
      },
    });

    class MockGitOpsForCommit extends GitOps {
      lastCommitMessage: string | null = null;

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
        const filePath = join(this.getWorkDir(), fileName);
        mkdirSync(this.getWorkDir(), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }

      override wouldChange(_fileName: string, _content: string): boolean {
        return true;
      }

      override async hasChanges(): Promise<boolean> {
        return true;
      }

      override async getChangedFiles(): Promise<string[]> {
        return ["config1.json", "config2.json", "config3.json"];
      }

      override async commit(message: string): Promise<boolean> {
        this.lastCommitMessage = message;
        return true;
      }

      override async push(_branchName: string): Promise<void> {
        // No-op for mock
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }
    }

    test("should format commit message for 2-3 files with file names", async () => {
      const mockLogger = createMockLogger();

      const mockFactory: GitOpsFactory = (opts) => {
        return new MockGitOpsForCommit(opts);
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `commit-msg-23-${Date.now()}`);
      const trackingExecutor = createTrackingMockExecutor();

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          { fileName: "config1.json", content: { key: "value1" } },
          { fileName: "config2.json", content: { key: "value2" } },
          { fileName: "config3.json", content: { key: "value3" } },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      assert.ok(
        trackingExecutor.lastCommitMessage,
        "Should have commit message"
      );
      assert.ok(
        trackingExecutor.lastCommitMessage.includes("config1.json"),
        "Should include first file name"
      );
      assert.ok(
        trackingExecutor.lastCommitMessage.includes("config2.json"),
        "Should include second file name"
      );
    });

    test("should format commit message for more than 3 files with count", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForCommit | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForCommit(opts);
        // Override to return 4 files
        mockGitOps.getChangedFiles = async () => [
          "config1.json",
          "config2.json",
          "config3.json",
          "config4.json",
        ];
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `commit-msg-many-${Date.now()}`);
      const trackingExecutor = createTrackingMockExecutor();

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          { fileName: "config1.json", content: { key: "value1" } },
          { fileName: "config2.json", content: { key: "value2" } },
          { fileName: "config3.json", content: { key: "value3" } },
          { fileName: "config4.json", content: { key: "value4" } },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      assert.ok(
        trackingExecutor.lastCommitMessage,
        "Should have commit message"
      );
      assert.ok(
        trackingExecutor.lastCommitMessage.includes("4 config files"),
        `Should show file count, got: ${trackingExecutor.lastCommitMessage}`
      );
    });
  });

  describe("cleanup error handling", () => {
    const createMockLogger = (): ILogger & { messages: string[] } => ({
      messages: [] as string[],
      info(message: string) {
        this.messages.push(message);
      },
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number
      ) {
        // No-op for mock
      },
    });

    class MockGitOpsWithCleanupError extends GitOps {
      cleanupCallCount = 0;
      shouldFailCleanup = false;

      constructor(options: GitOpsOptions) {
        super(options);
      }

      override cleanWorkspace(): void {
        this.cleanupCallCount++;
        if (this.shouldFailCleanup && this.cleanupCallCount > 1) {
          throw new Error("Cleanup failed");
        }
        mkdirSync(this.getWorkDir(), { recursive: true });
      }

      override async clone(_gitUrl: string): Promise<void> {
        throw new Error("Clone failed"); // Trigger error path
      }

      override async getDefaultBranch(): Promise<{
        branch: string;
        method: string;
      }> {
        return { branch: "main", method: "mock" };
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }
    }

    test("should suppress cleanup errors in finally block", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsWithCleanupError | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsWithCleanupError(opts);
        mockGitOps.shouldFailCleanup = true;
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `cleanup-error-${Date.now()}`);

      // The processor throws errors from clone, it doesn't catch them
      // The test verifies that cleanup errors in finally block are suppressed
      // (i.e., the original clone error is thrown, not the cleanup error)
      try {
        await processor.process(mockRepoConfig, mockRepoInfo, {
          branchName: "chore/sync-config",
          workDir: localWorkDir,
          configId: "test-config",
          dryRun: false,
          executor: createMockExecutor(),
        });
        assert.fail("Should have thrown an error");
      } catch (error) {
        // Should throw clone error, not cleanup error
        assert.ok(error instanceof Error);
        assert.ok(
          error.message.includes("Clone failed"),
          "Error should be from clone, not cleanup"
        );
      }

      // Cleanup should have been attempted twice (initial + finally)
      assert.ok(
        mockGitOps!.cleanupCallCount >= 2,
        "Should attempt cleanup in finally block"
      );
    });
  });

  describe("orphaned file deletion", () => {
    const createMockLogger = (): ILogger & {
      messages: string[];
      diffStatuses: Array<{ fileName: string; status: string }>;
    } => ({
      messages: [] as string[],
      diffStatuses: [] as Array<{ fileName: string; status: string }>,
      info(message: string) {
        this.messages.push(message);
      },
      fileDiff(fileName: string, status: unknown, _diffLines: string[]) {
        this.diffStatuses.push({ fileName, status: String(status) });
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number,
        _deletedCount?: number
      ) {
        // No-op for mock
      },
    });

    class MockGitOpsForDeletion extends GitOps {
      deletedFiles: string[] = [];
      existingFiles: Set<string> = new Set();
      lastCommitMessage: string | null = null;

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
        const filePath = join(this.getWorkDir(), fileName);
        mkdirSync(this.getWorkDir(), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
        this.existingFiles.add(fileName);
      }

      override wouldChange(_fileName: string, _content: string): boolean {
        return true;
      }

      override async hasChanges(): Promise<boolean> {
        return true;
      }

      override async getChangedFiles(): Promise<string[]> {
        return Array.from(this.existingFiles);
      }

      override async commit(message: string): Promise<boolean> {
        this.lastCommitMessage = message;
        return true;
      }

      override async push(_branchName: string): Promise<void> {
        // No-op for mock
      }

      override fileExists(fileName: string): boolean {
        return this.existingFiles.has(fileName);
      }

      override deleteFile(fileName: string): void {
        this.deletedFiles.push(fileName);
        this.existingFiles.delete(fileName);
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }

      // Setup helper to simulate existing files
      setupExistingFile(fileName: string): void {
        this.existingFiles.add(fileName);
      }
    }

    test("should delete orphaned file when removed from config", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForDeletion | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForDeletion(opts);
        // Simulate orphaned.json exists in the repo (from previous sync)
        mockGitOps.setupExistingFile("orphaned.json");
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `delete-orphaned-${Date.now()}`);

      // Create manifest file to track orphaned.json
      mkdirSync(localWorkDir, { recursive: true });
      writeFileSync(
        join(localWorkDir, ".xfg.json"),
        JSON.stringify({
          version: 2,
          configs: { "test-config": ["orphaned.json"] },
        })
      );

      // Config only has config.json (orphaned.json removed)
      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "config.json",
            content: { key: "value" },
            deleteOrphaned: true,
          },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: createMockExecutor(),
      });

      // Should have deleted orphaned.json
      assert.ok(
        mockGitOps!.deletedFiles.includes("orphaned.json"),
        "Should delete orphaned file"
      );
    });

    test("should skip deletion with noDelete option", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForDeletion | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForDeletion(opts);
        mockGitOps.setupExistingFile("orphaned.json");
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `nodelete-${Date.now()}`);

      // Create manifest file
      mkdirSync(localWorkDir, { recursive: true });
      writeFileSync(
        join(localWorkDir, ".xfg.json"),
        JSON.stringify({
          version: 2,
          configs: { "test-config": ["orphaned.json"] },
        })
      );

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: createMockExecutor(),
        noDelete: true,
      });

      // Should NOT have deleted anything
      assert.equal(
        mockGitOps!.deletedFiles.length,
        0,
        "Should not delete files with noDelete flag"
      );
      assert.ok(
        mockLogger.messages.some((m) => m.includes("--no-delete")),
        "Should log that deletion was skipped"
      );
    });

    test("should show DELETED status in dry-run mode", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForDeletion | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForDeletion(opts);
        mockGitOps.setupExistingFile("orphaned.json");
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `dryrun-delete-${Date.now()}`);

      // Create manifest file
      mkdirSync(localWorkDir, { recursive: true });
      writeFileSync(
        join(localWorkDir, ".xfg.json"),
        JSON.stringify({
          version: 2,
          configs: { "test-config": ["orphaned.json"] },
        })
      );

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "config.json",
            content: { key: "value" },
            deleteOrphaned: true,
          },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
      });

      // Should NOT actually delete file
      assert.equal(
        mockGitOps!.deletedFiles.length,
        0,
        "Should not delete files in dry-run"
      );

      // Should show DELETED status in log
      assert.ok(
        mockLogger.diffStatuses.some(
          (s) => s.fileName === "orphaned.json" && s.status === "DELETED"
        ),
        "Should log DELETED status for orphaned file"
      );
    });

    test("should track deleted file in changed files list", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForDeletion | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForDeletion(opts);
        mockGitOps.setupExistingFile("orphaned.json");
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `track-delete-${Date.now()}`);
      const trackingExecutor = createTrackingMockExecutor();

      // Create manifest file
      mkdirSync(localWorkDir, { recursive: true });
      writeFileSync(
        join(localWorkDir, ".xfg.json"),
        JSON.stringify({
          version: 2,
          configs: { "test-config": ["orphaned.json"] },
        })
      );

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "config.json",
            content: { key: "value" },
            deleteOrphaned: true,
          },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      // orphaned.json should have been deleted
      assert.ok(
        mockGitOps!.deletedFiles.includes("orphaned.json"),
        "Should delete orphaned file"
      );
      // Commit message should include the deleted file
      assert.ok(
        trackingExecutor.lastCommitMessage?.includes("orphaned.json"),
        `Commit message should include deleted file, got: ${trackingExecutor.lastCommitMessage}`
      );
    });
  });

  describe("file count in changedFiles (issue #184)", () => {
    const createMockLogger = (): ILogger & { messages: string[] } => ({
      messages: [] as string[],
      info(message: string) {
        this.messages.push(message);
      },
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number
      ) {
        // No-op for mock
      },
    });

    class MockGitOpsForFileCount extends GitOps {
      lastCommitMessage: string | null = null;
      gitChangedFilesOverride: string[] = [];
      fileExistsOnBranchOverride: boolean = false;

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
        const filePath = join(this.getWorkDir(), fileName);
        mkdirSync(this.getWorkDir(), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }

      override wouldChange(_fileName: string, _content: string): boolean {
        return true;
      }

      override async hasChanges(): Promise<boolean> {
        return true;
      }

      override async getChangedFiles(): Promise<string[]> {
        return this.gitChangedFilesOverride;
      }

      override async fileExistsOnBranch(
        _fileName: string,
        _branch: string
      ): Promise<boolean> {
        return this.fileExistsOnBranchOverride;
      }

      override async commit(message: string): Promise<boolean> {
        this.lastCommitMessage = message;
        return true;
      }

      override async push(_branchName: string): Promise<void> {
        // No-op for mock
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }
    }

    test("should include manifest file in changedFiles when git reports it as changed", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForFileCount | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForFileCount(opts);
        // Git reports both config.json and .xfg.json as changed
        // This simulates when manifestChanged was false (semantic content same)
        // but git sees a formatting change
        mockGitOps.gitChangedFilesOverride = ["config.json", ".xfg.json"];
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `file-count-manifest-${Date.now()}`);
      const trackingExecutor = createTrackingMockExecutor();

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "config.json",
            content: { key: "value" },
            deleteOrphaned: true,
          },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      // Commit message should mention 2 files (config.json and .xfg.json)
      assert.ok(
        trackingExecutor.lastCommitMessage,
        "Should have commit message"
      );
      // Either lists both files or says "2 config files"
      const hasConfigJson =
        trackingExecutor.lastCommitMessage.includes("config.json");
      const hasXfgJson =
        trackingExecutor.lastCommitMessage.includes(".xfg.json");
      const hasTwoFiles =
        trackingExecutor.lastCommitMessage.includes("2 config files");
      assert.ok(
        (hasConfigJson && hasXfgJson) || hasTwoFiles,
        `Commit message should include both files or show '2 config files', got: ${trackingExecutor.lastCommitMessage}`
      );
    });

    test("should include files from git status that aren't in repoConfig.files", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForFileCount | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForFileCount(opts);
        // Git reports extra-file.json as changed, but it's not in repoConfig.files
        // This could happen if a file is manually added to the repo
        mockGitOps.gitChangedFilesOverride = ["config.json", "extra-file.json"];
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `file-count-extra-${Date.now()}`);
      const trackingExecutor = createTrackingMockExecutor();

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "config.json",
            content: { key: "value" },
          },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      // Commit message should mention 2 files
      assert.ok(
        trackingExecutor.lastCommitMessage,
        "Should have commit message"
      );
      const hasConfigJson =
        trackingExecutor.lastCommitMessage.includes("config.json");
      const hasExtraFile =
        trackingExecutor.lastCommitMessage.includes("extra-file.json");
      const hasTwoFiles =
        trackingExecutor.lastCommitMessage.includes("2 config files");
      assert.ok(
        (hasConfigJson && hasExtraFile) || hasTwoFiles,
        `Commit message should include both files or show '2 config files', got: ${trackingExecutor.lastCommitMessage}`
      );
    });

    test("should skip config files not reported by git as changed", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForFileCount | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForFileCount(opts);
        // Git only reports config1.json as changed, not config2.json
        mockGitOps.gitChangedFilesOverride = ["config1.json"];
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(
        testDir,
        `file-count-skip-unchanged-${Date.now()}`
      );
      const trackingExecutor = createTrackingMockExecutor();

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          { fileName: "config1.json", content: { key: "value1" } },
          { fileName: "config2.json", content: { key: "value2" } },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      // Commit message should only mention config1.json
      assert.ok(
        trackingExecutor.lastCommitMessage,
        "Should have commit message"
      );
      assert.ok(
        trackingExecutor.lastCommitMessage.includes("config1.json"),
        "Should include config1.json"
      );
      assert.ok(
        !trackingExecutor.lastCommitMessage.includes("config2.json"),
        `Should not include config2.json, got: ${trackingExecutor.lastCommitMessage}`
      );
    });

    test("should not double-count skipped files in config loop", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForFileCount | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForFileCount(opts);
        // Git reports both files as changed
        mockGitOps.gitChangedFilesOverride = ["skipped.json", "actual.json"];
        // Override to make skipped.json exist on base branch (triggers createOnly skip)
        mockGitOps.fileExistsOnBranchOverride = true;
        // Custom override to only skip skipped.json
        mockGitOps.fileExistsOnBranch = async (fileName: string) => {
          return fileName === "skipped.json";
        };
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `file-count-no-double-${Date.now()}`);
      const trackingExecutor = createTrackingMockExecutor();

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "skipped.json",
            content: { key: "skipped" },
            createOnly: true, // This will be skipped (exists on base)
          },
          {
            fileName: "actual.json",
            content: { key: "actual" },
          },
        ],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      // Commit message should only mention actual.json, not skipped.json
      assert.ok(
        trackingExecutor.lastCommitMessage,
        "Should have commit message"
      );
      assert.ok(
        trackingExecutor.lastCommitMessage.includes("actual.json"),
        "Should include actual.json"
      );
      assert.ok(
        !trackingExecutor.lastCommitMessage.includes("skipped.json"),
        `Should not include skipped.json, got: ${trackingExecutor.lastCommitMessage}`
      );
    });

    test("should handle update action for existing extra files from git status", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForFileCount | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForFileCount(opts);
        // Git reports an extra file that exists (update action)
        mockGitOps.gitChangedFilesOverride = [
          "config.json",
          "existing-extra.json",
        ];
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(
        testDir,
        `file-count-update-extra-${Date.now()}`
      );
      const trackingExecutor = createTrackingMockExecutor();

      // Pre-create the extra file so it triggers "update" action
      mkdirSync(localWorkDir, { recursive: true });
      writeFileSync(join(localWorkDir, "existing-extra.json"), '{"old": true}');

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      // Commit message should mention 2 files
      assert.ok(
        trackingExecutor.lastCommitMessage,
        "Should have commit message"
      );
      const hasTwoFiles =
        trackingExecutor.lastCommitMessage.includes("2 config files") ||
        (trackingExecutor.lastCommitMessage.includes("config.json") &&
          trackingExecutor.lastCommitMessage.includes("existing-extra.json"));
      assert.ok(
        hasTwoFiles,
        `Commit message should include both files, got: ${trackingExecutor.lastCommitMessage}`
      );
    });
  });

  describe("CommitStrategy integration", () => {
    const createMockLogger = (): ILogger & { messages: string[] } => ({
      messages: [] as string[],
      info(message: string) {
        this.messages.push(message);
      },
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number
      ) {
        // No-op for mock
      },
    });

    class MockGitOpsForCommitStrategy extends GitOps {
      gitChangedFilesOverride: string[] = [];

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
        const filePath = join(this.getWorkDir(), fileName);
        mkdirSync(this.getWorkDir(), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }

      override async hasChanges(): Promise<boolean> {
        return this.gitChangedFilesOverride.length > 0;
      }

      override async getChangedFiles(): Promise<string[]> {
        return this.gitChangedFilesOverride;
      }

      override async fileExistsOnBranch(
        _fileName: string,
        _branch: string
      ): Promise<boolean> {
        return false;
      }

      // Note: commit and push are not called when using CommitStrategy
      override async commit(_message: string): Promise<boolean> {
        return true;
      }

      override async push(_branchName: string): Promise<void> {
        // No-op for mock
      }

      override async fetch(): Promise<void> {
        // No-op for mock
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }
    }

    test("should use GraphQL commit strategy when GH_INSTALLATION_TOKEN is set", async () => {
      // Save original env value
      const originalToken = process.env.GH_INSTALLATION_TOKEN;

      try {
        // Set GH_INSTALLATION_TOKEN to trigger GraphQL strategy
        process.env.GH_INSTALLATION_TOKEN = "test-installation-token";

        const mockLogger = createMockLogger();
        let mockGitOps: MockGitOpsForCommitStrategy | null = null;

        const mockFactory: GitOpsFactory = (opts) => {
          mockGitOps = new MockGitOpsForCommitStrategy(opts);
          mockGitOps.gitChangedFilesOverride = ["config.json"];
          return mockGitOps;
        };

        // Track executor calls to verify GraphQL vs git commit
        const executorCalls: string[] = [];
        const mockExecutor: CommandExecutor = {
          async exec(command: string): Promise<string> {
            executorCalls.push(command);

            // Return mock responses for GraphQL call
            if (command.includes("gh api graphql")) {
              return JSON.stringify({
                data: {
                  createCommitOnBranch: {
                    commit: { oid: "abc123def456" },
                  },
                },
              });
            }
            // Return mock PR URL
            if (command.includes("gh pr create")) {
              return "https://github.com/test/repo/pull/123";
            }
            // Return mock HEAD sha for GraphQL strategy
            if (command.includes("git rev-parse HEAD")) {
              return "deadbeef1234567890";
            }
            return "";
          },
        };

        const processor = new RepositoryProcessor(mockFactory, mockLogger);
        const localWorkDir = join(
          testDir,
          `commit-strategy-graphql-${Date.now()}`
        );

        const repoConfig: RepoConfig = {
          git: "git@github.com:test/repo.git",
          files: [{ fileName: "config.json", content: { key: "value" } }],
        };

        const result = await processor.process(repoConfig, mockRepoInfo, {
          branchName: "chore/sync-config",
          workDir: localWorkDir,
          configId: "test-config",
          dryRun: false,
          executor: mockExecutor,
        });

        assert.equal(result.success, true, "Should succeed");

        // Verify GraphQL was called
        const graphqlCall = executorCalls.find((c) =>
          c.includes("gh api graphql")
        );
        assert.ok(graphqlCall, "Should call gh api graphql");
        assert.ok(
          graphqlCall.includes("createCommitOnBranch"),
          "GraphQL call should use createCommitOnBranch mutation"
        );

        // Verify git commit was NOT called (we use GraphQL instead)
        const gitCommitCall = executorCalls.find((c) =>
          c.includes("git commit")
        );
        assert.ok(
          !gitCommitCall,
          `Should NOT call git commit when using GraphQL strategy, but found: ${gitCommitCall}`
        );

        // Verify log message mentions verified commit
        const verifiedLog = mockLogger.messages.find((m) =>
          m.includes("verified")
        );
        assert.ok(verifiedLog, "Should log that commit is verified");
      } finally {
        // Restore original env value
        if (originalToken === undefined) {
          delete process.env.GH_INSTALLATION_TOKEN;
        } else {
          process.env.GH_INSTALLATION_TOKEN = originalToken;
        }
      }
    });

    test("direct mode with CommitStrategy should return helpful error on branch protection", async () => {
      // Save original env value
      const originalToken = process.env.GH_INSTALLATION_TOKEN;

      try {
        // Set GH_INSTALLATION_TOKEN to trigger GraphQL strategy
        process.env.GH_INSTALLATION_TOKEN = "test-installation-token";

        const mockLogger = createMockLogger();
        let mockGitOps: MockGitOpsForCommitStrategy | null = null;

        const mockFactory: GitOpsFactory = (opts) => {
          mockGitOps = new MockGitOpsForCommitStrategy(opts);
          mockGitOps.gitChangedFilesOverride = ["config.json"];
          return mockGitOps;
        };

        // Mock executor that fails on GraphQL commit with branch protection error
        const mockExecutor: CommandExecutor = {
          async exec(command: string): Promise<string> {
            if (command.includes("gh api graphql")) {
              throw new Error("Push rejected: protected branch");
            }
            if (command.includes("git rev-parse HEAD")) {
              return "deadbeef1234567890";
            }
            return "";
          },
        };

        const processor = new RepositoryProcessor(mockFactory, mockLogger);
        const localWorkDir = join(
          testDir,
          `commit-strategy-protection-${Date.now()}`
        );

        const repoConfig: RepoConfig = {
          git: "git@github.com:test/repo.git",
          files: [{ fileName: "config.json", content: { key: "value" } }],
          prOptions: { merge: "direct" },
        };

        const result = await processor.process(repoConfig, mockRepoInfo, {
          branchName: "chore/sync-config",
          workDir: localWorkDir,
          configId: "test-config",
          dryRun: false,
          executor: mockExecutor,
        });

        assert.equal(result.success, false, "Should fail");
        assert.ok(
          result.message.includes("rejected") ||
            result.message.includes("protected"),
          "Message should mention rejection or protection"
        );
        assert.ok(
          result.message.includes("merge: force"),
          "Message should suggest using force mode"
        );
      } finally {
        // Restore original env value
        if (originalToken === undefined) {
          delete process.env.GH_INSTALLATION_TOKEN;
        } else {
          process.env.GH_INSTALLATION_TOKEN = originalToken;
        }
      }
    });

    test("direct mode handles 'protected' keyword in error message", async () => {
      const originalToken = process.env.GH_INSTALLATION_TOKEN;

      try {
        process.env.GH_INSTALLATION_TOKEN = "test-installation-token";

        const mockLogger = createMockLogger();
        let mockGitOps: MockGitOpsForCommitStrategy | null = null;

        const mockFactory: GitOpsFactory = (opts) => {
          mockGitOps = new MockGitOpsForCommitStrategy(opts);
          mockGitOps.gitChangedFilesOverride = ["config.json"];
          return mockGitOps;
        };

        const mockExecutor: CommandExecutor = {
          async exec(command: string): Promise<string> {
            if (command.includes("gh api graphql")) {
              throw new Error("Cannot push to protected branch");
            }
            if (command.includes("git rev-parse HEAD")) {
              return "deadbeef1234567890";
            }
            return "";
          },
        };

        const processor = new RepositoryProcessor(mockFactory, mockLogger);
        const localWorkDir = join(
          testDir,
          `commit-strategy-protected-${Date.now()}`
        );

        const repoConfig: RepoConfig = {
          git: "git@github.com:test/repo.git",
          files: [{ fileName: "config.json", content: { key: "value" } }],
          prOptions: { merge: "direct" },
        };

        const result = await processor.process(repoConfig, mockRepoInfo, {
          branchName: "chore/sync-config",
          workDir: localWorkDir,
          configId: "test-config",
          dryRun: false,
          executor: mockExecutor,
        });

        assert.equal(result.success, false, "Should fail");
        assert.ok(
          result.message.includes("branch protection"),
          "Message should mention branch protection"
        );
      } finally {
        if (originalToken === undefined) {
          delete process.env.GH_INSTALLATION_TOKEN;
        } else {
          process.env.GH_INSTALLATION_TOKEN = originalToken;
        }
      }
    });

    test("direct mode handles 'denied' keyword in error message", async () => {
      const originalToken = process.env.GH_INSTALLATION_TOKEN;

      try {
        process.env.GH_INSTALLATION_TOKEN = "test-installation-token";

        const mockLogger = createMockLogger();
        let mockGitOps: MockGitOpsForCommitStrategy | null = null;

        const mockFactory: GitOpsFactory = (opts) => {
          mockGitOps = new MockGitOpsForCommitStrategy(opts);
          mockGitOps.gitChangedFilesOverride = ["config.json"];
          return mockGitOps;
        };

        const mockExecutor: CommandExecutor = {
          async exec(command: string): Promise<string> {
            if (command.includes("gh api graphql")) {
              throw new Error("Permission denied for this operation");
            }
            if (command.includes("git rev-parse HEAD")) {
              return "deadbeef1234567890";
            }
            return "";
          },
        };

        const processor = new RepositoryProcessor(mockFactory, mockLogger);
        const localWorkDir = join(
          testDir,
          `commit-strategy-denied-${Date.now()}`
        );

        const repoConfig: RepoConfig = {
          git: "git@github.com:test/repo.git",
          files: [{ fileName: "config.json", content: { key: "value" } }],
          prOptions: { merge: "direct" },
        };

        const result = await processor.process(repoConfig, mockRepoInfo, {
          branchName: "chore/sync-config",
          workDir: localWorkDir,
          configId: "test-config",
          dryRun: false,
          executor: mockExecutor,
        });

        assert.equal(result.success, false, "Should fail");
        assert.ok(
          result.message.includes("branch protection"),
          "Message should mention branch protection"
        );
      } finally {
        if (originalToken === undefined) {
          delete process.env.GH_INSTALLATION_TOKEN;
        } else {
          process.env.GH_INSTALLATION_TOKEN = originalToken;
        }
      }
    });

    test("direct mode re-throws unrecognized errors", async () => {
      const originalToken = process.env.GH_INSTALLATION_TOKEN;

      try {
        process.env.GH_INSTALLATION_TOKEN = "test-installation-token";

        const mockLogger = createMockLogger();
        let mockGitOps: MockGitOpsForCommitStrategy | null = null;

        const mockFactory: GitOpsFactory = (opts) => {
          mockGitOps = new MockGitOpsForCommitStrategy(opts);
          mockGitOps.gitChangedFilesOverride = ["config.json"];
          return mockGitOps;
        };

        const mockExecutor: CommandExecutor = {
          async exec(command: string): Promise<string> {
            if (command.includes("gh api graphql")) {
              throw new Error("Network timeout");
            }
            if (command.includes("git rev-parse HEAD")) {
              return "deadbeef1234567890";
            }
            return "";
          },
        };

        const processor = new RepositoryProcessor(mockFactory, mockLogger);
        const localWorkDir = join(
          testDir,
          `commit-strategy-network-${Date.now()}`
        );

        const repoConfig: RepoConfig = {
          git: "git@github.com:test/repo.git",
          files: [{ fileName: "config.json", content: { key: "value" } }],
          prOptions: { merge: "direct" },
        };

        await assert.rejects(
          () =>
            processor.process(repoConfig, mockRepoInfo, {
              branchName: "chore/sync-config",
              workDir: localWorkDir,
              configId: "test-config",
              dryRun: false,
              executor: mockExecutor,
            }),
          /Network timeout/,
          "Should re-throw unrecognized errors"
        );
      } finally {
        if (originalToken === undefined) {
          delete process.env.GH_INSTALLATION_TOKEN;
        } else {
          process.env.GH_INSTALLATION_TOKEN = originalToken;
        }
      }
    });
  });

  describe("diffStats in non-dry-run mode (issue #252)", () => {
    const createMockLogger = (): ILogger & { messages: string[] } => ({
      messages: [] as string[],
      info(message: string) {
        this.messages.push(message);
      },
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number
      ) {
        // No-op for mock
      },
    });

    class MockGitOpsForDiffStats extends GitOps {
      gitChangedFilesOverride: string[] = [];
      fileExistsMap: Map<string, boolean> = new Map();

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
        const filePath = join(this.getWorkDir(), fileName);
        mkdirSync(this.getWorkDir(), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }

      override async hasChanges(): Promise<boolean> {
        return this.gitChangedFilesOverride.length > 0;
      }

      override async getChangedFiles(): Promise<string[]> {
        return this.gitChangedFilesOverride;
      }

      override async fileExistsOnBranch(
        _fileName: string,
        _branch: string
      ): Promise<boolean> {
        return false;
      }

      override async commit(_message: string): Promise<boolean> {
        return true;
      }

      override async push(_branchName: string): Promise<void> {
        // No-op for mock
      }

      override async fetch(): Promise<void> {
        // No-op for mock
      }

      override fileExists(fileName: string): boolean {
        return this.fileExistsMap.get(fileName) ?? false;
      }

      override deleteFile(_fileName: string): void {
        // No-op for mock
      }

      private getWorkDir(): string {
        return (this as unknown as { workDir: string }).workDir;
      }

      setupFileExists(fileName: string, exists: boolean): void {
        this.fileExistsMap.set(fileName, exists);
      }
    }

    // Mock executor that returns a PR URL (safe test mock - no actual shell execution)
    function createPRMockExecutor(): CommandExecutor {
      return {
        async exec(): Promise<string> {
          return "https://github.com/test/repo/pull/123";
        },
      };
    }

    test("should populate diffStats with correct counts in non-dry-run mode", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForDiffStats | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForDiffStats(opts);
        // Git reports 2 files changed: one new, one update
        mockGitOps.gitChangedFilesOverride = ["new-file.json", "existing.json"];
        // existing.json exists (update), new-file.json doesn't (create)
        mockGitOps.setupFileExists("existing.json", true);
        mockGitOps.setupFileExists("new-file.json", false);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `diffstats-nondr-${Date.now()}`);

      // Pre-create existing.json so existsSync returns true for it
      mkdirSync(localWorkDir, { recursive: true });
      writeFileSync(join(localWorkDir, "existing.json"), '{"old": true}');

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          { fileName: "new-file.json", content: { key: "new" } },
          { fileName: "existing.json", content: { key: "updated" } },
        ],
      };

      const result = await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: createPRMockExecutor(),
      });

      assert.equal(result.success, true, "Should succeed");
      assert.ok(result.diffStats, "Should have diffStats");
      assert.equal(
        result.diffStats!.newCount,
        1,
        "Should have 1 new file (new-file.json)"
      );
      assert.equal(
        result.diffStats!.modifiedCount,
        1,
        "Should have 1 modified file (existing.json)"
      );
      assert.equal(result.diffStats!.deletedCount, 0, "Should have 0 deleted");
    });

    test("should count deleted files in diffStats", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForDiffStats | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForDiffStats(opts);
        // Git reports config.json changed, orphaned.json will be deleted
        mockGitOps.gitChangedFilesOverride = ["config.json"];
        mockGitOps.setupFileExists("orphaned.json", true); // Orphan exists
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `diffstats-delete-${Date.now()}`);

      // Create manifest tracking orphaned.json
      mkdirSync(localWorkDir, { recursive: true });
      writeFileSync(
        join(localWorkDir, ".xfg.json"),
        JSON.stringify({
          version: 2,
          configs: { "test-config": ["orphaned.json"] },
        })
      );

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "config.json",
            content: { key: "value" },
            deleteOrphaned: true,
          },
        ],
      };

      const result = await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: createPRMockExecutor(),
      });

      assert.equal(result.success, true, "Should succeed");
      assert.ok(result.diffStats, "Should have diffStats");
      assert.equal(
        result.diffStats!.newCount,
        1,
        "Should have 1 new file (config.json)"
      );
      assert.equal(
        result.diffStats!.deletedCount,
        1,
        "Should have 1 deleted file (orphaned.json)"
      );
    });
  });
});
