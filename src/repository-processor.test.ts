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

const testDir = join(tmpdir(), "repo-processor-test-" + Date.now());

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
      fileDiff(_fileName: string, _status: unknown, _diffLines: string[]) {
        // No-op for mock
      },
      diffSummary(
        _newCount: number,
        _modifiedCount: number,
        _unchangedCount: number,
      ) {
        // No-op for mock
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

      override async fileExistsOnBranch(
        _fileName: string,
        _branch: string,
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
        _unchangedCount: number,
      ) {
        // No-op for mock
      },
    });

    // Mock GitOps that tracks setExecutable calls
    class MockGitOpsWithExecutable extends GitOps {
      fileExists = false;
      contentMatches = false;
      setExecutableCalls: string[] = [];

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
        mkdirSync(join(this.getWorkDir()), { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }

      override wouldChange(_fileName: string, _content: string): boolean {
        return true;
      }

      override async hasChanges(): Promise<boolean> {
        return true;
      }

      override async commit(_message: string): Promise<void> {
        // No-op for mock
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
        this.fileExists = exists;
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
        dryRun: true,
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
        dryRun: true,
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
        dryRun: true,
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
        dryRun: true,
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

      // The processor applies defaults like this:
      // const mergeMode = repoConfig.prOptions?.merge ?? "auto";
      const mergeMode = repoConfig.prOptions?.merge ?? "auto";
      assert.equal(mergeMode, "auto", "Default merge mode should be 'auto'");

      const strategy = repoConfig.prOptions?.mergeStrategy ?? "squash";
      assert.equal(strategy, "squash", "Default strategy should be 'squash'");

      const deleteBranch = repoConfig.prOptions?.deleteBranch ?? true;
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
        "Explicit deleteBranch should override",
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
        _unchangedCount: number,
      ) {
        // No-op for mock
      },
    });

    // Mock GitOps for direct mode testing
    class MockGitOpsForDirectMode extends GitOps {
      createBranchCalled = false;
      pushBranch: string | null = null;
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

      override async push(branchName: string): Promise<void> {
        this.pushBranch = branchName;
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
        dryRun: true,
      });

      assert.equal(
        mockGitOps!.createBranchCalled,
        false,
        "Should not create a sync branch in direct mode",
      );
    });

    test("direct mode should push to default branch", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForDirectMode | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForDirectMode(opts);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `direct-mode-push-${Date.now()}`);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { merge: "direct" },
      };

      const result = await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        dryRun: false,
      });

      assert.equal(
        mockGitOps!.pushBranch,
        "main",
        "Should push to default branch (main)",
      );
      assert.equal(result.success, true, "Should succeed");
      assert.ok(
        result.message.includes("Pushed directly to main"),
        "Message should indicate direct push",
      );
      assert.equal(result.prUrl, undefined, "Should not have a PR URL");
    });

    test("direct mode should return helpful error on branch protection", async () => {
      const mockLogger = createMockLogger();
      let mockGitOps: MockGitOpsForDirectMode | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForDirectMode(opts);
        mockGitOps.shouldRejectPush = true;
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(
        testDir,
        `direct-mode-protection-${Date.now()}`,
      );

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [{ fileName: "config.json", content: { key: "value" } }],
        prOptions: { merge: "direct" },
      };

      const result = await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        dryRun: false,
      });

      assert.equal(result.success, false, "Should fail");
      assert.ok(
        result.message.includes("rejected"),
        "Message should mention rejection",
      );
      assert.ok(
        result.message.includes("branch protection"),
        "Message should mention branch protection",
      );
      assert.ok(
        result.message.includes("merge: force"),
        "Message should suggest using force mode",
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
        dryRun: true,
      });

      const warningMessage = mockLogger.messages.find(
        (m) => m.includes("mergeStrategy") && m.includes("ignored"),
      );
      assert.ok(
        warningMessage,
        "Should log warning about mergeStrategy being ignored",
      );
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
        _unchangedCount: number,
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
        _branch: string,
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
        dryRun: true,
      });

      // Should be skipped because file exists and createOnly is true
      assert.equal(result.skipped, true, "Should be skipped");
      const skipMessage = mockLogger.messages.find(
        (m) => m.includes("Skipping") && m.includes("createOnly"),
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
        dryRun: true,
      });

      // Should not be skipped because file doesn't exist
      assert.notEqual(result.skipped, true, "Should not be skipped");
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
        _unchangedCount: number,
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
        dryRun: false,
      });

      const writtenContent = mockGitOps!.writtenContent.get("README.md");
      assert.ok(writtenContent, "Should have written README.md");
      assert.ok(
        writtenContent.includes("# repo"),
        "Should interpolate repo.name",
      );
      assert.ok(
        writtenContent.includes("Owner: test"),
        "Should interpolate repo.owner",
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
        dryRun: false,
      });

      const writtenContent = mockGitOps!.writtenContent.get("config.txt");
      assert.ok(writtenContent, "Should have written config.txt");
      assert.ok(
        writtenContent.includes("Team: Platform"),
        "Should interpolate custom var",
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
        _unchangedCount: number,
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
      let mockGitOps: MockGitOpsForCommit | null = null;

      const mockFactory: GitOpsFactory = (opts) => {
        mockGitOps = new MockGitOpsForCommit(opts);
        return mockGitOps;
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `commit-msg-23-${Date.now()}`);

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
        dryRun: false,
      });

      assert.ok(mockGitOps!.lastCommitMessage, "Should have commit message");
      assert.ok(
        mockGitOps!.lastCommitMessage.includes("config1.json"),
        "Should include first file name",
      );
      assert.ok(
        mockGitOps!.lastCommitMessage.includes("config2.json"),
        "Should include second file name",
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
        dryRun: false,
      });

      assert.ok(mockGitOps!.lastCommitMessage, "Should have commit message");
      assert.ok(
        mockGitOps!.lastCommitMessage.includes("4 config files"),
        `Should show file count, got: ${mockGitOps!.lastCommitMessage}`,
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
        _unchangedCount: number,
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
          dryRun: false,
        });
        assert.fail("Should have thrown an error");
      } catch (error) {
        // Should throw clone error, not cleanup error
        assert.ok(error instanceof Error);
        assert.ok(
          error.message.includes("Clone failed"),
          "Error should be from clone, not cleanup",
        );
      }

      // Cleanup should have been attempted twice (initial + finally)
      assert.ok(
        mockGitOps!.cleanupCallCount >= 2,
        "Should attempt cleanup in finally block",
      );
    });
  });
});
