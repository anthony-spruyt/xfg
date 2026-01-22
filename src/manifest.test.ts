import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MANIFEST_FILENAME,
  XfgManifest,
  createEmptyManifest,
  loadManifest,
  saveManifest,
  getManagedFiles,
  updateManifest,
} from "./manifest.js";

describe("manifest", () => {
  const testDir = join(process.cwd(), "tmp-manifest-test");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("MANIFEST_FILENAME", () => {
    test("should be .xfg.json", () => {
      assert.equal(MANIFEST_FILENAME, ".xfg.json");
    });
  });

  describe("createEmptyManifest", () => {
    test("creates manifest with version 1", () => {
      const manifest = createEmptyManifest();
      assert.equal(manifest.version, 1);
    });

    test("creates manifest with empty managedFiles array", () => {
      const manifest = createEmptyManifest();
      assert.deepEqual(manifest.managedFiles, []);
    });
  });

  describe("loadManifest", () => {
    test("returns null if manifest file does not exist", () => {
      const result = loadManifest(testDir);
      assert.equal(result, null);
    });

    test("loads valid manifest file", () => {
      const manifest: XfgManifest = {
        version: 1,
        managedFiles: ["file1.json", "file2.yaml"],
      };
      writeFileSync(
        join(testDir, MANIFEST_FILENAME),
        JSON.stringify(manifest),
        "utf-8",
      );

      const result = loadManifest(testDir);
      assert.deepEqual(result, manifest);
    });

    test("returns null for invalid JSON", () => {
      writeFileSync(
        join(testDir, MANIFEST_FILENAME),
        "not valid json",
        "utf-8",
      );

      const result = loadManifest(testDir);
      assert.equal(result, null);
    });

    test("returns null for wrong version", () => {
      const manifest = { version: 2, managedFiles: [] };
      writeFileSync(
        join(testDir, MANIFEST_FILENAME),
        JSON.stringify(manifest),
        "utf-8",
      );

      const result = loadManifest(testDir);
      assert.equal(result, null);
    });

    test("returns null if managedFiles is not an array", () => {
      const manifest = { version: 1, managedFiles: "not-an-array" };
      writeFileSync(
        join(testDir, MANIFEST_FILENAME),
        JSON.stringify(manifest),
        "utf-8",
      );

      const result = loadManifest(testDir);
      assert.equal(result, null);
    });

    test("returns null for non-object content", () => {
      writeFileSync(join(testDir, MANIFEST_FILENAME), '"string"', "utf-8");

      const result = loadManifest(testDir);
      assert.equal(result, null);
    });
  });

  describe("saveManifest", () => {
    test("saves manifest to file", () => {
      const manifest: XfgManifest = {
        version: 1,
        managedFiles: ["config.json"],
      };

      saveManifest(testDir, manifest);

      const content = readFileSync(join(testDir, MANIFEST_FILENAME), "utf-8");
      const parsed = JSON.parse(content);
      assert.deepEqual(parsed, manifest);
    });

    test("saves manifest with 2-space indentation", () => {
      const manifest: XfgManifest = {
        version: 1,
        managedFiles: ["file.json"],
      };

      saveManifest(testDir, manifest);

      const content = readFileSync(join(testDir, MANIFEST_FILENAME), "utf-8");
      assert.ok(content.includes('  "version"'));
    });

    test("saves manifest with trailing newline", () => {
      const manifest: XfgManifest = {
        version: 1,
        managedFiles: [],
      };

      saveManifest(testDir, manifest);

      const content = readFileSync(join(testDir, MANIFEST_FILENAME), "utf-8");
      assert.ok(content.endsWith("\n"));
    });
  });

  describe("getManagedFiles", () => {
    test("returns empty array for null manifest", () => {
      const result = getManagedFiles(null);
      assert.deepEqual(result, []);
    });

    test("returns copy of managedFiles array", () => {
      const manifest: XfgManifest = {
        version: 1,
        managedFiles: ["file1.json", "file2.yaml"],
      };

      const result = getManagedFiles(manifest);
      assert.deepEqual(result, ["file1.json", "file2.yaml"]);

      // Verify it's a copy, not the same reference
      result.push("file3.json");
      assert.equal(manifest.managedFiles.length, 2);
    });
  });

  describe("updateManifest", () => {
    test("adds files with deleteOrphaned: true to managedFiles", () => {
      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", true);
      filesMap.set("settings.yaml", true);

      const { manifest, filesToDelete } = updateManifest(null, filesMap);

      assert.deepEqual(manifest.managedFiles, ["config.json", "settings.yaml"]);
      assert.deepEqual(filesToDelete, []);
    });

    test("does not add files with deleteOrphaned: false", () => {
      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", true);
      filesMap.set("settings.yaml", false);

      const { manifest } = updateManifest(null, filesMap);

      assert.deepEqual(manifest.managedFiles, ["config.json"]);
    });

    test("does not add files with deleteOrphaned: undefined", () => {
      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", true);
      filesMap.set("settings.yaml", undefined);

      const { manifest } = updateManifest(null, filesMap);

      assert.deepEqual(manifest.managedFiles, ["config.json"]);
    });

    test("marks orphaned files for deletion", () => {
      const existingManifest: XfgManifest = {
        version: 1,
        managedFiles: ["old-config.json", "config.json"],
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", true);
      // old-config.json is not in filesMap, so it should be deleted

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        filesMap,
      );

      assert.deepEqual(manifest.managedFiles, ["config.json"]);
      assert.deepEqual(filesToDelete, ["old-config.json"]);
    });

    test("does not delete files that are in config but without deleteOrphaned", () => {
      const existingManifest: XfgManifest = {
        version: 1,
        managedFiles: ["config.json"],
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", undefined); // In config but no deleteOrphaned

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        filesMap,
      );

      // File is in config (undefined deleteOrphaned), so not marked for deletion
      // But also not in managedFiles anymore since deleteOrphaned is not true
      assert.deepEqual(manifest.managedFiles, []);
      assert.deepEqual(filesToDelete, []);
    });

    test("removes file from tracking when deleteOrphaned set to false", () => {
      const existingManifest: XfgManifest = {
        version: 1,
        managedFiles: ["config.json"],
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", false); // Explicitly disabled

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        filesMap,
      );

      // File is explicitly set to false, so removed from tracking
      // Not deleted because it's still in the config
      assert.deepEqual(manifest.managedFiles, []);
      assert.deepEqual(filesToDelete, []);
    });

    test("sorts managedFiles alphabetically", () => {
      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("zebra.json", true);
      filesMap.set("alpha.yaml", true);
      filesMap.set("middle.json", true);

      const { manifest } = updateManifest(null, filesMap);

      assert.deepEqual(manifest.managedFiles, [
        "alpha.yaml",
        "middle.json",
        "zebra.json",
      ]);
    });

    test("handles empty existing manifest", () => {
      const existingManifest: XfgManifest = {
        version: 1,
        managedFiles: [],
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("new-file.json", true);

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        filesMap,
      );

      assert.deepEqual(manifest.managedFiles, ["new-file.json"]);
      assert.deepEqual(filesToDelete, []);
    });

    test("handles empty files map", () => {
      const existingManifest: XfgManifest = {
        version: 1,
        managedFiles: ["orphan.json"],
      };

      const filesMap = new Map<string, boolean | undefined>();

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        filesMap,
      );

      assert.deepEqual(manifest.managedFiles, []);
      assert.deepEqual(filesToDelete, ["orphan.json"]);
    });

    test("creates version 1 manifest", () => {
      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("file.json", true);

      const { manifest } = updateManifest(null, filesMap);

      assert.equal(manifest.version, 1);
    });
  });
});
