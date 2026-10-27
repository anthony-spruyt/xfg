import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PRMergeHandler } from "../../../src/sync/pr-merge-handler.js";
import { createMockLogger, createMockExecutor } from "../../mocks/index.js";
import type { GitHubRepoInfo } from "../../../src/repo/index.js";
import type { FileAction } from "../../../src/vcs/pr-creator.js";

let testDir: string;

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
    testDir = mkdtempSync(join(tmpdir(), "xfg-pr-merge-handler-"));
    workDir = join(testDir, "workspace");
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
          ["gh pr create", "https://github.com/test/repo/pull/1"],
          ["gh pr merge", ""],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);
      const changedFiles: FileAction[] = [
        { fileName: "config.json", action: "create" },
      ];

      const result = await handler.createAndMerge({
        repoInfo: mockRepoInfo,
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
      const { mock: mockExecutor, calls } = createMockExecutor({
        responses: new Map([
          ["gh pr list", ""],
          ["gh pr create", "https://github.com/test/repo/pull/1"],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);
      const changedFiles: FileAction[] = [
        { fileName: "config.json", action: "create" },
      ];

      const result = await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        prOptions: { merge: "manual" },
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

      assert.equal(result.success, true);
      assert.equal(result.prUrl, "https://github.com/test/repo/pull/1");
      assert.equal(result.mergeResult, undefined);
      assert.ok(!messages.some((msg) => msg.includes("Handling merge")));
      assert.ok(
        !calls.some((c) => c.args.includes("pr") && c.args.includes("merge")),
        "gh pr merge should not run in manual mode"
      );
    });

    test("enables auto-merge with squash and branch deletion when prOptions are unset", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor, calls } = createMockExecutor({
        responses: new Map([
          ["gh pr list", ""],
          ["gh pr create", "https://github.com/test/repo/pull/1"],
          ["gh api", "true"],
          ["gh pr merge", ""],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);

      await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        options: {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: false,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles: [{ fileName: "config.json", action: "create" }],
        repoName: "test/repo",
      });

      const mergeCall = calls.find(
        (c) => c.args.includes("pr") && c.args.includes("merge")
      );
      assert.ok(mergeCall, "gh pr merge should have been called");
      assert.ok(mergeCall.args.includes("--auto"));
      assert.ok(mergeCall.args.includes("--squash"));
      assert.ok(mergeCall.args.includes("--delete-branch"));
    });

    test("honours explicit mergeStrategy and deleteBranch", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor, calls } = createMockExecutor({
        responses: new Map([
          ["gh pr list", ""],
          ["gh pr create", "https://github.com/test/repo/pull/1"],
          ["gh api", "true"],
          ["gh pr merge", ""],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);

      await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        prOptions: { mergeStrategy: "rebase", deleteBranch: false },
        options: {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: false,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles: [{ fileName: "config.json", action: "create" }],
        repoName: "test/repo",
      });

      const mergeCall = calls.find(
        (c) => c.args.includes("pr") && c.args.includes("merge")
      );
      assert.ok(mergeCall, "gh pr merge should have been called");
      assert.ok(mergeCall.args.includes("--rebase"));
      assert.ok(!mergeCall.args.includes("--squash"));
      assert.ok(!mergeCall.args.includes("--delete-branch"));
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
      const diffStats = {
        newCount: 1,
        modifiedCount: 2,
        deletedCount: 0,
        unchangedCount: 0,
      };

      const result = await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        prOptions: { merge: "manual" },
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

      await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        prOptions: {
          labels: ["config-sync", "automated"],
        },
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

      const createCall = calls.find(
        (c) =>
          c.executable === "gh" &&
          c.args.includes("create") &&
          c.args.includes("pr")
      );
      assert.ok(createCall, "gh pr create should have been called");
      assert.ok(
        createCall.args.includes("--label"),
        "gh pr create should include --label flag"
      );
    });

    test("passes AI title to createPR", async () => {
      const { mock: mockLogger } = createMockLogger();
      const { mock: mockExecutor, calls } = createMockExecutor({
        responses: new Map([
          ["gh pr list", ""],
          ["gh pr create", "https://github.com/test/repo/pull/1"],
        ]),
      });

      const handler = new PRMergeHandler(mockLogger);

      await handler.createAndMerge({
        repoInfo: mockRepoInfo,
        prOptions: { merge: "manual" },
        options: {
          branchName: "chore/sync",
          baseBranch: "main",
          workDir,
          dryRun: false,
          retries: 1,
          executor: mockExecutor,
        },
        changedFiles: [{ fileName: "config.json", action: "create" }],
        repoName: "test/repo",
        prTitle: "build(config): add config",
        prSummary: "Adds config.",
      });

      const createCall = calls.find(
        (c) => c.executable === "gh" && c.args.includes("create")
      );
      assert.ok(createCall);
      const titleIdx = createCall.args.indexOf("--title");
      assert.equal(createCall.args[titleIdx + 1], "build(config): add config");
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

      const result = await handler.createAndMerge({
        repoInfo: mockRepoInfo,
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
