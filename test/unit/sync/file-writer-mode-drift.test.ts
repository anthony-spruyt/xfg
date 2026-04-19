import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { FileWriter } from "../../../src/sync/file-writer.js";
import type { FileContent } from "../../../src/config/index.js";
import type { ILocalGitOps } from "../../../src/vcs/index.js";
import type { ILogger } from "../../../src/shared/logger.js";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  progress: () => {},
  success: () => {},
  skip: () => {},
  fileDiff: () => {},
} as unknown as ILogger;

function makeGitOpsStub(overrides: Partial<ILocalGitOps> = {}): ILocalGitOps {
  return {
    cleanWorkspace: () => {},
    createBranch: async () => {},
    writeFile: () => {},
    setExecutable: async () => {},
    clearExecutable: async () => {},
    getFileContent: () => "same content\n",
    wouldChange: () => false,
    hasChanges: async () => false,
    getChangedFiles: async () => [],
    stageAll: async () => {},
    hasStagedChanges: async () => false,
    fileExistsOnBranch: async () => true,
    fileExists: () => true,
    deleteFile: () => {},
    commit: async () => true,
    getDefaultBranchLocal: async () => ({ branch: "main", method: "test" }),
    getFileMode: async () => "100644",
    ...overrides,
  };
}

function makeFile(
  fileName: string,
  content: string,
  executable: boolean
): FileContent {
  return { fileName, content, executable };
}

const ctx = {
  repoInfo: {
    type: "github",
    gitUrl: "git@github.com:o/r.git",
    owner: "o",
    repo: "r",
    host: "github.com",
  } as const,
  baseBranch: "main",
  workDir: "/tmp/repo",
  dryRun: false,
  noDelete: false,
  configId: "cfg",
};

describe("FileWriter mode drift", () => {
  test("emits modeOnly write result when executable flag is added to unchanged file", async () => {
    const files: FileContent[] = [
      makeFile("scripts/run", "same content\n", true),
    ];
    const result = await new FileWriter().writeFiles(files, ctx, {
      gitOps: makeGitOpsStub(),
      log: silentLogger,
    });
    const change = result.fileChanges.get("scripts/run");
    assert.ok(change, "expected mode-only fileChange for scripts/run");
    assert.equal(change!.modeOnly, true);
    assert.equal(change!.mode, "100755");
    assert.equal(change!.action, "update");
  });

  test("does NOT emit modeOnly result when current mode already matches", async () => {
    const files: FileContent[] = [makeFile("scripts/run", "same\n", true)];
    const result = await new FileWriter().writeFiles(files, ctx, {
      gitOps: makeGitOpsStub({
        getFileMode: async () => "100755",
        getFileContent: () => "same\n",
      }),
      log: silentLogger,
    });
    assert.equal(result.fileChanges.has("scripts/run"), false);
  });

  test("does NOT emit modeOnly result when file is untracked", async () => {
    const files: FileContent[] = [makeFile("scripts/run", "same\n", true)];
    const result = await new FileWriter().writeFiles(files, ctx, {
      gitOps: makeGitOpsStub({ getFileMode: async () => null }),
      log: silentLogger,
    });
    assert.equal(result.fileChanges.has("scripts/run"), false);
  });

  test("emits modeOnly downgrade (100755 -> 100644) when executable flag is removed", async () => {
    const files: FileContent[] = [makeFile("scripts/run", "same\n", false)];
    const result = await new FileWriter().writeFiles(files, ctx, {
      gitOps: makeGitOpsStub({
        getFileMode: async () => "100755",
        getFileContent: () => "same\n",
      }),
      log: silentLogger,
    });
    const change = result.fileChanges.get("scripts/run");
    assert.ok(change);
    assert.equal(change!.modeOnly, true);
    assert.equal(change!.mode, "100644");
  });

  test("content-change downgrade: emits mode 100644 alongside the content change", async () => {
    const files: FileContent[] = [
      makeFile("scripts/run", "new content\n", false),
    ];
    const result = await new FileWriter().writeFiles(files, ctx, {
      gitOps: makeGitOpsStub({
        getFileMode: async () => "100755",
        getFileContent: () => "old content\n",
        wouldChange: () => true,
      }),
      log: silentLogger,
    });
    const change = result.fileChanges.get("scripts/run");
    assert.ok(change);
    assert.equal(change!.mode, "100644");
    assert.notEqual(change!.modeOnly, true);
    assert.equal(change!.content, "new content\n");
  });

  test("second pass calls clearExecutable for mode-only downgrade (PAT path)", async () => {
    const cleared: string[] = [];
    const files: FileContent[] = [makeFile("scripts/run", "same\n", false)];
    await new FileWriter().writeFiles(files, ctx, {
      gitOps: makeGitOpsStub({
        getFileMode: async () => "100755",
        getFileContent: () => "same\n",
        clearExecutable: async (name: string) => {
          cleared.push(name);
        },
      }),
      log: silentLogger,
    });
    assert.deepEqual(cleared, ["scripts/run"]);
  });

  test("second pass calls clearExecutable for content-change downgrade (non-dry-run)", async () => {
    const cleared: string[] = [];
    const files: FileContent[] = [
      makeFile("scripts/run", "new content\n", false),
    ];
    await new FileWriter().writeFiles(files, ctx, {
      gitOps: makeGitOpsStub({
        getFileMode: async () => "100755",
        getFileContent: () => "old content\n",
        wouldChange: () => true,
        clearExecutable: async (name: string) => {
          cleared.push(name);
        },
      }),
      log: silentLogger,
    });
    assert.deepEqual(cleared, ["scripts/run"]);
  });

  test("dry-run reports mode-only drift as MODIFIED and does not render content diff", async () => {
    const infos: string[] = [];
    const fileDiffs: Array<{ name: string }> = [];
    const files: FileContent[] = [makeFile("scripts/run", "same\n", true)];
    const result = await new FileWriter().writeFiles(
      files,
      { ...ctx, dryRun: true },
      {
        gitOps: makeGitOpsStub({
          getFileMode: async () => "100644",
          getFileContent: () => "same\n",
        }),
        log: {
          ...silentLogger,
          info: (m: string) => {
            infos.push(m);
          },
          fileDiff: (name: string) => {
            fileDiffs.push({ name });
          },
        } as unknown as ILogger,
      }
    );
    assert.equal(result.diffStats.modifiedCount, 1);
    assert.ok(
      infos.some((m) =>
        /Would change mode.*scripts\/run.*100644.*100755/.test(m)
      )
    );
    assert.equal(fileDiffs.length, 0);
  });
});
