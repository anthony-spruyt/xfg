import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  validateRawConfig,
  validateForSync,
  validateForSettings,
  hasActionableSettings,
} from "../../src/config-validator.js";
import type { RawConfig } from "../../src/config.js";

describe("validateRawConfig", () => {
  // Helper to create a minimal valid config
  const createValidConfig = (overrides?: Partial<RawConfig>): RawConfig => ({
    id: "test-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    repos: [{ git: "git@github.com:org/repo.git" }],
    ...overrides,
  });

  describe("id validation", () => {
    test("throws when id is missing", () => {
      const config = {
        files: { "config.json": { content: {} } },
        repos: [{ git: "git@github.com:org/repo.git" }],
      } as unknown as RawConfig;

      assert.throws(
        () => validateRawConfig(config),
        /Config requires an 'id' field/
      );
    });

    test("throws when id is empty string", () => {
      const config = createValidConfig({ id: "" });

      assert.throws(
        () => validateRawConfig(config),
        /Config requires an 'id' field/
      );
    });

    test("throws when id is not a string", () => {
      const config = createValidConfig({ id: 123 as never });

      assert.throws(
        () => validateRawConfig(config),
        /Config requires an 'id' field/
      );
    });

    test("allows valid alphanumeric id", () => {
      const config = createValidConfig({ id: "myConfig123" });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows valid id with hyphens", () => {
      const config = createValidConfig({ id: "my-config-name" });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows valid id with underscores", () => {
      const config = createValidConfig({ id: "my_config_name" });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows valid id with mixed characters", () => {
      const config = createValidConfig({ id: "Team-A_config-2024" });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when id contains spaces", () => {
      const config = createValidConfig({ id: "my config" });

      assert.throws(
        () => validateRawConfig(config),
        /Config 'id' contains invalid characters/
      );
    });

    test("throws when id contains dots", () => {
      const config = createValidConfig({ id: "my.config" });

      assert.throws(
        () => validateRawConfig(config),
        /Config 'id' contains invalid characters/
      );
    });

    test("throws when id contains special characters", () => {
      const config = createValidConfig({ id: "my@config!" });

      assert.throws(
        () => validateRawConfig(config),
        /Config 'id' contains invalid characters/
      );
    });

    test("throws when id exceeds 64 characters", () => {
      const longId = "a".repeat(65);
      const config = createValidConfig({ id: longId });

      assert.throws(
        () => validateRawConfig(config),
        /Config 'id' exceeds maximum length of 64 characters/
      );
    });

    test("allows id at exactly 64 characters", () => {
      const maxId = "a".repeat(64);
      const config = createValidConfig({ id: maxId });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows single character id", () => {
      const config = createValidConfig({ id: "a" });
      assert.doesNotThrow(() => validateRawConfig(config));
    });
  });

  describe("files validation", () => {
    test("throws when files is missing and no settings", () => {
      const config = {
        id: "test-config",
        repos: [{ git: "git@github.com:org/repo.git" }],
      } as RawConfig;

      assert.throws(
        () => validateRawConfig(config),
        /Config requires at least one of: 'files' or 'settings'/
      );
    });

    test("throws when files is empty and no settings", () => {
      const config = {
        id: "test-config",
        files: {},
        repos: [{ git: "git@github.com:org/repo.git" }],
      } as RawConfig;

      assert.throws(
        () => validateRawConfig(config),
        /Config requires at least one of: 'files' or 'settings'/
      );
    });

    test("throws when file name contains path traversal (..)", () => {
      const config = createValidConfig({
        files: { "../config.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /Invalid fileName.*must be a relative path/
      );
    });

    test("throws when file name contains path traversal in middle", () => {
      const config = createValidConfig({
        files: { "path/../config.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /Invalid fileName.*must be a relative path/
      );
    });

    test("throws when file name is absolute path (Unix)", () => {
      const config = createValidConfig({
        files: { "/etc/config.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /Invalid fileName.*must be a relative path/
      );
    });

    test("throws when file name contains newline", () => {
      const config = createValidConfig({
        files: { "config\n.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /cannot contain newlines or null bytes/
      );
    });

    test("throws when file name contains carriage return", () => {
      const config = createValidConfig({
        files: { "config\r.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /cannot contain newlines or null bytes/
      );
    });

    test("throws when file name contains null byte", () => {
      const config = createValidConfig({
        files: { "config\0.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /cannot contain newlines or null bytes/
      );
    });

    test("allows valid file name with subdirectory", () => {
      const config = createValidConfig({
        files: { "subdir/config.json": { content: {} } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows valid file name with dots", () => {
      const config = createValidConfig({
        files: { "my.config.json": { content: {} } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when 'inherit' is used as a filename at root level", () => {
      const config = createValidConfig({
        files: {
          "inherit.json": { content: { key: "value" } },
          inherit: { content: "some text" },
        },
      });

      assert.throws(
        () => validateRawConfig(config),
        /'inherit' is a reserved key and cannot be used as a filename/
      );
    });
  });

  describe("per-file mergeStrategy validation", () => {
    test("allows undefined mergeStrategy", () => {
      const config = createValidConfig();
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows replace mergeStrategy", () => {
      const config = createValidConfig({
        files: { "config.json": { content: {}, mergeStrategy: "replace" } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows append mergeStrategy", () => {
      const config = createValidConfig({
        files: { "config.json": { content: {}, mergeStrategy: "append" } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows prepend mergeStrategy", () => {
      const config = createValidConfig({
        files: { "config.json": { content: {}, mergeStrategy: "prepend" } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws for invalid mergeStrategy", () => {
      const config = createValidConfig({
        files: {
          "config.json": { content: {}, mergeStrategy: "invalid" as never },
        },
      });

      assert.throws(
        () => validateRawConfig(config),
        /has invalid mergeStrategy: invalid/
      );
    });
  });

  describe("repos validation", () => {
    test("throws when repos is missing", () => {
      const config = {
        id: "test-config",
        files: { "config.json": { content: {} } },
      } as unknown as RawConfig;

      assert.throws(
        () => validateRawConfig(config),
        /Config missing required field: repos/
      );
    });

    test("throws when repos is not an array", () => {
      const config = createValidConfig();
      (config as unknown as Record<string, unknown>).repos = "not-an-array";

      assert.throws(
        () => validateRawConfig(config),
        /Config missing required field: repos \(must be an array\)/
      );
    });

    test("throws when repo is missing git field", () => {
      const config = createValidConfig({
        repos: [{} as never],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Repo at index 0 missing required field: git/
      );
    });

    test("throws when repo has empty git array", () => {
      const config = createValidConfig({
        repos: [{ git: [] }],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Repo at index 0 has empty git array/
      );
    });

    test("allows repo with git as string", () => {
      const config = createValidConfig({
        repos: [{ git: "git@github.com:org/repo.git" }],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows repo with git as array of strings", () => {
      const config = createValidConfig({
        repos: [
          {
            git: [
              "git@github.com:org/repo1.git",
              "git@github.com:org/repo2.git",
            ],
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });
  });

  describe("per-repo file override validation", () => {
    test("throws when repo references undefined file", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "nonexistent.json": { content: {} },
            },
          },
        ],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Repo at index 0 references undefined file 'nonexistent.json'/
      );
    });

    test("allows valid per-repo file overrides", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { content: { override: "value" } },
            },
          },
        ],
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when per-repo file override has true but no content", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { override: true },
            },
          },
        ],
      });

      assert.throws(
        () => validateRawConfig(config),
        /has override: true for file 'config.json' but no content defined/
      );
    });

    test("allows override with content", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { override: true, content: { key: "val" } },
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows false to exclude a file from a repo", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": false,
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when excluding undefined file", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "nonexistent.json": false,
            },
          },
        ],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Repo at index 0 references undefined file 'nonexistent.json'/
      );
    });
  });

  describe("createOnly validation", () => {
    test("allows createOnly: true at root file level", () => {
      const config = createValidConfig({
        files: { "config.json": { content: {}, createOnly: true } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows createOnly: false at root file level", () => {
      const config = createValidConfig({
        files: { "config.json": { content: {}, createOnly: false } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows undefined createOnly at root file level", () => {
      const config = createValidConfig({
        files: { "config.json": { content: {} } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when createOnly is not a boolean at root level", () => {
      const config = createValidConfig({
        files: {
          "config.json": { content: {}, createOnly: "yes" as never },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /createOnly must be a boolean/
      );
    });

    test("allows createOnly: true at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { createOnly: true } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows createOnly: false at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { createOnly: false } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when createOnly is not a boolean at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { createOnly: 123 as never } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /createOnly must be a boolean/
      );
    });

    test("allows createOnly with content and override", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": {
                createOnly: true,
                override: true,
                content: { key: "value" },
              },
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });
  });

  describe("header validation", () => {
    test("allows header as string", () => {
      const config = createValidConfig({
        files: { "config.yaml": { content: {}, header: "Comment line" } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows header as array of strings", () => {
      const config = createValidConfig({
        files: { "config.yaml": { content: {}, header: ["Line 1", "Line 2"] } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when header is not string or array", () => {
      const config = createValidConfig({
        files: { "config.yaml": { content: {}, header: 123 as never } },
      });
      assert.throws(
        () => validateRawConfig(config),
        /header must be a string or array of strings/
      );
    });

    test("throws when header array contains non-strings", () => {
      const config = createValidConfig({
        files: {
          "config.yaml": { content: {}, header: ["valid", 123] as never },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /header must be a string or array of strings/
      );
    });

    test("allows per-repo header override", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { header: "Repo-specific header" } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when per-repo header is invalid", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { header: { invalid: true } as never } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /header must be a string or array of strings/
      );
    });
  });

  describe("schemaUrl validation", () => {
    test("allows schemaUrl as string", () => {
      const config = createValidConfig({
        files: {
          "config.yaml": {
            content: {},
            schemaUrl: "https://example.com/schema.json",
          },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when schemaUrl is not a string", () => {
      const config = createValidConfig({
        files: { "config.yaml": { content: {}, schemaUrl: 123 as never } },
      });
      assert.throws(
        () => validateRawConfig(config),
        /schemaUrl must be a string/
      );
    });

    test("allows per-repo schemaUrl override", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { schemaUrl: "https://example.com/schema.json" },
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when per-repo schemaUrl is invalid", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { schemaUrl: ["invalid"] as never } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /schemaUrl must be a string/
      );
    });
  });

  describe("empty content validation", () => {
    test("allows undefined content for empty file", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".prettierignore": {},
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows empty file with header", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": { header: "Schema-only file" },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows empty file with schemaUrl", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": { schemaUrl: "https://example.com/schema.json" },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows empty file with createOnly", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".prettierignore": { createOnly: true },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });
  });

  describe("valid configurations", () => {
    test("accepts minimal valid config", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts multiple files in config", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "eslint.config.json": { content: { extends: ["base"] } },
          ".prettierrc.yaml": { content: { singleQuote: true } },
          "tsconfig.json": { content: { strict: true } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts full config with per-repo overrides", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "eslint.config.json": {
            content: { extends: ["base"] },
            mergeStrategy: "append",
          },
          ".prettierrc.yaml": { content: { singleQuote: true } },
        },
        repos: [
          { git: "git@github.com:org/repo1.git" },
          {
            git: [
              "git@github.com:org/repo2.git",
              "git@github.com:org/repo3.git",
            ],
            files: {
              "eslint.config.json": {
                content: { extends: ["react"] },
              },
            },
          },
          {
            git: "git@github.com:org/legacy.git",
            files: {
              "eslint.config.json": {
                override: true,
                content: { extends: ["legacy"] },
              },
            },
          },
        ],
      };

      assert.doesNotThrow(() => validateRawConfig(config));
    });
  });

  describe("text file content validation", () => {
    test("file named 'json' without extension is text file", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          json: { content: "some text content" }, // file named "json" with no extension
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts string content for text files", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": { content: "node_modules/\ndist/\n" },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts string array content for text files", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": { content: ["node_modules/", "dist/"] },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts text content with mergeStrategy", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": {
            content: ["node_modules/"],
            mergeStrategy: "append",
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts text content with createOnly", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".markdownlintignore": {
            content: "# Ignore claude files\n.claude/",
            createOnly: true,
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when JSON file has string content", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: "not valid json content" as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has JSON\/YAML extension but string content/
      );
    });

    test("throws when YAML file has string content", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": { content: "key: value" as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has JSON\/YAML extension but string content/
      );
    });

    test("throws when YML file has string array content", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "config.yml": { content: ["line1", "line2"] as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has JSON\/YAML extension but string content/
      );
    });

    test("accepts object content for .json5 files", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "config.json5": { content: { key: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when JSON5 file has string content", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "config.json5": { content: "string content" as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has JSON\/YAML extension but string content/
      );
    });

    test("throws when text file has object content", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": { content: { key: "value" } as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has text extension but object content/
      );
    });

    test("throws when .env file has object content", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".env.example": { content: { KEY: "value" } as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has text extension but object content/
      );
    });

    test("throws when array has non-string elements", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": { content: ["valid", 123, "also valid"] as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /content must be an object, string, or array of strings/
      );
    });

    test("throws when per-repo JSON file override has string content", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { content: "string content" as never },
            },
          },
        ],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has JSON\/YAML extension but string content/
      );
    });

    test("throws when per-repo text file override has object content", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": { content: "node_modules/" },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": { content: { invalid: true } as never },
            },
          },
        ],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has text extension but object content/
      );
    });

    test("accepts per-repo text file override with string array", () => {
      const config: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": { content: ["node_modules/"], mergeStrategy: "append" },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": { content: ["dist/"] },
            },
          },
        ],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });
  });

  describe("githubHosts validation", () => {
    test("accepts valid githubHosts array", () => {
      const config = createValidConfig({
        githubHosts: ["github.mycompany.com", "ghe.internal.net"],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts empty githubHosts array", () => {
      const config = createValidConfig({
        githubHosts: [],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts undefined githubHosts", () => {
      const config = createValidConfig();
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when githubHosts is not an array", () => {
      const config = createValidConfig({
        githubHosts: "github.mycompany.com" as never,
      });
      assert.throws(
        () => validateRawConfig(config),
        /githubHosts must be an array of strings/
      );
    });

    test("throws when githubHosts contains non-strings", () => {
      const config = createValidConfig({
        githubHosts: ["valid.com", 123] as never,
      });
      assert.throws(
        () => validateRawConfig(config),
        /githubHosts must be an array of strings/
      );
    });

    test("throws when githubHosts contains empty string", () => {
      const config = createValidConfig({
        githubHosts: ["github.mycompany.com", ""],
      });
      assert.throws(
        () => validateRawConfig(config),
        /githubHosts entries must be non-empty hostnames/
      );
    });

    test("throws when githubHosts contains URL instead of hostname", () => {
      const config = createValidConfig({
        githubHosts: ["https://github.mycompany.com"],
      });
      assert.throws(
        () => validateRawConfig(config),
        /githubHosts entries must be hostnames only, not URLs/
      );
    });

    test("throws when githubHosts contains path", () => {
      const config = createValidConfig({
        githubHosts: ["github.mycompany.com/path"],
      });
      assert.throws(
        () => validateRawConfig(config),
        /githubHosts entries must be hostnames only/
      );
    });
  });

  describe("executable validation", () => {
    test("allows executable: true at root file level", () => {
      const config = createValidConfig({
        files: { "deploy.sh": { content: "#!/bin/bash", executable: true } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows executable: false at root file level", () => {
      const config = createValidConfig({
        files: { "script.sh": { content: "#!/bin/bash", executable: false } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows undefined executable at root file level", () => {
      const config = createValidConfig({
        files: { "script.sh": { content: "#!/bin/bash" } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when executable is not a boolean at root level", () => {
      const config = createValidConfig({
        files: {
          "script.sh": { content: "#!/bin/bash", executable: "yes" as never },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /executable must be a boolean/
      );
    });

    test("allows executable: true at per-repo level", () => {
      const config = createValidConfig({
        files: { run: { content: "#!/bin/bash" } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { run: { executable: true } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows executable: false at per-repo level", () => {
      const config = createValidConfig({
        files: { "script.sh": { content: "#!/bin/bash" } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "script.sh": { executable: false } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when executable is not a boolean at per-repo level", () => {
      const config = createValidConfig({
        files: { "script.sh": { content: "#!/bin/bash" } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "script.sh": { executable: 123 as never } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /executable must be a boolean/
      );
    });
  });

  describe("template validation", () => {
    test("allows template: true at root file level", () => {
      const config = createValidConfig({
        files: {
          "README.md": { content: "# ${xfg:repo.name}", template: true },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows template: false at root file level", () => {
      const config = createValidConfig({
        files: { "config.json": { content: {}, template: false } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows undefined template at root file level", () => {
      const config = createValidConfig({
        files: { "config.json": { content: {} } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when template is not a boolean at root level", () => {
      const config = createValidConfig({
        files: {
          "config.json": { content: {}, template: "yes" as never },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /template must be a boolean/
      );
    });

    test("allows template: true at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { template: true } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows template: false at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { template: false } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when template is not a boolean at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { template: 123 as never } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /template must be a boolean/
      );
    });
  });

  describe("vars validation", () => {
    test("allows valid vars object at root file level", () => {
      const config = createValidConfig({
        files: {
          "config.json": {
            content: {},
            template: true,
            vars: { env: "prod", region: "us-east-1" },
          },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows undefined vars at root file level", () => {
      const config = createValidConfig({
        files: { "config.json": { content: {}, template: true } },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows empty vars object at root file level", () => {
      const config = createValidConfig({
        files: {
          "config.json": { content: {}, template: true, vars: {} },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when vars is not an object at root level", () => {
      const config = createValidConfig({
        files: {
          "config.json": { content: {}, vars: "invalid" as never },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /vars must be an object with string values/
      );
    });

    test("throws when vars is an array at root level", () => {
      const config = createValidConfig({
        files: {
          "config.json": { content: {}, vars: ["a", "b"] as never },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /vars must be an object with string values/
      );
    });

    test("throws when vars contains non-string value at root level", () => {
      const config = createValidConfig({
        files: {
          "config.json": {
            content: {},
            vars: { env: "prod", count: 123 } as never,
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /vars\.count must be a string/
      );
    });

    test("allows valid vars object at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { vars: { env: "staging" } },
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when vars is not an object at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { vars: null as never } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /vars must be an object with string values/
      );
    });

    test("throws when vars contains non-string value at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { vars: { flag: true } as never },
            },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /vars\.flag must be a string/
      );
    });
  });

  describe("deleteOrphaned validation", () => {
    test("allows deleteOrphaned: true at global level", () => {
      const config = createValidConfig({
        deleteOrphaned: true,
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows deleteOrphaned: false at global level", () => {
      const config = createValidConfig({
        deleteOrphaned: false,
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows undefined deleteOrphaned at global level", () => {
      const config = createValidConfig();
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when deleteOrphaned is not a boolean at global level", () => {
      const config = createValidConfig({
        deleteOrphaned: "yes" as never,
      });
      assert.throws(
        () => validateRawConfig(config),
        /Global deleteOrphaned must be a boolean/
      );
    });

    test("allows deleteOrphaned: true at root file level", () => {
      const config = createValidConfig({
        files: {
          "config.json": { content: { key: "value" }, deleteOrphaned: true },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows deleteOrphaned: false at root file level", () => {
      const config = createValidConfig({
        files: {
          "config.json": { content: { key: "value" }, deleteOrphaned: false },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows undefined deleteOrphaned at root file level", () => {
      const config = createValidConfig({
        files: {
          "config.json": { content: { key: "value" } },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when deleteOrphaned is not a boolean at root file level", () => {
      const config = createValidConfig({
        files: {
          "config.json": {
            content: { key: "value" },
            deleteOrphaned: 1 as never,
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /deleteOrphaned must be a boolean/
      );
    });

    test("allows deleteOrphaned: true at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { deleteOrphaned: true } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows deleteOrphaned: false at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { deleteOrphaned: false } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when deleteOrphaned is not a boolean at per-repo level", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: { "config.json": { deleteOrphaned: "true" as never } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /deleteOrphaned must be a boolean/
      );
    });
  });

  describe("settings.rulesets validation", () => {
    test("throws when 'inherit' is used as a ruleset name at root level", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            inherit: { target: "branch" },
          },
        },
      });

      assert.throws(
        () => validateRawConfig(config),
        /'inherit' is a reserved key and cannot be used as a ruleset name/
      );
    });

    test("throws when opting out of non-existent ruleset", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": { target: "branch" },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "nonexistent-ruleset": false,
              },
            },
          },
        ],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Cannot opt out of 'nonexistent-ruleset' - not defined in root settings\.rulesets/
      );
    });

    test("allows opting out of existing ruleset with false", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": { target: "branch" },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "main-protection": false,
              },
            },
          },
        ],
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows inherit: false in repo files", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              inherit: false,
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows inherit: true in repo files", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              inherit: true,
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows inherit: false in repo rulesets", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": { target: "branch" },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                inherit: false,
              },
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when files.inherit is not a boolean", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              inherit: "false" as unknown as boolean,
            },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /files\.inherit must be a boolean/
      );
    });

    test("allows valid root-level settings with rulesets", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              enforcement: "active",
              conditions: {
                refName: {
                  include: ["refs/heads/main"],
                },
              },
              rules: [
                {
                  type: "pull_request",
                  parameters: {
                    requiredApprovingReviewCount: 1,
                  },
                },
              ],
            },
          },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows valid per-repo settings with rulesets", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  target: "branch",
                  enforcement: "active",
                },
              },
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when settings is not an object", () => {
      const config = createValidConfig({
        settings: "invalid" as never,
      });
      assert.throws(
        () => validateRawConfig(config),
        /settings must be an object/
      );
    });

    test("throws when rulesets is not an object", () => {
      const config = createValidConfig({
        settings: {
          rulesets: "invalid" as never,
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /rulesets must be an object/
      );
    });

    test("throws when ruleset target is invalid", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              target: "invalid" as never,
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /target must be one of: branch, tag/
      );
    });

    test("throws when ruleset enforcement is invalid", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              enforcement: "invalid" as never,
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /enforcement must be one of: active, disabled, evaluate/
      );
    });

    test("throws when bypassActors is not an array", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: "invalid" as never,
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /bypassActors must be an array/
      );
    });

    test("throws when bypassActor actorId is not a number", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: [{ actorId: "123" as never, actorType: "Team" }],
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /actorId must be a number/
      );
    });

    test("throws when bypassActor actorType is invalid", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: [{ actorId: 123, actorType: "Invalid" as never }],
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /actorType must be one of: Team, User, Integration/
      );
    });

    test("throws when bypassActor bypassMode is invalid", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: [
                {
                  actorId: 123,
                  actorType: "Team",
                  bypassMode: "invalid" as never,
                },
              ],
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /bypassMode must be one of: always, pull_request/
      );
    });

    test("allows valid bypassActors", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: [
                { actorId: 123, actorType: "Team", bypassMode: "always" },
                {
                  actorId: 456,
                  actorType: "Integration",
                  bypassMode: "pull_request",
                },
                { actorId: 789, actorType: "User" },
              ],
            },
          },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when conditions is not an object", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              conditions: "invalid" as never,
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /conditions must be an object/
      );
    });

    test("throws when conditions.refName.include is not an array of strings", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              conditions: {
                refName: {
                  include: [123] as never,
                },
              },
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /include must be an array of strings/
      );
    });

    test("throws when conditions.refName.exclude is not an array of strings", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              conditions: {
                refName: {
                  exclude: "not-array" as never,
                },
              },
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /exclude must be an array of strings/
      );
    });

    test("throws when rules is not an array", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: "invalid" as never,
            },
          },
        },
      });
      assert.throws(() => validateRawConfig(config), /rules must be an array/);
    });

    test("throws when rule type is missing", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [{ parameters: {} }] as never,
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /rule must have a 'type' string field/
      );
    });

    test("throws when rule type is invalid", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [{ type: "invalid_type" }] as never,
            },
          },
        },
      });
      assert.throws(() => validateRawConfig(config), /invalid rule type/);
    });

    test("allows all valid rule types", () => {
      const validRuleTypes = [
        "pull_request",
        "required_status_checks",
        "required_signatures",
        "required_linear_history",
        "non_fast_forward",
        "creation",
        "update",
        "deletion",
        "required_deployments",
        "code_scanning",
        "code_quality",
        "workflows",
        "commit_author_email_pattern",
        "commit_message_pattern",
        "committer_email_pattern",
        "branch_name_pattern",
        "tag_name_pattern",
        "file_path_restriction",
        "file_extension_restriction",
        "max_file_path_length",
        "max_file_size",
      ];

      for (const ruleType of validRuleTypes) {
        const config = createValidConfig({
          settings: {
            rulesets: {
              "test-rules": {
                rules: [{ type: ruleType }] as never,
              },
            },
          },
        });
        assert.doesNotThrow(
          () => validateRawConfig(config),
          `Rule type ${ruleType} should be valid`
        );
      }
    });

    test("throws when pull_request requiredApprovingReviewCount is invalid", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [
                {
                  type: "pull_request",
                  parameters: {
                    requiredApprovingReviewCount: 11, // Max is 10
                  },
                },
              ],
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /requiredApprovingReviewCount must be an integer between 0 and 10/
      );
    });

    test("throws when pull_request allowedMergeMethods contains invalid value", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [
                {
                  type: "pull_request",
                  parameters: {
                    allowedMergeMethods: ["invalid"] as never,
                  },
                },
              ],
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /allowedMergeMethods values must be one of: merge, squash, rebase/
      );
    });

    test("allows valid pull_request parameters", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [
                {
                  type: "pull_request",
                  parameters: {
                    requiredApprovingReviewCount: 2,
                    dismissStaleReviewsOnPush: true,
                    requireCodeOwnerReview: true,
                    requireLastPushApproval: true,
                    requiredReviewThreadResolution: true,
                    allowedMergeMethods: ["squash", "rebase"],
                  },
                },
              ],
            },
          },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when pattern rule has invalid operator", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [
                {
                  type: "commit_message_pattern",
                  parameters: {
                    operator: "invalid" as never,
                    pattern: ".*",
                  },
                },
              ],
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /pattern rule operator must be one of/
      );
    });

    test("allows valid pattern rule", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [
                {
                  type: "commit_message_pattern",
                  parameters: {
                    operator: "regex",
                    pattern: "^(feat|fix|docs):",
                    negate: false,
                  },
                },
              ],
            },
          },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when code_scanning has invalid alertsThreshold", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [
                {
                  type: "code_scanning",
                  parameters: {
                    codeScanningTools: [
                      {
                        tool: "CodeQL",
                        alertsThreshold: "invalid" as never,
                        securityAlertsThreshold: "high_or_higher",
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /alertsThreshold must be one of/
      );
    });

    test("throws when code_scanning has invalid securityAlertsThreshold", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [
                {
                  type: "code_scanning",
                  parameters: {
                    codeScanningTools: [
                      {
                        tool: "CodeQL",
                        alertsThreshold: "errors",
                        securityAlertsThreshold: "invalid" as never,
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /securityAlertsThreshold must be one of/
      );
    });

    test("allows valid code_scanning rule", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [
                {
                  type: "code_scanning",
                  parameters: {
                    codeScanningTools: [
                      {
                        tool: "CodeQL",
                        alertsThreshold: "errors",
                        securityAlertsThreshold: "high_or_higher",
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when settings.deleteOrphaned is not a boolean", () => {
      const config = createValidConfig({
        settings: {
          deleteOrphaned: "yes" as never,
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /deleteOrphaned must be a boolean/
      );
    });

    test("allows settings.deleteOrphaned as boolean", () => {
      const config = createValidConfig({
        settings: {
          deleteOrphaned: true,
        },
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("validates per-repo settings", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  target: "invalid" as never,
                },
              },
            },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /target must be one of: branch, tag/
      );
    });

    test("throws when bypassActors contains primitive instead of object", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              bypassActors: ["not-an-object" as never],
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /bypassActors\[0\] must be an object/
      );
    });

    test("throws when conditions.refName is not an object", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              conditions: {
                refName: "not-an-object" as never,
              },
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /conditions\.refName must be an object/
      );
    });

    test("throws when conditions.refName.exclude contains non-strings", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "pr-rules": {
              conditions: {
                refName: {
                  exclude: [123 as never],
                },
              },
            },
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /conditions\.refName\.exclude must be an array of strings/
      );
    });
  });

  describe("files/settings decoupling", () => {
    test("accepts config with only settings (no files)", () => {
      const config: RawConfig = {
        id: "settings-only",
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when config has neither files nor settings", () => {
      const config = {
        id: "empty-config",
        repos: [{ git: "git@github.com:org/repo.git" }],
      } as RawConfig;

      assert.throws(
        () => validateRawConfig(config),
        /Config requires at least one of: 'files' or 'settings'/
      );
    });

    test("accepts config with only files (no settings)", () => {
      const config: RawConfig = {
        id: "files-only",
        files: {
          "config.json": { content: { key: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts config with both files and settings", () => {
      const config: RawConfig = {
        id: "full-config",
        files: {
          "config.json": { content: { key: "value" } },
        },
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("validates files structure when files is present", () => {
      const config: RawConfig = {
        id: "bad-files",
        files: {
          "../escape.json": { content: {} }, // Invalid path
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      assert.throws(
        () => validateRawConfig(config),
        /Invalid fileName.*must be a relative path/
      );
    });

    test("skips files validation when files is absent", () => {
      const config: RawConfig = {
        id: "settings-only",
        settings: {
          rulesets: {
            "main-protection": { target: "branch" },
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      // Should not throw about files
      assert.doesNotThrow(() => validateRawConfig(config));
    });
  });
});

describe("validateForSync", () => {
  test("throws when files is missing", () => {
    const config: RawConfig = {
      id: "settings-only",
      settings: {
        rulesets: {
          "main-protection": { target: "branch" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSync(config),
      /The 'sync' command requires a 'files' section/
    );
  });

  test("throws when files is empty", () => {
    const config: RawConfig = {
      id: "empty-files",
      files: {},
      settings: {
        rulesets: {
          "main-protection": { target: "branch" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSync(config),
      /The 'sync' command requires a 'files' section with at least one file/
    );
  });

  test("passes when files has entries", () => {
    const config: RawConfig = {
      id: "has-files",
      files: {
        "config.json": { content: {} },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.doesNotThrow(() => validateForSync(config));
  });
});

describe("validateForSettings", () => {
  test("throws when no settings anywhere", () => {
    const config: RawConfig = {
      id: "files-only",
      files: {
        "config.json": { content: {} },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSettings(config),
      /The 'settings' command requires a 'settings' section/
    );
  });

  test("passes when settings at root level", () => {
    const config: RawConfig = {
      id: "root-settings",
      files: {
        "config.json": { content: {} },
      },
      settings: {
        rulesets: {
          "main-protection": { target: "branch" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.doesNotThrow(() => validateForSettings(config));
  });

  test("passes when settings only in repo", () => {
    const config: RawConfig = {
      id: "repo-settings",
      files: {
        "config.json": { content: {} },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          settings: {
            rulesets: {
              "main-protection": { target: "branch" },
            },
          },
        },
      ],
    };

    assert.doesNotThrow(() => validateForSettings(config));
  });

  test("throws when settings exists but has no actionable config", () => {
    const config: RawConfig = {
      id: "empty-settings",
      settings: {},
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSettings(config),
      /No actionable settings configured/
    );
  });

  test("throws when settings has empty rulesets", () => {
    const config: RawConfig = {
      id: "empty-rulesets",
      settings: {
        rulesets: {},
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSettings(config),
      /No actionable settings configured/
    );
  });
});

describe("hasActionableSettings", () => {
  test("returns false for undefined", () => {
    assert.equal(hasActionableSettings(undefined), false);
  });

  test("returns false for empty object", () => {
    assert.equal(hasActionableSettings({}), false);
  });

  test("returns false for empty rulesets", () => {
    assert.equal(hasActionableSettings({ rulesets: {} }), false);
  });

  test("returns true when rulesets has entries", () => {
    assert.equal(
      hasActionableSettings({
        rulesets: {
          "main-protection": { target: "branch" },
        },
      }),
      true
    );
  });

  test("returns false for deleteOrphaned only", () => {
    assert.equal(hasActionableSettings({ deleteOrphaned: true }), false);
  });

  test("returns true when repo settings exist", () => {
    assert.equal(
      hasActionableSettings({
        repo: {
          hasIssues: true,
        },
      }),
      true
    );
  });

  test("returns true when both rulesets and repo exist", () => {
    assert.equal(
      hasActionableSettings({
        rulesets: { "main-protection": { enforcement: "active" } },
        repo: { hasIssues: true },
      }),
      true
    );
  });

  test("returns false for empty repo settings", () => {
    assert.equal(hasActionableSettings({ repo: {} }), false);
  });
});

describe("validateRepoSettings", () => {
  // Helper to create a minimal valid config with settings
  const createSettingsConfig = (
    repo: Record<string, unknown>
  ): import("../../src/config.js").RawConfig => ({
    id: "test-config",
    settings: {
      repo: repo as import("../../src/config.js").GitHubRepoSettings,
    },
    repos: [{ git: "git@github.com:org/repo.git" }],
  });

  test("rejects invalid visibility value", () => {
    const config = createSettingsConfig({
      visibility: "secret",
    });
    assert.throws(
      () => validateRawConfig(config),
      /visibility must be one of: public, private, internal/
    );
  });

  test("rejects invalid squashMergeCommitTitle value", () => {
    const config = createSettingsConfig({
      squashMergeCommitTitle: "INVALID",
    });
    assert.throws(
      () => validateRawConfig(config),
      /squashMergeCommitTitle must be one of: PR_TITLE, COMMIT_OR_PR_TITLE/
    );
  });

  test("rejects invalid squashMergeCommitMessage value", () => {
    const config = createSettingsConfig({
      squashMergeCommitMessage: "INVALID",
    });
    assert.throws(
      () => validateRawConfig(config),
      /squashMergeCommitMessage must be one of: PR_BODY, COMMIT_MESSAGES, BLANK/
    );
  });

  test("rejects invalid mergeCommitTitle value", () => {
    const config = createSettingsConfig({
      mergeCommitTitle: "INVALID",
    });
    assert.throws(
      () => validateRawConfig(config),
      /mergeCommitTitle must be one of: PR_TITLE, MERGE_MESSAGE/
    );
  });

  test("rejects invalid mergeCommitMessage value", () => {
    const config = createSettingsConfig({
      mergeCommitMessage: "INVALID",
    });
    assert.throws(
      () => validateRawConfig(config),
      /mergeCommitMessage must be one of: PR_BODY, PR_TITLE, BLANK/
    );
  });

  test("rejects non-boolean hasIssues", () => {
    const config = createSettingsConfig({
      hasIssues: "yes",
    });
    assert.throws(
      () => validateRawConfig(config),
      /hasIssues must be a boolean/
    );
  });

  test("rejects non-boolean allowSquashMerge", () => {
    const config = createSettingsConfig({
      allowSquashMerge: 1,
    });
    assert.throws(
      () => validateRawConfig(config),
      /allowSquashMerge must be a boolean/
    );
  });

  test("rejects non-boolean secretScanning", () => {
    const config = createSettingsConfig({
      secretScanning: "enabled",
    });
    assert.throws(
      () => validateRawConfig(config),
      /secretScanning must be a boolean/
    );
  });

  test("accepts valid repo settings", () => {
    const config = createSettingsConfig({
      hasIssues: true,
      visibility: "private",
      allowSquashMerge: true,
      squashMergeCommitTitle: "PR_TITLE",
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts all valid feature settings", () => {
    const config = createSettingsConfig({
      hasIssues: true,
      hasProjects: false,
      hasWiki: true,
      hasDiscussions: false,
      isTemplate: false,
      allowForking: true,
      visibility: "public",
      archived: false,
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts all valid merge settings", () => {
    const config = createSettingsConfig({
      allowSquashMerge: true,
      allowMergeCommit: false,
      allowRebaseMerge: true,
      allowAutoMerge: true,
      deleteBranchOnMerge: true,
      allowUpdateBranch: true,
      squashMergeCommitTitle: "COMMIT_OR_PR_TITLE",
      squashMergeCommitMessage: "COMMIT_MESSAGES",
      mergeCommitTitle: "MERGE_MESSAGE",
      mergeCommitMessage: "PR_BODY",
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts all valid security settings", () => {
    const config = createSettingsConfig({
      vulnerabilityAlerts: true,
      automatedSecurityFixes: true,
      secretScanning: true,
      secretScanningPushProtection: true,
      privateVulnerabilityReporting: true,
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts internal visibility", () => {
    const config = createSettingsConfig({
      visibility: "internal",
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("rejects non-boolean webCommitSignoffRequired", () => {
    const config = createSettingsConfig({
      webCommitSignoffRequired: "yes",
    });
    assert.throws(
      () => validateRawConfig(config),
      /webCommitSignoffRequired must be a boolean/
    );
  });

  test("accepts valid webCommitSignoffRequired", () => {
    const config = createSettingsConfig({
      webCommitSignoffRequired: true,
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("rejects non-string defaultBranch", () => {
    const config = createSettingsConfig({
      defaultBranch: 123,
    });
    assert.throws(
      () => validateRawConfig(config),
      /defaultBranch must be a string/
    );
  });

  test("accepts valid defaultBranch", () => {
    const config = createSettingsConfig({
      defaultBranch: "develop",
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("rejects repo settings that is not an object", () => {
    const config: import("../../src/config.js").RawConfig = {
      id: "test-config",
      settings: {
        repo: "invalid" as never,
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(() => validateRawConfig(config), /repo must be an object/);
  });
});
