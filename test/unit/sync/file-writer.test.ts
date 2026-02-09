import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileWriter } from "../../../src/sync/file-writer.js";
import { createMockAuthenticatedGitOps } from "../../mocks/index.js";
import { createMockLogger } from "../../mocks/index.js";
import type { FileContent } from "../../../src/config/types.js";
import type { GitHubRepoInfo } from "../../../src/repo-detector.js";

const testDir = join(tmpdir(), "file-writer-test-" + Date.now());

describe("FileWriter", () => {
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

  describe("shouldBeExecutable", () => {
    test("returns true for .sh files by default", () => {
      const result = FileWriter.shouldBeExecutable({
        fileName: "script.sh",
        content: "#!/bin/bash",
      });
      assert.equal(result, true);
    });

    test("returns false for non-.sh files by default", () => {
      const result = FileWriter.shouldBeExecutable({
        fileName: "config.json",
        content: { key: "value" },
      });
      assert.equal(result, false);
    });

    test("respects explicit executable: true", () => {
      const result = FileWriter.shouldBeExecutable({
        fileName: "config.json",
        content: { key: "value" },
        executable: true,
      });
      assert.equal(result, true);
    });

    test("respects explicit executable: false for .sh", () => {
      const result = FileWriter.shouldBeExecutable({
        fileName: "script.sh",
        content: "#!/bin/bash",
        executable: false,
      });
      assert.equal(result, false);
    });
  });

  describe("writeFiles", () => {
    test("skips file when createOnly and file exists on base branch", async () => {
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExistsOnBranch: true,
        fileExists: true,
        wouldChange: true,
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "existing.json",
          content: { key: "value" },
          createOnly: true,
        },
      ];

      const result = await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: false,
          noDelete: false,
          configId: "test",
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      const fileResult = result.fileChanges.get("existing.json");
      assert.equal(fileResult?.action, "skip");
    });

    test("writes file and returns create action for new files", async () => {
      const writtenFiles: Array<{ fileName: string; content: string }> = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        onWriteFile: (fileName, content) => {
          writtenFiles.push({ fileName, content });
        },
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "new.json",
          content: { key: "value" },
        },
      ];

      const result = await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: false,
          noDelete: false,
          configId: "test",
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      const fileResult = result.fileChanges.get("new.json");
      assert.equal(fileResult?.action, "create");
      assert.equal(writtenFiles.length, 1);
    });

    test("applies xfg template interpolation when template: true", async () => {
      const writtenFiles: Array<{ fileName: string; content: string }> = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        onWriteFile: (fileName, content) => {
          writtenFiles.push({ fileName, content });
        },
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "readme.md",
          content: "# ${xfg:repo.name}",
          template: true,
        },
      ];

      await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: false,
          noDelete: false,
          configId: "test",
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      assert.equal(writtenFiles[0]?.content, "# repo\n");
    });

    test("does not write files in dryRun mode", async () => {
      const writtenFiles: Array<{ fileName: string; content: string }> = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        onWriteFile: (fileName, content) => {
          writtenFiles.push({ fileName, content });
        },
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "new.json",
          content: { key: "value" },
        },
      ];

      await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: true,
          noDelete: false,
          configId: "test",
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      assert.equal(writtenFiles.length, 0);
    });

    test("sets executable permission for .sh files", async () => {
      const executableFiles: string[] = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
        onSetExecutable: (fileName) => {
          executableFiles.push(fileName);
        },
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "script.sh",
          content: "#!/bin/bash\necho hello",
        },
      ];

      await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: false,
          noDelete: false,
          configId: "test",
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      assert.equal(executableFiles.length, 1);
      assert.equal(executableFiles[0], "script.sh");
    });
  });
});
