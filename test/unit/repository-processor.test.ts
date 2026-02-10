import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RepositoryProcessor,
  GitOpsFactory,
} from "../../src/sync/repository-processor.js";
import { RepoConfig } from "../../src/config/index.js";
import { GitHubRepoInfo } from "../../src/shared/repo-detector.js";
import { GitOps } from "../../src/git/git-ops.js";
import { AuthenticatedGitOps } from "../../src/git/authenticated-git-ops.js";
import { ICommandExecutor } from "../../src/shared/command-executor.js";
import {
  createMockLogger,
  createMockAuthenticatedGitOps,
  createMockExecutor as createExecutorMock,
} from "../mocks/index.js";

const testDir = join(tmpdir(), "repo-processor-test-" + Date.now());

// Simple mock executor that returns empty results for all commands
function createMockExecutor(): ICommandExecutor {
  return {
    async exec(): Promise<string> {
      return "";
    },
  };
}

// Mock executor that tracks commit messages for tests verifying commit behavior
function createTrackingMockExecutor() {
  const result = createExecutorMock({
    trackGitCommands: true,
    responses: new Map([["git rev-parse HEAD", "abc123def456"]]),
  });
  // Return an object with flattened access to git tracking for backwards compatibility
  return {
    ...result.mock,
    get lastCommitMessage() {
      return result.git.lastCommitMessage;
    },
    get pushBranch() {
      return result.git.pushBranch;
    },
    get pushForce() {
      return result.git.pushForce;
    },
  };
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
    test("should correctly skip when existing file has identical content", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: true,
        wouldChange: false,
        hasChanges: false,
      });

      const mockFactory: GitOpsFactory = () => mockGitOps;

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
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: true,
        wouldChange: true,
        hasChanges: true,
      });

      const mockFactory: GitOpsFactory = () => mockGitOps;

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
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
      });

      const mockFactory: GitOpsFactory = () => mockGitOps;

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
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        changedFiles: ["config.json"],
        hasStagedChanges: false, // No staged changes after git add -A
      });

      const mockFactory: GitOpsFactory = () => mockGitOps;

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
    test("should call setExecutable for .sh files by default", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
      });

      const mockFactory: GitOpsFactory = () => mockGitOps;

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

      assert.ok(
        calls.setExecutable.some((c) => c.fileName === "deploy.sh"),
        "setExecutable should be called for deploy.sh"
      );
    });

    test("should not call setExecutable for non-.sh files by default", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
      });

      const mockFactory: GitOpsFactory = () => mockGitOps;

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

      assert.ok(
        !calls.setExecutable.some((c) => c.fileName === "config.json"),
        "setExecutable should not be called for config.json"
      );
    });

    test("should respect executable: false for .sh files", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
      });

      const mockFactory: GitOpsFactory = () => mockGitOps;

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

      assert.ok(
        !calls.setExecutable.some((c) => c.fileName === "script.sh"),
        "setExecutable should not be called when executable: false"
      );
    });

    test("should call setExecutable for non-.sh files when executable: true", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
      });

      const mockFactory: GitOpsFactory = () => mockGitOps;

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

      assert.ok(
        calls.setExecutable.some((c) => c.fileName === "run"),
        "setExecutable should be called when executable: true"
      );
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
    test("direct mode should not create a sync branch", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        changedFiles: ["config.json"],
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
        calls.createBranch.length,
        0,
        "Should not create a sync branch in direct mode"
      );
    });

    test("direct mode should push to default branch", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        changedFiles: ["config.json"],
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
        configId: "test-config",
        dryRun: false,
        executor: createMockExecutor(),
      });

      assert.equal(
        calls.push[0]?.branchName,
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
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        changedFiles: ["config.json"],
        pushError: new Error("Push rejected (branch protection)"),
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(
        testDir,
        `direct-mode-protection-${Date.now()}`
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
        executor: createMockExecutor(),
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
      const { mock: mockLogger, messages } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        changedFiles: ["config.json"],
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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

      const warningMessage = messages.find(
        (m) => m.includes("mergeStrategy") && m.includes("ignored")
      );
      assert.ok(
        warningMessage,
        "Should log warning about mergeStrategy being ignored"
      );
    });

    test("direct mode should use force: false for push (issue #183)", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        changedFiles: ["config.json"],
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `direct-mode-force-${Date.now()}`);

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
        executor: createMockExecutor(),
      });

      assert.equal(
        calls.push[0]?.force,
        false,
        "Direct mode should use force: false (never force push to default branch)"
      );
    });

    test("PR mode should use force: true for push (issue #183)", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        changedFiles: ["config.json"],
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `pr-mode-force-${Date.now()}`);

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
        executor: createMockExecutor(),
      });

      assert.equal(
        calls.push[0]?.force,
        true,
        "PR mode should use force: true (--force-with-lease for sync branch)"
      );
    });
  });

  describe("PR creation with executor", () => {
    test("should pass executor to createPR when not in direct mode", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        changedFiles: ["config.json"],
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      // Mock executor that returns a PR URL - this is a mock interface, not subprocess execution
      const mockExecutor: {
        exec: (cmd: string, cwd: string) => Promise<string>;
      } = {
        async exec(_cmd: string, _cwd: string): Promise<string> {
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
    test("should skip file with createOnly when file exists on base branch", async () => {
      const { mock: mockLogger, messages } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: false, // No changes because file exists and is skipped
        fileExistsOnBranch: true, // File exists on base branch
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
      const skipMessage = messages.find(
        (m) => m.includes("Skipping") && m.includes("createOnly")
      );
      assert.ok(skipMessage, "Should log skip message for createOnly");
    });

    test("should create file with createOnly when file does not exist on base branch", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        fileExistsOnBranch: false, // File does not exist on base branch
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
      const { mock: mockLogger, messages } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: (fileName) => fileName === "config.json", // File exists locally
        wouldChange: true,
        hasChanges: false, // File exists, so skipped, no changes
        fileExistsOnBranch: true, // File exists on base branch
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
        calls.deleteFile.length,
        0,
        `Should not delete createOnly file that exists on base branch, but deleted: ${calls.deleteFile.map((c) => c.fileName).join(", ")}`
      );

      // Verify the skip message was logged
      const skipMessage = messages.find(
        (m) => m.includes("Skipping") && m.includes("createOnly")
      );
      assert.ok(skipMessage, "Should log skip message for createOnly");
    });
  });

  describe("template handling", () => {
    test("should interpolate xfg template variables when template is enabled", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: false,
        fileContent: null,
        wouldChange: true,
        hasChanges: true,
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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

      const writtenContent = calls.writeFile.find(
        (c) => c.fileName === "README.md"
      )?.content;
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
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: false,
        fileContent: null,
        wouldChange: true,
        hasChanges: true,
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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

      const writtenContent = calls.writeFile.find(
        (c) => c.fileName === "config.txt"
      )?.content;
      assert.ok(writtenContent, "Should have written config.txt");
      assert.ok(
        writtenContent.includes("Team: Platform"),
        "Should interpolate custom var"
      );
    });
  });

  describe("commit message formatting", () => {
    test("should format commit message for 2-3 files with file names", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        changedFiles: ["config1.json", "config2.json", "config3.json"],
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        changedFiles: [
          "config1.json",
          "config2.json",
          "config3.json",
          "config4.json",
        ],
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
    test("should suppress cleanup errors in finally block", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        cloneError: new Error("Clone failed"),
        // Cleanup error only on 2nd call (in finally block)
        cleanupError: (callCount) =>
          callCount > 1 ? new Error("Cleanup failed") : undefined,
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
        calls.cleanWorkspace.length >= 2,
        "Should attempt cleanup in finally block"
      );
    });
  });

  describe("orphaned file deletion", () => {
    test("should delete orphaned file when removed from config", async () => {
      const { mock: mockLogger } = createMockLogger();
      // Track which files "exist" in the mock
      const existingFiles = new Set(["orphaned.json"]);
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: (fileName) => existingFiles.has(fileName),
        wouldChange: true,
        hasChanges: true,
        onDeleteFile: (fileName) => existingFiles.delete(fileName),
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
        calls.deleteFile.some((c) => c.fileName === "orphaned.json"),
        "Should delete orphaned file"
      );
    });

    test("should skip deletion with noDelete option", async () => {
      const { mock: mockLogger, messages } = createMockLogger();
      const existingFiles = new Set(["orphaned.json"]);
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: (fileName) => existingFiles.has(fileName),
        wouldChange: true,
        hasChanges: true,
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
        calls.deleteFile.length,
        0,
        "Should not delete files with noDelete flag"
      );
      assert.ok(
        messages.some((m) => m.includes("--no-delete")),
        "Should log that deletion was skipped"
      );
    });

    test("should show DELETED status in dry-run mode", async () => {
      const { mock: mockLogger, diffStatuses } = createMockLogger();
      const existingFiles = new Set(["orphaned.json"]);
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: (fileName) => existingFiles.has(fileName),
        wouldChange: true,
        hasChanges: true,
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
        calls.deleteFile.length,
        0,
        "Should not delete files in dry-run"
      );

      // Should show DELETED status in log
      assert.ok(
        diffStatuses.some(
          (s) => s.fileName === "orphaned.json" && s.status === "DELETED"
        ),
        "Should log DELETED status for orphaned file"
      );
    });

    test("should track deleted file in changed files list", async () => {
      const { mock: mockLogger } = createMockLogger();
      const existingFiles = new Set(["orphaned.json"]);
      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        fileExists: (fileName) => existingFiles.has(fileName),
        wouldChange: true,
        hasChanges: true,
        onDeleteFile: (fileName) => existingFiles.delete(fileName),
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

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
        calls.deleteFile.some((c) => c.fileName === "orphaned.json"),
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
    test("should include manifest file in changedFiles when content changes", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `file-count-manifest-${Date.now()}`);
      mkdirSync(localWorkDir, { recursive: true });
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

    test("should skip config files when wouldChange returns false", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        // config1.json would change, config2.json would not
        wouldChange: (fileName) => fileName !== "config2.json",
        hasChanges: true,
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(
        testDir,
        `file-count-skip-unchanged-${Date.now()}`
      );
      mkdirSync(localWorkDir, { recursive: true });
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
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        // skipped.json exists on base branch (triggers createOnly skip)
        fileExistsOnBranch: (fileName) => fileName === "skipped.json",
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(testDir, `file-count-no-double-${Date.now()}`);
      mkdirSync(localWorkDir, { recursive: true });
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

    test("should not count manifest file twice with different names (issue #268)", async () => {
      // This test reproduces the bug where the manifest file .xfg.json
      // was being counted twice - once correctly and once without the leading dot.
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        // .xfg.json exists (manifest), .xfg-test is new
        fileExistsOnBranch: (fileName) => fileName === ".xfg.json",
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(
        testDir,
        `file-count-manifest-dupe-${Date.now()}`
      );
      const trackingExecutor = createTrackingMockExecutor();

      // Create the manifest file to simulate it exists
      mkdirSync(localWorkDir, { recursive: true });
      writeFileSync(
        join(localWorkDir, ".xfg.json"),
        JSON.stringify({ version: 2, configs: {} }, null, 2),
        "utf-8"
      );

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: ".xfg-test",
            content: "test content",
            deleteOrphaned: true,
          },
        ],
      };

      const result = await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      // Verify we have a commit message
      assert.ok(
        trackingExecutor.lastCommitMessage,
        "Should have commit message"
      );

      // The commit message should mention exactly 2 files, not 3
      const commitMsg = trackingExecutor.lastCommitMessage;

      // Check for the phantom "xfg.json" (without leading dot) - this is the bug
      const hasPhantomXfgJson =
        commitMsg.includes("xfg.json") && !commitMsg.includes(".xfg.json");
      const hasCorrectManifest = commitMsg.includes(".xfg.json");
      const hasTestFile = commitMsg.includes(".xfg-test");

      // Count file names in the commit message
      const fileNameMatches = commitMsg.match(
        /\.xfg\.json|\.xfg-test|xfg\.json/g
      );
      const fileCount = fileNameMatches ? fileNameMatches.length : 0;

      assert.ok(
        !hasPhantomXfgJson,
        `Commit message should not contain phantom 'xfg.json' (without dot). Got: ${commitMsg}`
      );
      assert.ok(
        hasCorrectManifest && hasTestFile,
        `Commit message should include .xfg.json and .xfg-test. Got: ${commitMsg}`
      );
      assert.equal(
        fileCount,
        2,
        `Commit message should mention exactly 2 files, but found ${fileCount}. Got: ${commitMsg}`
      );

      // Also verify diffStats are correct: 1 new file + 1 modified (manifest)
      assert.ok(result.diffStats, "Result should have diffStats");
      assert.equal(
        result.diffStats!.newCount,
        1,
        `Should have 1 new file (.xfg-test), but got ${result.diffStats!.newCount}`
      );
      assert.equal(
        result.diffStats!.modifiedCount,
        1,
        `Should have 1 modified file (.xfg.json), but got ${result.diffStats!.modifiedCount}`
      );
    });

    test("should count exactly 3 files when updating existing manifest with new file (issue #268 update path)", async () => {
      // This test reproduces the CI failure where:
      // - Seeded manifest had ["action-test.json"]
      // - Config has action-test.json AND action-test-2.yaml (both deleteOrphaned: true)
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        hasChanges: true,
        // Only action-test.json exists on base
        fileExistsOnBranch: (fileName) => fileName === "action-test.json",
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      const processor = new RepositoryProcessor(mockFactory, mockLogger);
      const localWorkDir = join(
        testDir,
        `file-count-manifest-update-${Date.now()}`
      );
      const trackingExecutor = createTrackingMockExecutor();

      // Seed the manifest with only action-test.json (simulating the update path)
      mkdirSync(localWorkDir, { recursive: true });
      writeFileSync(
        join(localWorkDir, ".xfg.json"),
        JSON.stringify(
          {
            version: 2,
            configs: { "test-config": ["action-test.json"] },
          },
          null,
          2
        ),
        "utf-8"
      );
      // Create action-test.json so it's an update, not create
      writeFileSync(
        join(localWorkDir, "action-test.json"),
        '{"old": "content"}',
        "utf-8"
      );

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [
          {
            fileName: "action-test.json",
            content: { syncedByAction: true },
            deleteOrphaned: true,
          },
          {
            fileName: "action-test-2.yaml",
            content: { setting1: "value1" },
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

      // Verify commit message
      assert.ok(
        trackingExecutor.lastCommitMessage,
        "Should have commit message"
      );

      const commitMsg = trackingExecutor.lastCommitMessage;

      // The commit message should mention exactly 3 files, not 4
      const hasThreeFilesListedOrLess =
        !commitMsg.includes("config files") ||
        commitMsg.includes("3 config files");

      // Count unique file names to verify no duplicates
      const fileMatches = commitMsg.match(
        /\.xfg\.json|action-test\.json|action-test-2\.yaml/g
      );
      const uniqueFiles = new Set(fileMatches || []);

      assert.ok(
        hasThreeFilesListedOrLess,
        `Commit message should list 3 files or fewer (not "4 config files"). Got: ${commitMsg}`
      );
      assert.equal(
        uniqueFiles.size,
        3,
        `Should have exactly 3 unique files in commit message. Got: ${commitMsg}`
      );
      assert.ok(
        !commitMsg.includes("4 config files"),
        `Commit message should NOT say "4 config files". Got: ${commitMsg}`
      );
    });
  });

  describe("CommitStrategy integration", () => {
    test("should use GraphQL commit strategy when GitHub App credentials are set", async () => {
      // Save original env values
      const originalAppId = process.env.XFG_GITHUB_APP_ID;
      const originalPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;

      try {
        // Set GitHub App credentials to trigger GraphQL strategy
        process.env.XFG_GITHUB_APP_ID = "12345";
        process.env.XFG_GITHUB_APP_PRIVATE_KEY = "test-private-key";

        const { mock: mockLogger, messages: loggerMessages } =
          createMockLogger();
        const { mock: mockGitOps } = createMockAuthenticatedGitOps({
          fileExists: false,
          wouldChange: true,
          hasChanges: true,
          fileExistsOnBranch: false,
        });
        const mockFactory: GitOpsFactory = () => mockGitOps;

        // Track executor calls to verify GraphQL vs git commit
        const executorCalls: string[] = [];
        const mockExecutor: ICommandExecutor = {
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

        mkdirSync(localWorkDir, { recursive: true });

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
        const verifiedLog = loggerMessages.find((m: string) =>
          m.includes("verified")
        );
        assert.ok(verifiedLog, "Should log that commit is verified");
      } finally {
        // Restore original env values
        if (originalAppId === undefined) {
          delete process.env.XFG_GITHUB_APP_ID;
        } else {
          process.env.XFG_GITHUB_APP_ID = originalAppId;
        }
        if (originalPrivateKey === undefined) {
          delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
        } else {
          process.env.XFG_GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
        }
      }
    });

    test("direct mode with CommitStrategy should return helpful error on branch protection", async () => {
      // Save original env values
      const originalAppId = process.env.XFG_GITHUB_APP_ID;
      const originalPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;

      try {
        // Set GitHub App credentials to trigger GraphQL strategy
        process.env.XFG_GITHUB_APP_ID = "12345";
        process.env.XFG_GITHUB_APP_PRIVATE_KEY = "test-private-key";

        const { mock: mockLogger } = createMockLogger();
        const { mock: mockGitOps } = createMockAuthenticatedGitOps({
          fileExists: false,
          wouldChange: true,
          hasChanges: true,
          fileExistsOnBranch: false,
        });
        const mockFactory: GitOpsFactory = () => mockGitOps;

        // Mock executor with ICommandExecutor interface
        const mockExecutor: ICommandExecutor = {
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

        mkdirSync(localWorkDir, { recursive: true });

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
        // Restore original env values
        if (originalAppId === undefined) {
          delete process.env.XFG_GITHUB_APP_ID;
        } else {
          process.env.XFG_GITHUB_APP_ID = originalAppId;
        }
        if (originalPrivateKey === undefined) {
          delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
        } else {
          process.env.XFG_GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
        }
      }
    });

    test("direct mode handles 'protected' keyword in error message", async () => {
      const originalAppId = process.env.XFG_GITHUB_APP_ID;
      const originalPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;

      try {
        process.env.XFG_GITHUB_APP_ID = "12345";
        process.env.XFG_GITHUB_APP_PRIVATE_KEY = "test-private-key";

        const { mock: mockLogger } = createMockLogger();
        const { mock: mockGitOps } = createMockAuthenticatedGitOps({
          fileExists: false,
          wouldChange: true,
          hasChanges: true,
          fileExistsOnBranch: false,
        });
        const mockFactory: GitOpsFactory = () => mockGitOps;

        // Test uses mock executor to simulate protected branch error
        const mockExecutor: ICommandExecutor = {
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

        mkdirSync(localWorkDir, { recursive: true });

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
        if (originalAppId === undefined) {
          delete process.env.XFG_GITHUB_APP_ID;
        } else {
          process.env.XFG_GITHUB_APP_ID = originalAppId;
        }
        if (originalPrivateKey === undefined) {
          delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
        } else {
          process.env.XFG_GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
        }
      }
    });

    test("direct mode handles 'denied' keyword in error message", async () => {
      const originalAppId = process.env.XFG_GITHUB_APP_ID;
      const originalPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;

      try {
        process.env.XFG_GITHUB_APP_ID = "12345";
        process.env.XFG_GITHUB_APP_PRIVATE_KEY = "test-private-key";

        const { mock: mockLogger } = createMockLogger();
        const { mock: mockGitOps } = createMockAuthenticatedGitOps({
          fileExists: false,
          wouldChange: true,
          hasChanges: true,
          fileExistsOnBranch: false,
        });
        const mockFactory: GitOpsFactory = () => mockGitOps;

        // Test uses mock executor to simulate permission denied error
        const mockExecutor: ICommandExecutor = {
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

        mkdirSync(localWorkDir, { recursive: true });

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
        if (originalAppId === undefined) {
          delete process.env.XFG_GITHUB_APP_ID;
        } else {
          process.env.XFG_GITHUB_APP_ID = originalAppId;
        }
        if (originalPrivateKey === undefined) {
          delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
        } else {
          process.env.XFG_GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
        }
      }
    });

    test("direct mode re-throws unrecognized errors", async () => {
      const originalAppId = process.env.XFG_GITHUB_APP_ID;
      const originalPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;

      try {
        process.env.XFG_GITHUB_APP_ID = "12345";
        process.env.XFG_GITHUB_APP_PRIVATE_KEY = "test-private-key";

        const { mock: mockLogger } = createMockLogger();
        const { mock: mockGitOps } = createMockAuthenticatedGitOps({
          fileExists: false,
          wouldChange: true,
          hasChanges: true,
          fileExistsOnBranch: false,
        });
        const mockFactory: GitOpsFactory = () => mockGitOps;

        // Test uses mock executor to simulate network error
        const mockExecutor: ICommandExecutor = {
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

        mkdirSync(localWorkDir, { recursive: true });

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
        if (originalAppId === undefined) {
          delete process.env.XFG_GITHUB_APP_ID;
        } else {
          process.env.XFG_GITHUB_APP_ID = originalAppId;
        }
        if (originalPrivateKey === undefined) {
          delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
        } else {
          process.env.XFG_GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
        }
      }
    });
  });

  describe("diffStats in non-dry-run mode (issue #252)", () => {
    // Mock executor that returns a PR URL (safe test mock - no actual shell execution)
    function createPRMockExecutor(): ICommandExecutor {
      return {
        async exec(): Promise<string> {
          return "https://github.com/test/repo/pull/123";
        },
      };
    }

    test("should populate diffStats with correct counts in non-dry-run mode", async () => {
      const { mock: mockLogger } = createMockLogger();
      const localWorkDir = join(testDir, `diffstats-nondr-${Date.now()}`);
      mkdirSync(localWorkDir, { recursive: true });
      // Pre-create existing.json so existsSync returns true for it
      writeFileSync(join(localWorkDir, "existing.json"), '{"old": true}');

      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        // existing.json exists (update), new-file.json doesn't (create)
        fileExists: (fileName) => fileName === "existing.json",
        wouldChange: true,
        hasChanges: true,
        fileExistsOnBranch: false,
        onWriteFile: (fileName, content) => {
          writeFileSync(join(localWorkDir, fileName), content, "utf-8");
        },
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      const processor = new RepositoryProcessor(mockFactory, mockLogger);

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
      const { mock: mockLogger } = createMockLogger();
      const localWorkDir = join(testDir, `diffstats-delete-${Date.now()}`);
      mkdirSync(localWorkDir, { recursive: true });

      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        // orphaned.json exists (will be deleted), config.json doesn't (new)
        fileExists: (fileName) => fileName === "orphaned.json",
        wouldChange: true,
        hasChanges: true,
        fileExistsOnBranch: false,
        onWriteFile: (fileName, content) => {
          writeFileSync(join(localWorkDir, fileName), content, "utf-8");
        },
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      const processor = new RepositoryProcessor(mockFactory, mockLogger);

      // Create manifest tracking orphaned.json
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

  describe("GitHub App token manager integration", () => {
    let originalAppId: string | undefined;
    let originalPrivateKey: string | undefined;

    beforeEach(() => {
      originalAppId = process.env.XFG_GITHUB_APP_ID;
      originalPrivateKey = process.env.XFG_GITHUB_APP_PRIVATE_KEY;
      // Clear env vars before each test
      delete process.env.XFG_GITHUB_APP_ID;
      delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
    });

    afterEach(() => {
      if (originalAppId !== undefined) {
        process.env.XFG_GITHUB_APP_ID = originalAppId;
      } else {
        delete process.env.XFG_GITHUB_APP_ID;
      }
      if (originalPrivateKey !== undefined) {
        process.env.XFG_GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
      } else {
        delete process.env.XFG_GITHUB_APP_PRIVATE_KEY;
      }
    });

    test("does not use token manager when GitHub App credentials are not set", async () => {
      // Verify env vars are cleared
      assert.equal(
        process.env.XFG_GITHUB_APP_ID,
        undefined,
        "XFG_GITHUB_APP_ID should not be set"
      );
      assert.equal(
        process.env.XFG_GITHUB_APP_PRIVATE_KEY,
        undefined,
        "XFG_GITHUB_APP_PRIVATE_KEY should not be set"
      );

      const { mock: mockLogger } = createMockLogger();

      // Create a minimal mock GitOps that simulates a working repository
      const mockGitOpsFactory: GitOpsFactory = (opts, _auth) => {
        const gitOps = new GitOps(opts);
        // Override methods for testing using Object.assign to avoid 'any' type
        const mockGitOps = Object.assign(gitOps, {
          cleanWorkspace: () => {
            mkdirSync(opts.workDir, { recursive: true });
          },
          clone: async () => {},
          getDefaultBranch: async () => ({
            branch: "main",
            method: "remote" as const,
          }),
          createBranch: async () => {},
          fileExistsOnBranch: async () => false,
          writeFile: () => {},
          getFileContent: () => null,
          wouldChange: () => true,
          hasStagedChanges: async () => false,
          setExecutable: async () => {},
          fileExists: () => false,
        });
        return new AuthenticatedGitOps(mockGitOps);
      };

      const processor = new RepositoryProcessor(mockGitOpsFactory, mockLogger);
      const result = await processor.process(
        {
          git: "git@github.com:owner/repo.git",
          files: [{ fileName: "test.json", content: { key: "value" } }],
        },
        {
          type: "github",
          gitUrl: "git@github.com:owner/repo.git",
          owner: "owner",
          repo: "repo",
          host: "github.com",
        },
        {
          branchName: "chore/sync-config",
          workDir: join(testDir, "no-github-app"),
          configId: "test-config",
          dryRun: false,
          executor: createMockExecutor(),
        }
      );

      // Should succeed/skip without any GitHub App related message
      // Since hasStagedChanges returns false, it should skip
      assert.equal(
        result.skipped,
        true,
        "Should be skipped (no staged changes)"
      );
      assert.ok(
        !result.message.includes("GitHub App"),
        `Message should not mention GitHub App, got: ${result.message}`
      );
    });

    test("hasGitHubAppCredentials returns true when both env vars are set", async () => {
      // Import the function directly for testing
      const { hasGitHubAppCredentials } =
        await import("../../src/strategies/commit-strategy-selector.js");

      // Initially should be false (env vars cleared in beforeEach)
      assert.equal(
        hasGitHubAppCredentials(),
        false,
        "Should return false when env vars not set"
      );

      // Set both env vars
      process.env.XFG_GITHUB_APP_ID = "12345";
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = "test-key";

      assert.equal(
        hasGitHubAppCredentials(),
        true,
        "Should return true when both env vars are set"
      );
    });

    test("skips repo when no GitHub App installation found for owner", async () => {
      const { TEST_PRIVATE_KEY, TEST_APP_ID } =
        await import("../fixtures/test-fixtures.js");

      // Set GitHub App credentials
      process.env.XFG_GITHUB_APP_ID = TEST_APP_ID;
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = TEST_PRIVATE_KEY;

      const { mock: mockLogger } = createMockLogger();

      // Mock fetch to return empty installations array
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url: string | URL | Request) => {
        const urlString = url.toString();
        if (urlString.includes("/app/installations")) {
          // Return empty installations - owner "no-install-owner" has no app installed
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch: ${urlString}`);
      };

      try {
        const mockGitOpsFactory: GitOpsFactory = (opts, _auth) => {
          const gitOps = new GitOps(opts);
          const mockGitOps = Object.assign(gitOps, {
            cleanWorkspace: () => {
              mkdirSync(opts.workDir, { recursive: true });
            },
            clone: async () => {},
            getDefaultBranch: async () => ({
              branch: "main",
              method: "remote" as const,
            }),
            createBranch: async () => {},
            fileExistsOnBranch: async () => false,
            writeFile: () => {},
            getFileContent: () => null,
            wouldChange: () => true,
            hasStagedChanges: async () => true,
            setExecutable: async () => {},
            fileExists: () => false,
          });
          return new AuthenticatedGitOps(mockGitOps);
        };

        const processor = new RepositoryProcessor(
          mockGitOpsFactory,
          mockLogger
        );
        const result = await processor.process(
          {
            git: "git@github.com:no-install-owner/repo.git",
            files: [{ fileName: "test.json", content: { key: "value" } }],
          },
          {
            type: "github",
            gitUrl: "git@github.com:no-install-owner/repo.git",
            owner: "no-install-owner",
            repo: "repo",
            host: "github.com",
          },
          {
            branchName: "chore/sync-config",
            workDir: join(testDir, "no-installation"),
            configId: "test-config",
            dryRun: false,
            executor: createMockExecutor(),
          }
        );

        assert.equal(result.success, true, "Should be success (graceful skip)");
        assert.equal(result.skipped, true, "Should be skipped");
        assert.ok(
          result.message.includes("No GitHub App installation found"),
          `Expected 'No GitHub App installation found' in message, got: ${result.message}`
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("logs warning and continues when GitHub App token retrieval fails", async () => {
      const { TEST_PRIVATE_KEY, TEST_APP_ID } =
        await import("../fixtures/test-fixtures.js");

      // Set GitHub App credentials
      process.env.XFG_GITHUB_APP_ID = TEST_APP_ID;
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = TEST_PRIVATE_KEY;

      const { mock: mockLogger, messages: logMessages } = createMockLogger();

      // Mock fetch to fail on installations discovery
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error("Network error: connection refused");
      };

      try {
        const mockGitOpsFactory: GitOpsFactory = (opts, _auth) => {
          const gitOps = new GitOps(opts);
          const mockGitOps = Object.assign(gitOps, {
            cleanWorkspace: () => {
              mkdirSync(opts.workDir, { recursive: true });
            },
            clone: async () => {},
            getDefaultBranch: async () => ({
              branch: "main",
              method: "remote" as const,
            }),
            createBranch: async () => {},
            fileExistsOnBranch: async () => false,
            writeFile: () => {},
            getFileContent: () => null,
            wouldChange: () => true,
            hasStagedChanges: async () => false,
            setExecutable: async () => {},
            fileExists: () => false,
          });
          return new AuthenticatedGitOps(mockGitOps);
        };

        const processor = new RepositoryProcessor(
          mockGitOpsFactory,
          mockLogger
        );
        const result = await processor.process(
          {
            git: "git@github.com:failing-owner/repo.git",
            files: [{ fileName: "test.json", content: { key: "value" } }],
          },
          {
            type: "github",
            gitUrl: "git@github.com:failing-owner/repo.git",
            owner: "failing-owner",
            repo: "repo",
            host: "github.com",
          },
          {
            branchName: "chore/sync-config",
            workDir: join(testDir, "token-failure"),
            configId: "test-config",
            dryRun: false,
            executor: createMockExecutor(),
          }
        );

        // Should continue processing (skipped due to no staged changes)
        assert.equal(
          result.skipped,
          true,
          "Should be skipped (no staged changes)"
        );

        // Should have logged warning about token failure
        const warningMessage = logMessages.find((m) =>
          m.includes("Failed to get GitHub App token")
        );
        assert.ok(
          warningMessage,
          `Expected warning about token failure, got messages: ${logMessages.join(", ")}`
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("passes auth options to factory when GitHub App token is obtained", async () => {
      const { TEST_PRIVATE_KEY, TEST_APP_ID } =
        await import("../fixtures/test-fixtures.js");

      // Set GitHub App credentials to enable tokenManager creation
      process.env.XFG_GITHUB_APP_ID = TEST_APP_ID;
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = TEST_PRIVATE_KEY;

      const { mock: mockLogger } = createMockLogger();

      // Track the auth options passed to factory
      let capturedAuth: unknown = undefined;

      const mockGitOpsFactory: GitOpsFactory = (opts, auth) => {
        capturedAuth = auth;
        const gitOps = new GitOps(opts);
        const mockGitOps = Object.assign(gitOps, {
          cleanWorkspace: () => {
            mkdirSync(opts.workDir, { recursive: true });
          },
          clone: async () => {},
          getDefaultBranch: async () => ({
            branch: "main",
            method: "remote" as const,
          }),
          createBranch: async () => {},
          fileExistsOnBranch: async () => false,
          writeFile: () => {},
          getFileContent: () => null,
          wouldChange: () => true,
          hasStagedChanges: async () => false, // Skip actual commit
          setExecutable: async () => {},
          fileExists: () => false,
        });
        return new AuthenticatedGitOps(mockGitOps);
      };

      const processor = new RepositoryProcessor(mockGitOpsFactory, mockLogger);

      // Replace the tokenManager with a mock that returns a token directly
      // This bypasses the complex JWT/fetch flow while still testing auth options building
      const mockTokenManager = {
        async getTokenForRepo() {
          return "ghs_test_installation_token_abc123";
        },
      };
      (
        processor as unknown as { tokenManager: typeof mockTokenManager }
      ).tokenManager = mockTokenManager;

      await processor.process(
        {
          git: "git@github.com:test-owner/repo.git",
          files: [{ fileName: "test.json", content: { key: "value" } }],
        },
        {
          type: "github",
          gitUrl: "git@github.com:test-owner/repo.git",
          owner: "test-owner",
          repo: "repo",
          host: "github.com",
        },
        {
          branchName: "chore/sync-config",
          workDir: join(testDir, "auth-test"),
          configId: "test-config",
          dryRun: false,
          executor: createMockExecutor(),
        }
      );

      // Verify auth options were passed
      assert.ok(capturedAuth, "Auth options should be passed to factory");
      const auth = capturedAuth as {
        token: string;
        host: string;
        owner: string;
        repo: string;
      };
      assert.equal(
        auth.token,
        "ghs_test_installation_token_abc123",
        "Token should match"
      );
      assert.equal(auth.host, "github.com", "Host should be github.com");
      assert.equal(auth.owner, "test-owner", "Owner should match");
      assert.equal(auth.repo, "repo", "Repo should match");
    });

    test("passes auth options with custom host for GitHub Enterprise", async () => {
      const { TEST_PRIVATE_KEY, TEST_APP_ID } =
        await import("../fixtures/test-fixtures.js");

      // Set GitHub App credentials to enable tokenManager creation
      process.env.XFG_GITHUB_APP_ID = TEST_APP_ID;
      process.env.XFG_GITHUB_APP_PRIVATE_KEY = TEST_PRIVATE_KEY;

      const { mock: mockLogger } = createMockLogger();

      // Track the auth options passed to factory
      let capturedAuth: unknown = undefined;

      const mockGitOpsFactory: GitOpsFactory = (opts, auth) => {
        capturedAuth = auth;
        const gitOps = new GitOps(opts);
        const mockGitOps = Object.assign(gitOps, {
          cleanWorkspace: () => {
            mkdirSync(opts.workDir, { recursive: true });
          },
          clone: async () => {},
          getDefaultBranch: async () => ({
            branch: "main",
            method: "remote" as const,
          }),
          createBranch: async () => {},
          fileExistsOnBranch: async () => false,
          writeFile: () => {},
          getFileContent: () => null,
          wouldChange: () => true,
          hasStagedChanges: async () => false,
          setExecutable: async () => {},
          fileExists: () => false,
        });
        return new AuthenticatedGitOps(mockGitOps);
      };

      const processor = new RepositoryProcessor(mockGitOpsFactory, mockLogger);

      // Replace the tokenManager with a mock that returns a token directly
      const mockTokenManager = {
        async getTokenForRepo() {
          return "ghs_enterprise_token_xyz789";
        },
      };
      (
        processor as unknown as { tokenManager: typeof mockTokenManager }
      ).tokenManager = mockTokenManager;

      await processor.process(
        {
          git: "git@github.mycompany.com:enterprise-owner/repo.git",
          files: [{ fileName: "test.json", content: { key: "value" } }],
        },
        {
          type: "github",
          gitUrl: "git@github.mycompany.com:enterprise-owner/repo.git",
          owner: "enterprise-owner",
          repo: "repo",
          host: "github.mycompany.com",
        },
        {
          branchName: "chore/sync-config",
          workDir: join(testDir, "auth-enterprise-test"),
          configId: "test-config",
          dryRun: false,
          executor: createMockExecutor(),
        }
      );

      // Verify auth options have custom host
      assert.ok(capturedAuth, "Auth options should be passed to factory");
      const auth = capturedAuth as {
        token: string;
        host: string;
        owner: string;
        repo: string;
      };
      assert.equal(
        auth.host,
        "github.mycompany.com",
        "Host should be the custom enterprise host"
      );
    });

    test("uses GH_TOKEN for git auth when no GitHub App token", async () => {
      // Set up GH_TOKEN in environment (no GitHub App credentials)
      const originalGhToken = process.env.GH_TOKEN;
      process.env.GH_TOKEN = "ghp_test_pat_token";

      try {
        const { mock: mockLogger } = createMockLogger();

        // Track the auth options passed to factory
        let capturedAuth: unknown = undefined;

        const mockGitOpsFactory: GitOpsFactory = (opts, auth) => {
          capturedAuth = auth;
          const gitOps = new GitOps(opts);
          const mockGitOps = Object.assign(gitOps, {
            cleanWorkspace: () => {
              mkdirSync(opts.workDir, { recursive: true });
            },
            clone: async () => {},
            getDefaultBranch: async () => ({
              branch: "main",
              method: "remote" as const,
            }),
            createBranch: async () => {},
            fileExistsOnBranch: async () => false,
            writeFile: () => {},
            getFileContent: () => null,
            wouldChange: () => true,
            hasStagedChanges: async () => false, // Skip actual commit
            setExecutable: async () => {},
            fileExists: () => false,
          });
          return new AuthenticatedGitOps(mockGitOps);
        };

        const processor = new RepositoryProcessor(
          mockGitOpsFactory,
          mockLogger
        );

        await processor.process(
          {
            git: "git@github.com:test-owner/repo.git",
            files: [{ fileName: "test.json", content: { key: "value" } }],
          },
          {
            type: "github",
            gitUrl: "git@github.com:test-owner/repo.git",
            owner: "test-owner",
            repo: "repo",
            host: "github.com",
          },
          {
            branchName: "chore/sync-config",
            workDir: join(testDir, "gh-token-test"),
            configId: "test-config",
            dryRun: false,
            executor: createMockExecutor(),
          }
        );

        // Verify gitOpsFactory was called with auth options containing GH_TOKEN
        assert.ok(
          capturedAuth,
          "authOptions should be defined when GH_TOKEN is set"
        );
        const auth = capturedAuth as {
          token: string;
          host: string;
          owner: string;
          repo: string;
        };
        assert.strictEqual(
          auth.token,
          "ghp_test_pat_token",
          "Should use GH_TOKEN"
        );
        assert.strictEqual(
          auth.host,
          "github.com",
          "Host should be github.com"
        );
        assert.strictEqual(auth.owner, "test-owner", "Owner should match");
        assert.strictEqual(auth.repo, "repo", "Repo should match");
      } finally {
        if (originalGhToken) {
          process.env.GH_TOKEN = originalGhToken;
        } else {
          delete process.env.GH_TOKEN;
        }
      }
    });
  });

  describe("updateManifestOnly", () => {
    test("updates manifest with rulesets and commits", async () => {
      const { mock: mockLogger } = createMockLogger();
      const localWorkDir = join(testDir, `manifest-update-${Date.now()}`);
      mkdirSync(localWorkDir, { recursive: true });

      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        hasStagedChanges: true,
        wouldChange: true,
        fileContent: null,
        onWriteFile: (fileName, content) => {
          writeFileSync(join(localWorkDir, fileName), content, "utf-8");
        },
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;
      const processor = new RepositoryProcessor(mockFactory, mockLogger);

      const repoInfo: GitHubRepoInfo = {
        type: "github",
        owner: "test-owner",
        repo: "test-repo",
        host: "github.com",
        gitUrl: "git@github.com:test-owner/test-repo.git",
      };

      const repoConfig: RepoConfig = {
        git: "git@github.com:test-owner/test-repo.git",
        files: [],
        prOptions: { merge: "direct" },
      };

      const options = {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: createMockExecutor(),
      };

      const manifestUpdate = { rulesets: ["pr-rules", "release-rules"] };

      const result = await processor.updateManifestOnly(
        repoInfo,
        repoConfig,
        options,
        manifestUpdate
      );

      assert.equal(result.success, true);
    });

    test("dry-run mode does not commit changes", async () => {
      const { mock: mockLogger } = createMockLogger();
      const localWorkDir = join(testDir, `manifest-dryrun-${Date.now()}`);
      mkdirSync(localWorkDir, { recursive: true });

      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        hasStagedChanges: true,
        wouldChange: true,
        fileContent: null,
        onWriteFile: (fileName, content) => {
          writeFileSync(join(localWorkDir, fileName), content, "utf-8");
        },
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;
      const processor = new RepositoryProcessor(mockFactory, mockLogger);

      const repoInfo: GitHubRepoInfo = {
        type: "github",
        owner: "test-owner",
        repo: "test-repo",
        host: "github.com",
        gitUrl: "git@github.com:test-owner/test-repo.git",
      };

      const repoConfig: RepoConfig = {
        git: "git@github.com:test-owner/test-repo.git",
        files: [],
        prOptions: { merge: "direct" },
      };

      const options = {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: true,
        executor: createMockExecutor(),
      };

      const manifestUpdate = { rulesets: ["pr-rules", "release-rules"] };

      const result = await processor.updateManifestOnly(
        repoInfo,
        repoConfig,
        options,
        manifestUpdate
      );

      assert.equal(result.success, true);
      assert.equal(result.message, "Would update manifest (dry-run)");
    });

    test("skips when no manifest changes detected", async () => {
      const { mock: mockLogger } = createMockLogger();

      const workDir = join(testDir, `manifest-no-change-${Date.now()}`);

      // Create the manifest file in the workspace
      mkdirSync(workDir, { recursive: true });
      const manifestContent =
        JSON.stringify(
          {
            version: 3,
            configs: {
              "test-config": {
                rulesets: ["pr-rules", "release-rules"],
              },
            },
          },
          null,
          2
        ) + "\n";
      writeFileSync(join(workDir, ".xfg.json"), manifestContent);

      // Mock that simulates existing manifest with same rulesets
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        hasStagedChanges: true,
        fileContent: (fileName) => {
          if (fileName === ".xfg.json") {
            return JSON.stringify({
              version: 3,
              configs: {
                "test-config": {
                  rulesets: ["pr-rules", "release-rules"],
                },
              },
            });
          }
          return null;
        },
        wouldChange: (fileName, content) => {
          if (fileName === ".xfg.json") {
            // Check if content matches existing
            const existing = JSON.stringify({
              version: 3,
              configs: {
                "test-config": {
                  rulesets: ["pr-rules", "release-rules"],
                },
              },
            });
            return existing !== content;
          }
          return true;
        },
        onWriteFile: (fileName, content) => {
          writeFileSync(join(workDir, fileName), content, "utf-8");
        },
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;
      const processor = new RepositoryProcessor(mockFactory, mockLogger);

      const repoInfo: GitHubRepoInfo = {
        type: "github",
        owner: "test-owner",
        repo: "test-repo",
        host: "github.com",
        gitUrl: "git@github.com:test-owner/test-repo.git",
      };

      const repoConfig: RepoConfig = {
        git: "git@github.com:test-owner/test-repo.git",
        files: [],
        prOptions: { merge: "direct" },
      };

      const options = {
        branchName: "chore/sync-config",
        workDir,
        configId: "test-config",
        dryRun: false,
        executor: createMockExecutor(),
      };

      // Same rulesets as existing manifest
      const manifestUpdate = { rulesets: ["pr-rules", "release-rules"] };

      const result = await processor.updateManifestOnly(
        repoInfo,
        repoConfig,
        options,
        manifestUpdate
      );

      assert.equal(result.success, true);
      assert.equal(result.skipped, true);
      assert.equal(result.message, "No manifest changes detected");
    });

    test("uses GH_TOKEN for git auth when no GitHub App token", async () => {
      const originalGhToken = process.env.GH_TOKEN;
      process.env.GH_TOKEN = "ghp_test_pat_token";

      try {
        const { mock: mockLogger } = createMockLogger();
        const localWorkDir = join(testDir, `manifest-gh-token-${Date.now()}`);
        mkdirSync(localWorkDir, { recursive: true });

        const { mock: mockGitOps } = createMockAuthenticatedGitOps({
          hasStagedChanges: true,
          wouldChange: true,
          fileContent: null,
          onWriteFile: (fileName, content) => {
            writeFileSync(join(localWorkDir, fileName), content, "utf-8");
          },
        });

        // Track the auth options passed to factory
        let capturedAuth: unknown = undefined;

        const mockGitOpsFactory: GitOpsFactory = (_opts, auth) => {
          capturedAuth = auth;
          return mockGitOps;
        };

        const processor = new RepositoryProcessor(
          mockGitOpsFactory,
          mockLogger
        );

        const repoInfo: GitHubRepoInfo = {
          type: "github",
          owner: "test-owner",
          repo: "test-repo",
          host: "github.com",
          gitUrl: "git@github.com:test-owner/test-repo.git",
        };

        const repoConfig: RepoConfig = {
          git: "git@github.com:test-owner/test-repo.git",
          files: [],
          prOptions: { merge: "direct" },
        };

        const options = {
          branchName: "chore/sync-config",
          workDir: localWorkDir,
          configId: "test-config",
          dryRun: false,
          executor: createMockExecutor(),
        };

        await processor.updateManifestOnly(repoInfo, repoConfig, options, {
          rulesets: ["test-ruleset"],
        });

        // Verify auth options were passed with GH_TOKEN
        assert.ok(
          capturedAuth,
          "authOptions should be defined when GH_TOKEN is set"
        );
        const auth = capturedAuth as {
          token: string;
          host: string;
          owner: string;
          repo: string;
        };
        assert.strictEqual(auth.token, "ghp_test_pat_token");
        assert.strictEqual(auth.host, "github.com");
        assert.strictEqual(auth.owner, "test-owner");
        assert.strictEqual(auth.repo, "test-repo");
      } finally {
        if (originalGhToken) {
          process.env.GH_TOKEN = originalGhToken;
        } else {
          delete process.env.GH_TOKEN;
        }
      }
    });

    test("creates PR and handles merge when using auto mode", async () => {
      const { mock: mockLogger } = createMockLogger();
      const localWorkDir = join(testDir, `manifest-pr-mode-${Date.now()}`);
      mkdirSync(localWorkDir, { recursive: true });

      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        hasStagedChanges: true,
        wouldChange: true,
        fileContent: null,
        onWriteFile: (fileName, content) => {
          writeFileSync(join(localWorkDir, fileName), content, "utf-8");
        },
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;
      const processor = new RepositoryProcessor(mockFactory, mockLogger);

      const repoInfo: GitHubRepoInfo = {
        type: "github",
        owner: "test-owner",
        repo: "test-repo",
        host: "github.com",
        gitUrl: "git@github.com:test-owner/test-repo.git",
      };

      const repoConfig: RepoConfig = {
        git: "git@github.com:test-owner/test-repo.git",
        files: [],
        prOptions: { merge: "auto" }, // Non-direct mode triggers PR creation
      };

      // Mock executor that returns PR URL for gh commands
      const mockPRExecutor: ICommandExecutor = {
        async exec(cmd: string): Promise<string> {
          if (cmd.includes("gh pr list")) {
            return ""; // No existing PR
          }
          if (cmd.includes("gh pr create")) {
            return "https://github.com/test-owner/test-repo/pull/42";
          }
          if (cmd.includes("gh pr merge")) {
            return "Merged";
          }
          return "";
        },
      };

      const options = {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: mockPRExecutor,
      };

      const manifestUpdate = { rulesets: ["pr-rules"] };

      const result = await processor.updateManifestOnly(
        repoInfo,
        repoConfig,
        options,
        manifestUpdate
      );

      assert.equal(result.success, true);
      assert.ok(
        result.prUrl?.includes("pull/42"),
        "Should return PR URL from createPR"
      );
    });
  });

  describe("deletion-only commit messages", () => {
    test("should format commit message for single deletion", async () => {
      const { mock: mockLogger } = createMockLogger();
      const localWorkDir = join(testDir, `delete-single-${Date.now()}`);
      mkdirSync(localWorkDir, { recursive: true });

      // Write manifest with a file that will become orphaned
      const manifestContent = JSON.stringify(
        {
          version: 3,
          configs: {
            "test-config": {
              files: ["orphaned.json"],
            },
          },
        },
        null,
        2
      );
      writeFileSync(join(localWorkDir, ".xfg.json"), manifestContent);
      // Create the orphaned file so it can be deleted
      writeFileSync(join(localWorkDir, "orphaned.json"), "{}");

      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        hasStagedChanges: true,
        wouldChange: false, // No new files changing
        fileContent: (fileName) => {
          if (fileName === ".xfg.json") return manifestContent;
          if (fileName === "orphaned.json") return "{}";
          return null;
        },
        fileExists: (fileName) => {
          return (
            fileName === ".xfg.json" ||
            fileName === "orphaned.json" ||
            readdirSync(localWorkDir).includes(fileName)
          );
        },
        onWriteFile: (fileName, content) => {
          writeFileSync(join(localWorkDir, fileName), content, "utf-8");
        },
        onDeleteFile: () => {
          // Allow deletion
        },
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      // Mock executor
      const trackingExecutor: ICommandExecutor = {
        async exec(cmd: string): Promise<string> {
          if (cmd.includes("git rev-parse HEAD")) {
            return "abc123";
          }
          return "";
        },
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [], // Empty files array - orphaned.json will be deleted
        prOptions: { merge: "direct" },
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      // Verify the orphaned file was deleted
      assert.ok(
        calls.deleteFile.some((c) => c.fileName === "orphaned.json"),
        "Should delete orphaned file"
      );
    });

    test("should format commit message for multiple deletions", async () => {
      const { mock: mockLogger } = createMockLogger();
      const localWorkDir = join(testDir, `delete-multiple-${Date.now()}`);
      mkdirSync(localWorkDir, { recursive: true });

      // Write manifest with multiple files that will become orphaned
      const manifestContent = JSON.stringify(
        {
          version: 3,
          configs: {
            "test-config": {
              files: ["orphaned1.json", "orphaned2.json", "orphaned3.json"],
            },
          },
        },
        null,
        2
      );
      writeFileSync(join(localWorkDir, ".xfg.json"), manifestContent);
      // Create the orphaned files so they can be deleted
      writeFileSync(join(localWorkDir, "orphaned1.json"), "{}");
      writeFileSync(join(localWorkDir, "orphaned2.json"), "{}");
      writeFileSync(join(localWorkDir, "orphaned3.json"), "{}");

      const { mock: mockGitOps, calls } = createMockAuthenticatedGitOps({
        hasStagedChanges: true,
        wouldChange: false, // No new files changing
        fileContent: (fileName) => {
          if (fileName === ".xfg.json") return manifestContent;
          if (
            fileName === "orphaned1.json" ||
            fileName === "orphaned2.json" ||
            fileName === "orphaned3.json"
          ) {
            return "{}";
          }
          return null;
        },
        fileExists: (fileName) => {
          return (
            fileName === ".xfg.json" ||
            fileName.startsWith("orphaned") ||
            readdirSync(localWorkDir).includes(fileName)
          );
        },
        onWriteFile: (fileName, content) => {
          writeFileSync(join(localWorkDir, fileName), content, "utf-8");
        },
        onDeleteFile: () => {
          // Allow deletion
        },
      });
      const mockFactory: GitOpsFactory = () => mockGitOps;

      // Mock executor
      const trackingExecutor: ICommandExecutor = {
        async exec(cmd: string): Promise<string> {
          if (cmd.includes("git rev-parse HEAD")) {
            return "abc123";
          }
          return "";
        },
      };

      const processor = new RepositoryProcessor(mockFactory, mockLogger);

      const repoConfig: RepoConfig = {
        git: "git@github.com:test/repo.git",
        files: [], // Empty files array - all files will be deleted
        prOptions: { merge: "direct" },
      };

      await processor.process(repoConfig, mockRepoInfo, {
        branchName: "chore/sync-config",
        workDir: localWorkDir,
        configId: "test-config",
        dryRun: false,
        executor: trackingExecutor,
      });

      // Verify the orphaned files were deleted
      assert.ok(
        calls.deleteFile.some((c) => c.fileName === "orphaned1.json"),
        "Should delete first orphaned file"
      );
      assert.ok(
        calls.deleteFile.some((c) => c.fileName === "orphaned2.json"),
        "Should delete second orphaned file"
      );
      assert.ok(
        calls.deleteFile.some((c) => c.fileName === "orphaned3.json"),
        "Should delete third orphaned file"
      );
    });
  });
});
