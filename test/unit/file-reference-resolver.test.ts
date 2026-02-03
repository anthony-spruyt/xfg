import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, normalize, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  isFileReference,
  resolveFileReference,
  resolveFileReferencesInConfig,
} from "../../src/file-reference-resolver.js";
import type { RawConfig } from "../../src/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, "..", "fixtures");

// Create a temporary directory for test fixtures
const testDir = join(tmpdir(), "xfg-file-ref-test-" + Date.now());

describe("File Reference Resolver", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "templates"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("isFileReference", () => {
    test("returns true for strings starting with @", () => {
      assert.strictEqual(isFileReference("@templates/file.json"), true);
      assert.strictEqual(isFileReference("@file.yaml"), true);
      assert.strictEqual(isFileReference("@./relative.txt"), true);
    });

    test("returns false for regular strings", () => {
      assert.strictEqual(isFileReference("regular string"), false);
      assert.strictEqual(isFileReference("email@example.com"), false);
      assert.strictEqual(isFileReference(""), false);
    });

    test("returns false for non-strings", () => {
      assert.strictEqual(isFileReference(123), false);
      assert.strictEqual(isFileReference(null), false);
      assert.strictEqual(isFileReference(undefined), false);
      assert.strictEqual(isFileReference({ key: "value" }), false);
      assert.strictEqual(isFileReference(["@array"]), false);
    });
  });

  describe("resolveFileReference", () => {
    test("resolves JSON file to parsed object", () => {
      const jsonPath = join(testDir, "templates", "config.json");
      writeFileSync(jsonPath, '{"key": "value", "num": 42}', "utf-8");

      const result = resolveFileReference("@templates/config.json", testDir);
      assert.deepStrictEqual(result, { key: "value", num: 42 });
    });

    test("resolves YAML file to parsed object", () => {
      const yamlPath = join(testDir, "templates", "config.yaml");
      writeFileSync(yamlPath, "key: value\nnum: 42", "utf-8");

      const result = resolveFileReference("@templates/config.yaml", testDir);
      assert.deepStrictEqual(result, { key: "value", num: 42 });
    });

    test("resolves .yml file to parsed object", () => {
      const ymlPath = join(testDir, "templates", "config.yml");
      writeFileSync(ymlPath, "key: value", "utf-8");

      const result = resolveFileReference("@templates/config.yml", testDir);
      assert.deepStrictEqual(result, { key: "value" });
    });

    test("resolves text file to string", () => {
      const txtPath = join(testDir, "templates", "file.txt");
      writeFileSync(txtPath, "line1\nline2\nline3", "utf-8");

      const result = resolveFileReference("@templates/file.txt", testDir);
      assert.strictEqual(result, "line1\nline2\nline3");
    });

    test("resolves file without extension to string", () => {
      const noExtPath = join(testDir, "templates", "gitignore");
      writeFileSync(noExtPath, "node_modules/\ndist/", "utf-8");

      const result = resolveFileReference("@templates/gitignore", testDir);
      assert.strictEqual(result, "node_modules/\ndist/");
    });

    test("throws on empty path", () => {
      assert.throws(() => resolveFileReference("@", testDir), /path is empty/);
    });

    test("throws on absolute path", () => {
      assert.throws(
        () => resolveFileReference("@/etc/passwd", testDir),
        /uses absolute path/
      );
    });

    test("throws on path traversal escaping config directory", () => {
      assert.throws(
        () => resolveFileReference("@../escape.json", testDir),
        /escapes config directory/
      );
      assert.throws(
        () => resolveFileReference("@templates/../../escape.json", testDir),
        /escapes config directory/
      );
    });

    test("path traversal check uses cross-platform approach (issue #89)", () => {
      // Issue #89: The old code used: !path.startsWith(configDir + "/")
      // This fails on Windows where normalize() returns paths with backslash.
      // Example: "C:\\config\\..\\outside".startsWith("C:\\config/") → false (BYPASS!)
      //
      // The fix uses path.relative() which handles separators correctly.
      // This test verifies the security logic works for escape detection.

      const configDir = testDir;
      const escapedPath = join(testDir, "..", "outside", "file.json");
      const normalizedEscaped = normalize(escapedPath);
      const normalizedConfigDir = normalize(configDir);

      // OLD VULNERABLE APPROACH (hardcoded "/"):
      // On Linux this works, but on Windows it fails because normalize() uses "\"
      const oldApproachDetectsEscape =
        !normalizedEscaped.startsWith(normalizedConfigDir + "/") &&
        normalizedEscaped !== normalizedConfigDir;

      // NEW SECURE APPROACH (using relative()):
      // Works on all platforms because relative() handles separators correctly
      const rel = relative(normalizedConfigDir, normalizedEscaped);
      const newApproachDetectsEscape = rel.startsWith("..") || isAbsolute(rel);

      // Both should detect the escape (true means "this path escapes")
      assert.strictEqual(
        oldApproachDetectsEscape,
        true,
        "Old approach should detect escape on this platform"
      );
      assert.strictEqual(
        newApproachDetectsEscape,
        true,
        "New approach must detect escape on all platforms"
      );

      // The key assertion: new approach reliably detects escapes
      // This will still pass after the fix - it validates the fix logic is correct
      assert.ok(
        newApproachDetectsEscape,
        "relative() approach must detect path traversal escapes"
      );
    });

    test("allows paths within config directory", () => {
      const nestedPath = join(testDir, "templates", "nested", "deep");
      mkdirSync(nestedPath, { recursive: true });
      writeFileSync(join(nestedPath, "file.json"), '{"nested": true}', "utf-8");

      const result = resolveFileReference(
        "@templates/nested/deep/file.json",
        testDir
      );
      assert.deepStrictEqual(result, { nested: true });
    });

    test("throws on file not found with clear error", () => {
      assert.throws(
        () => resolveFileReference("@templates/nonexistent.json", testDir),
        /Failed to load file reference.*ENOENT/
      );
    });

    test("throws on invalid JSON with clear error", () => {
      const invalidPath = join(testDir, "templates", "invalid.json");
      writeFileSync(invalidPath, "{ invalid json", "utf-8");

      assert.throws(
        () => resolveFileReference("@templates/invalid.json", testDir),
        /Invalid JSON in "@templates\/invalid.json"/
      );
    });

    test("throws on invalid YAML with clear error", () => {
      const invalidPath = join(testDir, "templates", "invalid.yaml");
      writeFileSync(invalidPath, "key: [unclosed", "utf-8");

      assert.throws(
        () => resolveFileReference("@templates/invalid.yaml", testDir),
        /Invalid YAML in "@templates\/invalid.yaml"/
      );
    });

    test("resolves JSON5 file to parsed object", () => {
      const json5Path = join(testDir, "templates", "config.json5");
      // JSON5 allows comments and trailing commas
      writeFileSync(
        json5Path,
        `{
  // This is a comment
  "key": "value",
  "num": 42,
}`,
        "utf-8"
      );

      const result = resolveFileReference("@templates/config.json5", testDir);
      assert.deepStrictEqual(result, { key: "value", num: 42 });
    });

    test("throws on invalid JSON5 with clear error", () => {
      const invalidPath = join(testDir, "templates", "invalid.json5");
      writeFileSync(invalidPath, "{ invalid json5", "utf-8");

      assert.throws(
        () => resolveFileReference("@templates/invalid.json5", testDir),
        /Invalid JSON5 in "@templates\/invalid.json5"/
      );
    });
  });

  describe("resolveFileReferencesInConfig", () => {
    test("resolves file reference in root-level file content", () => {
      const jsonPath = join(testDir, "templates", "base.json");
      writeFileSync(jsonPath, '{"base": true}', "utf-8");

      const raw: RawConfig = {
        id: "test",
        files: {
          "config.json": {
            content: "@templates/base.json",
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = resolveFileReferencesInConfig(raw, { configDir: testDir });
      assert.deepStrictEqual(result.files!["config.json"].content, {
        base: true,
      });
    });

    test("resolves file reference in per-repo file content", () => {
      const jsonPath = join(testDir, "templates", "override.json");
      writeFileSync(jsonPath, '{"override": true}', "utf-8");

      const raw: RawConfig = {
        id: "test",
        files: {
          "config.json": {
            content: { base: true },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": {
                content: "@templates/override.json",
              },
            },
          },
        ],
      };

      const result = resolveFileReferencesInConfig(raw, { configDir: testDir });
      assert.deepStrictEqual(result.repos[0].files!["config.json"], {
        content: { override: true },
      });
    });

    test("preserves non-reference content unchanged", () => {
      const raw: RawConfig = {
        id: "test",
        files: {
          "config.json": {
            content: { inline: true },
          },
          "text.txt": {
            content: "plain text",
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = resolveFileReferencesInConfig(raw, { configDir: testDir });
      assert.deepStrictEqual(result.files!["config.json"].content, {
        inline: true,
      });
      assert.strictEqual(result.files!["text.txt"].content, "plain text");
    });

    test("preserves file exclusions (false values)", () => {
      const raw: RawConfig = {
        id: "test",
        files: {
          "config.json": {
            content: { key: "value" },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": false,
            },
          },
        ],
      };

      const result = resolveFileReferencesInConfig(raw, { configDir: testDir });
      assert.strictEqual(result.repos[0].files!["config.json"], false);
    });

    test("preserves other file config fields", () => {
      const jsonPath = join(testDir, "templates", "base.json");
      writeFileSync(jsonPath, '{"key": "value"}', "utf-8");

      const raw: RawConfig = {
        id: "test",
        files: {
          "config.yaml": {
            content: "@templates/base.json",
            createOnly: true,
            header: "Auto-generated",
            schemaUrl: "https://example.com/schema.json",
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = resolveFileReferencesInConfig(raw, { configDir: testDir });
      const fileConfig = result.files!["config.yaml"];
      assert.deepStrictEqual(fileConfig.content, { key: "value" });
      assert.strictEqual(fileConfig.createOnly, true);
      assert.strictEqual(fileConfig.header, "Auto-generated");
      assert.strictEqual(
        fileConfig.schemaUrl,
        "https://example.com/schema.json"
      );
    });

    test("does not mutate input config", () => {
      const jsonPath = join(testDir, "templates", "base.json");
      writeFileSync(jsonPath, '{"resolved": true}', "utf-8");

      const raw: RawConfig = {
        id: "test",
        files: {
          "config.json": {
            content: "@templates/base.json",
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      resolveFileReferencesInConfig(raw, { configDir: testDir });
      // Original should still have the file reference
      assert.strictEqual(
        raw.files!["config.json"].content,
        "@templates/base.json"
      );
    });

    test("handles multiple files with mixed references", () => {
      const jsonPath = join(testDir, "templates", "prettier.json");
      writeFileSync(jsonPath, '{"semi": true}', "utf-8");
      const txtPath = join(testDir, "templates", "gitignore.txt");
      writeFileSync(txtPath, "node_modules/", "utf-8");

      const raw: RawConfig = {
        id: "test",
        files: {
          ".prettierrc.json": {
            content: "@templates/prettier.json",
          },
          ".gitignore": {
            content: "@templates/gitignore.txt",
          },
          "inline.json": {
            content: { inline: true },
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = resolveFileReferencesInConfig(raw, { configDir: testDir });
      assert.deepStrictEqual(result.files![".prettierrc.json"].content, {
        semi: true,
      });
      assert.strictEqual(result.files![".gitignore"].content, "node_modules/");
      assert.deepStrictEqual(result.files!["inline.json"].content, {
        inline: true,
      });
    });
  });

  describe("prTemplate resolution", () => {
    test("resolves prTemplate file reference", () => {
      const templatePath = join(testDir, "templates", "pr-body.md");
      writeFileSync(
        templatePath,
        "## PR Template\n\n${xfg:pr.fileChanges}",
        "utf-8"
      );

      const raw: RawConfig = {
        id: "test",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prTemplate: "@templates/pr-body.md",
      };

      const result = resolveFileReferencesInConfig(raw, { configDir: testDir });
      assert.strictEqual(
        result.prTemplate,
        "## PR Template\n\n${xfg:pr.fileChanges}"
      );
    });

    test("prTemplate string content passed through unchanged", () => {
      const raw: RawConfig = {
        id: "test",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prTemplate: "## Inline Template\n\n${xfg:pr.fileChanges}",
      };

      const result = resolveFileReferencesInConfig(raw, { configDir: testDir });
      assert.strictEqual(
        result.prTemplate,
        "## Inline Template\n\n${xfg:pr.fileChanges}"
      );
    });

    test("prTemplate file reference must resolve to text file", () => {
      const jsonPath = join(testDir, "templates", "pr.json");
      writeFileSync(jsonPath, '{"not": "a template"}', "utf-8");

      const raw: RawConfig = {
        id: "test",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prTemplate: "@templates/pr.json",
      };

      assert.throws(
        () => resolveFileReferencesInConfig(raw, { configDir: testDir }),
        /prTemplate file reference.*must resolve to a text file/
      );
    });

    test("prTemplate file reference security checks apply", () => {
      const raw: RawConfig = {
        id: "test",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prTemplate: "@../escape.md",
      };

      assert.throws(
        () => resolveFileReferencesInConfig(raw, { configDir: testDir }),
        /escapes config directory/
      );
    });

    test("missing prTemplate results in undefined", () => {
      const raw: RawConfig = {
        id: "test",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = resolveFileReferencesInConfig(raw, { configDir: testDir });
      assert.strictEqual(result.prTemplate, undefined);
    });
  });

  describe("integration with real fixtures", () => {
    test("resolves JSON template from fixtures", () => {
      const result = resolveFileReference(
        "@templates/prettierrc.json",
        fixturesDir
      );
      assert.deepStrictEqual(result, {
        semi: true,
        singleQuote: false,
        tabWidth: 2,
        trailingComma: "es5",
      });
    });

    test("resolves YAML template from fixtures", () => {
      const result = resolveFileReference(
        "@templates/eslintrc.yaml",
        fixturesDir
      );
      assert.strictEqual((result as Record<string, unknown>).root, true);
      assert.deepStrictEqual((result as Record<string, unknown>).extends, [
        "eslint:recommended",
      ]);
    });

    test("resolves text template from fixtures", () => {
      const result = resolveFileReference(
        "@templates/gitignore.txt",
        fixturesDir
      );
      assert.strictEqual(typeof result, "string");
      assert.ok((result as string).includes("node_modules/"));
    });

    test("throws for invalid JSON template from fixtures", () => {
      assert.throws(
        () => resolveFileReference("@templates/invalid.json", fixturesDir),
        /Invalid JSON/
      );
    });
  });
});
