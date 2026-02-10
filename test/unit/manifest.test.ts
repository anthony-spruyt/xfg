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
  getManagedRulesets,
  updateManifest,
  updateManifestRulesets,
} from "../../src/sync/manifest.js";

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
    test("creates manifest with version 3", () => {
      const manifest = createEmptyManifest();
      assert.equal(manifest.version, 3);
    });

    test("creates manifest with empty configs object", () => {
      const manifest = createEmptyManifest();
      assert.deepEqual(manifest.configs, {});
    });
  });

  describe("loadManifest", () => {
    test("returns null if manifest file does not exist", () => {
      const result = loadManifest(testDir);
      assert.equal(result, null);
    });

    test("loads valid v3 manifest file", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: {
          "config-a": { files: ["file1.json", "file2.yaml"] },
          "config-b": { files: ["file3.json"], rulesets: ["pr-rules"] },
        },
      };
      writeFileSync(
        join(testDir, MANIFEST_FILENAME),
        JSON.stringify(manifest),
        "utf-8"
      );

      const result = loadManifest(testDir);
      assert.deepEqual(result, manifest);
    });

    test("migrates v2 manifest to v3", () => {
      const v2Manifest = {
        version: 2,
        configs: {
          "config-a": ["file1.json", "file2.yaml"],
          "config-b": ["file3.json"],
        },
      };
      writeFileSync(
        join(testDir, MANIFEST_FILENAME),
        JSON.stringify(v2Manifest),
        "utf-8"
      );

      const result = loadManifest(testDir);
      assert.equal(result?.version, 3);
      assert.deepEqual(result?.configs["config-a"], {
        files: ["file1.json", "file2.yaml"],
      });
      assert.deepEqual(result?.configs["config-b"], { files: ["file3.json"] });
    });

    test("returns null for invalid JSON", () => {
      writeFileSync(
        join(testDir, MANIFEST_FILENAME),
        "not valid json",
        "utf-8"
      );

      const result = loadManifest(testDir);
      assert.equal(result, null);
    });

    test("returns null for v1 manifest (migration: treat as no manifest)", () => {
      const v1Manifest = { version: 1, managedFiles: ["file.json"] };
      writeFileSync(
        join(testDir, MANIFEST_FILENAME),
        JSON.stringify(v1Manifest),
        "utf-8"
      );

      const result = loadManifest(testDir);
      assert.equal(result, null);
    });

    test("returns null for unknown version", () => {
      const manifest = { version: 99, data: {} };
      writeFileSync(
        join(testDir, MANIFEST_FILENAME),
        JSON.stringify(manifest),
        "utf-8"
      );

      const result = loadManifest(testDir);
      assert.equal(result, null);
    });

    test("returns null if configs is not an object", () => {
      const manifest = { version: 3, configs: "not-an-object" };
      writeFileSync(
        join(testDir, MANIFEST_FILENAME),
        JSON.stringify(manifest),
        "utf-8"
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
        version: 3,
        configs: {
          "my-config": { files: ["config.json"] },
        },
      };

      saveManifest(testDir, manifest);

      const content = readFileSync(join(testDir, MANIFEST_FILENAME), "utf-8");
      const parsed = JSON.parse(content);
      assert.deepEqual(parsed, manifest);
    });

    test("saves manifest with 2-space indentation", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: { "config-a": { files: ["file.json"] } },
      };

      saveManifest(testDir, manifest);

      const content = readFileSync(join(testDir, MANIFEST_FILENAME), "utf-8");
      assert.ok(content.includes('  "version"'));
    });

    test("saves manifest with trailing newline", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: {},
      };

      saveManifest(testDir, manifest);

      const content = readFileSync(join(testDir, MANIFEST_FILENAME), "utf-8");
      assert.ok(content.endsWith("\n"));
    });
  });

  describe("getManagedFiles", () => {
    test("returns empty array for null manifest", () => {
      const result = getManagedFiles(null, "any-config");
      assert.deepEqual(result, []);
    });

    test("returns empty array for non-existent config", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: {
          "other-config": { files: ["file.json"] },
        },
      };

      const result = getManagedFiles(manifest, "non-existent-config");
      assert.deepEqual(result, []);
    });

    test("returns files for specific config", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: {
          "config-a": { files: ["file1.json", "file2.yaml"] },
          "config-b": { files: ["file3.json"] },
        },
      };

      const result = getManagedFiles(manifest, "config-a");
      assert.deepEqual(result, ["file1.json", "file2.yaml"]);
    });

    test("returns copy of managedFiles array", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: {
          "my-config": { files: ["file1.json", "file2.yaml"] },
        },
      };

      const result = getManagedFiles(manifest, "my-config");
      assert.deepEqual(result, ["file1.json", "file2.yaml"]);

      // Verify it's a copy, not the same reference
      result.push("file3.json");
      assert.equal(manifest.configs["my-config"].files!.length, 2);
    });

    test("returns empty array when config has no files", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: {
          "my-config": { rulesets: ["pr-rules"] },
        },
      };

      const result = getManagedFiles(manifest, "my-config");
      assert.deepEqual(result, []);
    });
  });

  describe("getManagedRulesets", () => {
    test("returns empty array for null manifest", () => {
      const result = getManagedRulesets(null, "any-config");
      assert.deepEqual(result, []);
    });

    test("returns empty array for non-existent config", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: {
          "other-config": { rulesets: ["pr-rules"] },
        },
      };

      const result = getManagedRulesets(manifest, "non-existent-config");
      assert.deepEqual(result, []);
    });

    test("returns rulesets for specific config", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: {
          "config-a": { rulesets: ["pr-rules", "release-rules"] },
          "config-b": { rulesets: ["tag-rules"] },
        },
      };

      const result = getManagedRulesets(manifest, "config-a");
      assert.deepEqual(result, ["pr-rules", "release-rules"]);
    });

    test("returns copy of rulesets array", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: {
          "my-config": { rulesets: ["pr-rules", "release-rules"] },
        },
      };

      const result = getManagedRulesets(manifest, "my-config");
      assert.deepEqual(result, ["pr-rules", "release-rules"]);

      // Verify it's a copy, not the same reference
      result.push("new-rules");
      assert.equal(manifest.configs["my-config"].rulesets!.length, 2);
    });

    test("returns empty array when config has no rulesets", () => {
      const manifest: XfgManifest = {
        version: 3,
        configs: {
          "my-config": { files: ["config.json"] },
        },
      };

      const result = getManagedRulesets(manifest, "my-config");
      assert.deepEqual(result, []);
    });
  });

  describe("updateManifest", () => {
    const configId = "test-config";

    test("adds files with deleteOrphaned: true to managedFiles", () => {
      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", true);
      filesMap.set("settings.yaml", true);

      const { manifest, filesToDelete } = updateManifest(
        null,
        configId,
        filesMap
      );

      assert.deepEqual(manifest.configs[configId]?.files, [
        "config.json",
        "settings.yaml",
      ]);
      assert.deepEqual(filesToDelete, []);
    });

    test("does not add files with deleteOrphaned: false", () => {
      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", true);
      filesMap.set("settings.yaml", false);

      const { manifest } = updateManifest(null, configId, filesMap);

      assert.deepEqual(manifest.configs[configId]?.files, ["config.json"]);
    });

    test("does not add files with deleteOrphaned: undefined", () => {
      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", true);
      filesMap.set("settings.yaml", undefined);

      const { manifest } = updateManifest(null, configId, filesMap);

      assert.deepEqual(manifest.configs[configId]?.files, ["config.json"]);
    });

    test("marks orphaned files for deletion", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          [configId]: { files: ["old-config.json", "config.json"] },
        },
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", true);
      // old-config.json is not in filesMap, so it should be deleted

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        configId,
        filesMap
      );

      assert.deepEqual(manifest.configs[configId]?.files, ["config.json"]);
      assert.deepEqual(filesToDelete, ["old-config.json"]);
    });

    test("does not delete files that are in config but without deleteOrphaned", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          [configId]: { files: ["config.json"] },
        },
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", undefined); // In config but no deleteOrphaned

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        configId,
        filesMap
      );

      // File is in config (undefined deleteOrphaned), so not marked for deletion
      // But also not in managedFiles anymore since deleteOrphaned is not true
      assert.equal(manifest.configs[configId], undefined);
      assert.deepEqual(filesToDelete, []);
    });

    test("removes file from tracking when deleteOrphaned set to false", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          [configId]: { files: ["config.json"] },
        },
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("config.json", false); // Explicitly disabled

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        configId,
        filesMap
      );

      // File is explicitly set to false, so removed from tracking
      // Not deleted because it's still in the config
      assert.equal(manifest.configs[configId], undefined);
      assert.deepEqual(filesToDelete, []);
    });

    test("sorts managedFiles alphabetically", () => {
      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("zebra.json", true);
      filesMap.set("alpha.yaml", true);
      filesMap.set("middle.json", true);

      const { manifest } = updateManifest(null, configId, filesMap);

      assert.deepEqual(manifest.configs[configId]?.files, [
        "alpha.yaml",
        "middle.json",
        "zebra.json",
      ]);
    });

    test("handles empty existing manifest", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {},
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("new-file.json", true);

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        configId,
        filesMap
      );

      assert.deepEqual(manifest.configs[configId]?.files, ["new-file.json"]);
      assert.deepEqual(filesToDelete, []);
    });

    test("handles empty files map", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          [configId]: { files: ["orphan.json"] },
        },
      };

      const filesMap = new Map<string, boolean | undefined>();

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        configId,
        filesMap
      );

      assert.equal(manifest.configs[configId], undefined);
      assert.deepEqual(filesToDelete, ["orphan.json"]);
    });

    test("creates version 3 manifest", () => {
      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("file.json", true);

      const { manifest } = updateManifest(null, configId, filesMap);

      assert.equal(manifest.version, 3);
    });

    test("preserves other configs when updating one config", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          "config-a": { files: ["file-a.json"] },
          "config-b": { files: ["file-b.json"] },
        },
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("new-file-a.json", true);

      const { manifest } = updateManifest(
        existingManifest,
        "config-a",
        filesMap
      );

      // config-a should be updated
      assert.deepEqual(manifest.configs["config-a"]?.files, [
        "new-file-a.json",
      ]);
      // config-b should be preserved
      assert.deepEqual(manifest.configs["config-b"]?.files, ["file-b.json"]);
    });

    test("only marks orphans from same config for deletion", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          "config-a": { files: ["shared-file.json", "orphan-a.json"] },
          "config-b": { files: ["shared-file.json", "file-b.json"] },
        },
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("shared-file.json", true);
      // orphan-a.json is not in filesMap for config-a

      const { manifest, filesToDelete } = updateManifest(
        existingManifest,
        "config-a",
        filesMap
      );

      // Only orphan-a.json should be deleted (from config-a)
      // config-b's files should not be touched
      assert.deepEqual(manifest.configs["config-a"]?.files, [
        "shared-file.json",
      ]);
      assert.deepEqual(manifest.configs["config-b"]?.files, [
        "shared-file.json",
        "file-b.json",
      ]);
      assert.deepEqual(filesToDelete, ["orphan-a.json"]);
    });

    test("removes config entry when no files have deleteOrphaned", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          "config-a": { files: ["file.json"] },
          "config-b": { files: ["other.json"] },
        },
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("file.json", false); // Explicitly disabled

      const { manifest } = updateManifest(
        existingManifest,
        "config-a",
        filesMap
      );

      // config-a should be removed from configs
      assert.equal(manifest.configs["config-a"], undefined);
      // config-b should be preserved
      assert.deepEqual(manifest.configs["config-b"]?.files, ["other.json"]);
    });

    test("preserves rulesets when updating files", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          [configId]: { files: ["old-file.json"], rulesets: ["pr-rules"] },
        },
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("new-file.json", true);

      const { manifest } = updateManifest(existingManifest, configId, filesMap);

      assert.deepEqual(manifest.configs[configId]?.files, ["new-file.json"]);
      assert.deepEqual(manifest.configs[configId]?.rulesets, ["pr-rules"]);
    });

    test("preserves config entry if only rulesets exist after removing files", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          [configId]: { files: ["file.json"], rulesets: ["pr-rules"] },
        },
      };

      const filesMap = new Map<string, boolean | undefined>();
      filesMap.set("file.json", false); // Explicitly disable files tracking

      const { manifest } = updateManifest(existingManifest, configId, filesMap);

      // Config should still exist because of rulesets
      assert.ok(manifest.configs[configId]);
      assert.equal(manifest.configs[configId]?.files, undefined);
      assert.deepEqual(manifest.configs[configId]?.rulesets, ["pr-rules"]);
    });
  });

  describe("updateManifestRulesets", () => {
    const configId = "test-config";

    test("adds rulesets with deleteOrphaned: true", () => {
      const rulesetsMap = new Map<string, boolean | undefined>();
      rulesetsMap.set("pr-rules", true);
      rulesetsMap.set("release-rules", true);

      const { manifest, rulesetsToDelete } = updateManifestRulesets(
        null,
        configId,
        rulesetsMap
      );

      assert.deepEqual(manifest.configs[configId]?.rulesets, [
        "pr-rules",
        "release-rules",
      ]);
      assert.deepEqual(rulesetsToDelete, []);
    });

    test("does not add rulesets with deleteOrphaned: false", () => {
      const rulesetsMap = new Map<string, boolean | undefined>();
      rulesetsMap.set("pr-rules", true);
      rulesetsMap.set("release-rules", false);

      const { manifest } = updateManifestRulesets(null, configId, rulesetsMap);

      assert.deepEqual(manifest.configs[configId]?.rulesets, ["pr-rules"]);
    });

    test("marks orphaned rulesets for deletion", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          [configId]: { rulesets: ["old-rules", "pr-rules"] },
        },
      };

      const rulesetsMap = new Map<string, boolean | undefined>();
      rulesetsMap.set("pr-rules", true);

      const { manifest, rulesetsToDelete } = updateManifestRulesets(
        existingManifest,
        configId,
        rulesetsMap
      );

      assert.deepEqual(manifest.configs[configId]?.rulesets, ["pr-rules"]);
      assert.deepEqual(rulesetsToDelete, ["old-rules"]);
    });

    test("preserves files when updating rulesets", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          [configId]: { files: ["config.json"], rulesets: ["old-rules"] },
        },
      };

      const rulesetsMap = new Map<string, boolean | undefined>();
      rulesetsMap.set("new-rules", true);

      const { manifest } = updateManifestRulesets(
        existingManifest,
        configId,
        rulesetsMap
      );

      assert.deepEqual(manifest.configs[configId]?.files, ["config.json"]);
      assert.deepEqual(manifest.configs[configId]?.rulesets, ["new-rules"]);
    });

    test("preserves config entry if only files exist after removing rulesets", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          [configId]: { files: ["config.json"], rulesets: ["pr-rules"] },
        },
      };

      const rulesetsMap = new Map<string, boolean | undefined>();
      rulesetsMap.set("pr-rules", false);

      const { manifest } = updateManifestRulesets(
        existingManifest,
        configId,
        rulesetsMap
      );

      assert.ok(manifest.configs[configId]);
      assert.deepEqual(manifest.configs[configId]?.files, ["config.json"]);
      assert.equal(manifest.configs[configId]?.rulesets, undefined);
    });

    test("removes config entry when no files or rulesets remain", () => {
      const existingManifest: XfgManifest = {
        version: 3,
        configs: {
          [configId]: { rulesets: ["pr-rules"] },
        },
      };

      const rulesetsMap = new Map<string, boolean | undefined>();
      rulesetsMap.set("pr-rules", false);

      const { manifest } = updateManifestRulesets(
        existingManifest,
        configId,
        rulesetsMap
      );

      assert.equal(manifest.configs[configId], undefined);
    });

    test("creates version 3 manifest", () => {
      const rulesetsMap = new Map<string, boolean | undefined>();
      rulesetsMap.set("pr-rules", true);

      const { manifest } = updateManifestRulesets(null, configId, rulesetsMap);

      assert.equal(manifest.version, 3);
    });

    test("sorts rulesets alphabetically", () => {
      const rulesetsMap = new Map<string, boolean | undefined>();
      rulesetsMap.set("zebra-rules", true);
      rulesetsMap.set("alpha-rules", true);
      rulesetsMap.set("middle-rules", true);

      const { manifest } = updateManifestRulesets(null, configId, rulesetsMap);

      assert.deepEqual(manifest.configs[configId]?.rulesets, [
        "alpha-rules",
        "middle-rules",
        "zebra-rules",
      ]);
    });
  });
});
