import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileWriter } from "../../../../src/sync/file/file-writer.js";
import { createMockAuthenticatedGitOps } from "../../../mocks/index.js";
import { createMockLogger } from "../../../mocks/index.js";
import type { FileContent } from "../../../../src/config/types.js";
import type { GitHubRepoInfo } from "../../../../src/repo/index.js";

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
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
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
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
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
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
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
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
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
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
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

    test("populates diffLines for JSON files in dry-run", async () => {
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
        wouldChange: true,
        fileContent: '{"old": true}\n',
        fileExists: false,
        fileExistsOnBranch: false,
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        { fileName: "config.json", content: { new: true } },
      ];

      const result = await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: true,
          noDelete: false,
          configId: "test",
        },
        { gitOps: mockGitOps, log: mockLogger }
      );

      const entry = result.fileChanges.get("config.json");
      assert.ok(entry);
      assert.ok(entry.diffLines);
      assert.ok(entry.diffLines.length > 0);
      // Raw lines, no ANSI codes
      const ansiRegex = new RegExp(
        String.fromCharCode(0x1b) + "\\[[0-9;]*m",
        "g"
      );
      for (const line of entry.diffLines) {
        assert.equal(line, line.replace(ansiRegex, ""));
      }
    });

    test("populates diffLines for JSON files in apply mode", async () => {
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
        wouldChange: true,
        fileContent: null,
        fileExists: false,
        fileExistsOnBranch: false,
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        { fileName: "config.json", content: { key: "value" } },
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
        { gitOps: mockGitOps, log: mockLogger }
      );

      const entry = result.fileChanges.get("config.json");
      assert.ok(entry);
      assert.ok(entry.diffLines);
      assert.ok(entry.diffLines.length > 0);
    });

    test("populates diffLines for non-structured text files", async () => {
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
        wouldChange: true,
        fileContent: null,
        fileExists: false,
        fileExistsOnBranch: false,
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        { fileName: "script.sh", content: "#!/bin/bash\necho hello" },
      ];

      const result = await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: true,
          noDelete: false,
          configId: "test",
        },
        { gitOps: mockGitOps, log: mockLogger }
      );

      const entry = result.fileChanges.get("script.sh");
      assert.ok(entry);
      assert.ok(entry.diffLines);
      assert.ok(entry.diffLines.length > 0);
    });

    test("populates mode 100755 for executable .sh files", async () => {
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "deploy.sh",
          content: "#!/bin/bash\necho hello",
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

      const entry = result.fileChanges.get("deploy.sh");
      assert.equal(entry?.mode, "100755");
    });

    test("does not populate mode for non-executable files", async () => {
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "config.json",
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

      const entry = result.fileChanges.get("config.json");
      assert.equal(entry?.mode, undefined);
    });

    test("populates mode 100755 for files with executable: true", async () => {
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "run",
          content: "#!/usr/bin/env python3\nprint('hello')",
          executable: true,
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

      const entry = result.fileChanges.get("run");
      assert.equal(entry?.mode, "100755");
    });

    test("does not populate diffLines for binary files", async () => {
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
        wouldChange: true,
        fileContent: null,
        fileExists: false,
        fileExistsOnBranch: false,
      });
      const { mock: mockLogger } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        { fileName: "logo.png", content: "binary-data" },
      ];

      const result = await writer.writeFiles(
        files,
        {
          repoInfo: mockRepoInfo,
          baseBranch: "main",
          workDir,
          dryRun: true,
          noDelete: false,
          configId: "test",
        },
        { gitOps: mockGitOps, log: mockLogger }
      );

      const entry = result.fileChanges.get("logo.png");
      assert.ok(entry);
      assert.equal(entry.diffLines, undefined);
    });

    test("does not warn about executable mode under GitHub App auth", async () => {
      const { gitOps: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: false,
        wouldChange: true,
      });
      const { mock: mockLogger, warnings } = createMockLogger();

      const writer = new FileWriter();
      const files: FileContent[] = [
        {
          fileName: "deploy.sh",
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
          hasAppCredentials: true,
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
        }
      );

      const warningMsg = warnings.find((m) =>
        /cannot set executable mode/i.test(m)
      );
      assert.equal(
        warningMsg,
        undefined,
        "Should not warn about executable mode since fixup commit handles it"
      );
    });
  });
});
