import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManifestManager } from "../../../src/sync/manifest-manager.js";
import {
  createMockAuthenticatedGitOps,
  createMockLogger,
} from "../../mocks/index.js";
import type { FileWriteResult } from "../../../src/sync/types.js";
import { MANIFEST_FILENAME } from "../../../src/sync/manifest.js";

const testDir = join(tmpdir(), "manifest-manager-test-" + Date.now());

describe("ManifestManager", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = join(testDir, `workspace-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("processOrphans", () => {
    test("identifies orphaned files from previous manifest", () => {
      // Setup: Create a manifest with a file that's no longer in config
      const manifest = {
        version: 3,
        configs: {
          "test-config": {
            files: ["old-file.json", "current-file.json"],
          },
        },
      };
      writeFileSync(
        join(workDir, MANIFEST_FILENAME),
        JSON.stringify(manifest, null, 2)
      );

      const manager = new ManifestManager();
      const currentFiles = new Map<string, boolean | undefined>([
        ["current-file.json", true],
      ]);

      const result = manager.processOrphans(
        workDir,
        "test-config",
        currentFiles
      );

      assert.deepEqual(result.filesToDelete, ["old-file.json"]);
    });

    test("returns empty array when no orphans", () => {
      const manifest = {
        version: 3,
        configs: {
          "test-config": {
            files: ["file.json"],
          },
        },
      };
      writeFileSync(
        join(workDir, MANIFEST_FILENAME),
        JSON.stringify(manifest, null, 2)
      );

      const manager = new ManifestManager();
      const currentFiles = new Map<string, boolean | undefined>([
        ["file.json", true],
      ]);

      const result = manager.processOrphans(
        workDir,
        "test-config",
        currentFiles
      );

      assert.deepEqual(result.filesToDelete, []);
    });

    test("handles missing manifest gracefully", () => {
      const manager = new ManifestManager();
      const currentFiles = new Map<string, boolean | undefined>([
        ["file.json", true],
      ]);

      const result = manager.processOrphans(
        workDir,
        "test-config",
        currentFiles
      );

      assert.deepEqual(result.filesToDelete, []);
    });
  });

  describe("deleteOrphans", () => {
    test("deletes files that exist and tracks in fileChanges", async () => {
      const deletedFiles: string[] = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: (fileName) => fileName === "orphan.json",
        onDeleteFile: (fileName) => deletedFiles.push(fileName),
      });
      const { mock: mockLogger } = createMockLogger();

      const manager = new ManifestManager();
      const fileChanges = new Map<string, FileWriteResult>();

      await manager.deleteOrphans(
        ["orphan.json", "nonexistent.json"],
        {
          dryRun: false,
          noDelete: false,
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
          fileChanges,
        }
      );

      assert.equal(deletedFiles.length, 1);
      assert.equal(deletedFiles[0], "orphan.json");
      assert.equal(fileChanges.get("orphan.json")?.action, "delete");
    });

    test("does not delete when noDelete is true", async () => {
      const deletedFiles: string[] = [];
      const { mock: mockGitOps } = createMockAuthenticatedGitOps({
        fileExists: () => true,
        onDeleteFile: (fileName) => deletedFiles.push(fileName),
      });
      const { mock: mockLogger } = createMockLogger();

      const manager = new ManifestManager();
      const fileChanges = new Map<string, FileWriteResult>();

      await manager.deleteOrphans(
        ["orphan.json"],
        {
          dryRun: false,
          noDelete: true,
        },
        {
          gitOps: mockGitOps,
          log: mockLogger,
          fileChanges,
        }
      );

      assert.equal(deletedFiles.length, 0);
    });
  });

  describe("saveManifest", () => {
    test("saves manifest and tracks change in fileChanges", () => {
      const manager = new ManifestManager();
      const fileChanges = new Map<string, FileWriteResult>();
      const manifest = {
        version: 3 as const,
        configs: {
          "test-config": { files: ["file.json"] },
        },
      };

      manager.saveUpdatedManifest(workDir, manifest, null, false, fileChanges);

      assert.equal(existsSync(join(workDir, MANIFEST_FILENAME)), true);
      assert.equal(fileChanges.get(MANIFEST_FILENAME)?.action, "create");
    });

    test("does not save in dryRun mode", () => {
      const manager = new ManifestManager();
      const fileChanges = new Map<string, FileWriteResult>();
      const manifest = {
        version: 3 as const,
        configs: {
          "test-config": { files: ["file.json"] },
        },
      };

      manager.saveUpdatedManifest(workDir, manifest, null, true, fileChanges);

      assert.equal(existsSync(join(workDir, MANIFEST_FILENAME)), false);
    });
  });
});
