import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  validateRawConfig,
  validateForSync,
  hasActionableSettings,
  validateSecretsConfig,
  validateVariableSecretOverlaps,
} from "../../../src/config/validator.js";
import { ValidationError } from "../../../src/shared/errors.js";
import type {
  RawConfig,
  RawConditionalGroupConfig,
  RawFileConfig,
  RawRepoConfig,
  RawRepoSettings,
  SecretConfig,
} from "../../../src/config/index.js";

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
    test("throws ValidationError (not bare Error) on invalid config", () => {
      const config = {
        files: { "config.json": { content: {} } },
        repos: [{ git: "git@github.com:org/repo.git" }],
      } as unknown as RawConfig;

      assert.throws(
        () => validateRawConfig(config),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError, "Expected ValidationError");
          assert.ok(err instanceof Error, "ValidationError extends Error");
          assert.equal(err.name, "ValidationError");
          return true;
        }
      );
    });

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
        /Config requires at least one of:/
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
        /Config requires at least one of:/
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
    test("throws when repo references undefined file without content", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "nonexistent.json": { createOnly: true },
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

    test("allows standalone per-repo file with content not in root or groups", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".github/renovate-overrides.json5": {
                content: { extends: ["config:base"] },
              },
            },
          },
        ],
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows standalone per-repo text file with string content", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "custom-script.sh": { content: "#!/bin/bash\necho hello" },
            },
          },
        ],
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("rejects standalone per-repo file without content", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "unknown.json": { executable: true },
            },
          },
        ],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Repo at index 0 references undefined file 'unknown.json'/
      );
    });

    test("rejects standalone per-repo file with path traversal", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "../../../etc/passwd": { content: "malicious" },
            },
          },
        ],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Invalid fileName '..\/..\/..\/etc\/passwd'/
      );
    });

    test("rejects standalone per-repo file with content: null", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "empty.json": { content: null as unknown as string },
            },
          },
        ],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Repo at index 0 references undefined file 'empty.json'/
      );
    });

    test("allows standalone per-repo file with empty string content", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "empty.sh": { content: "" },
            },
          },
        ],
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows standalone per-repo file with empty object content", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "defaults.json": { content: {} },
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

    test("throws when 'inherit: false' is used at root rulesets level", () => {
      const config: RawConfig = {
        id: "test-config",
        settings: {
          rulesets: {
            inherit: false as never,
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      assert.throws(
        () => validateRawConfig(config),
        /'inherit' is a reserved key and cannot be used as a ruleset name/
      );
    });

    test("throws when 'inherit: true' is used at root rulesets level", () => {
      const config: RawConfig = {
        id: "test-config",
        settings: {
          rulesets: {
            inherit: true as never,
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

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

    test("allows opting out of a ruleset defined in a referenced group", () => {
      const config = createValidConfig({
        groups: {
          mygroup: {
            settings: {
              rulesets: {
                "group-ruleset": { target: "branch" },
              },
            },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["mygroup"],
            settings: {
              rulesets: {
                "group-ruleset": false,
              },
            },
          },
        ],
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows opting out of a label defined in a referenced group", () => {
      const config = createValidConfig({
        groups: {
          mygroup: {
            settings: {
              labels: {
                "group-label": { color: "d73a4a" },
              },
            },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["mygroup"],
            settings: {
              labels: {
                "group-label": false,
              },
            },
          },
        ],
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when root settings has repo: false", () => {
      const config = createValidConfig({
        settings: {
          repo: false as never,
        },
        files: undefined,
      });

      assert.throws(
        () => validateRawConfig(config),
        /repo: false is not valid at root level/
      );
    });

    test("throws when per-repo repo: false but no root repo settings defined", () => {
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
              repo: false as never,
            },
          },
        ],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Cannot opt out of repo settings .* not defined in root settings/
      );
    });

    test("allows per-repo repo: false when root repo settings exist", () => {
      const config = createValidConfig({
        settings: {
          repo: {
            hasIssues: true,
            hasWiki: true,
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              repo: false as never,
            },
          },
        ],
        files: undefined,
      });

      assert.doesNotThrow(() => validateRawConfig(config));
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
            } as RawRepoConfig["files"],
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
              } as RawRepoSettings["rulesets"],
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
            } as RawRepoConfig["files"],
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

    test("accepts $arrayMerge directive on bypassActors", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              bypassActors: {
                $arrayMerge: "append",
                $values: [
                  {
                    actorId: 123,
                    actorType: "Integration",
                    bypassMode: "always",
                  },
                ],
              } as never,
            },
          },
        },
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts $arrayMerge directive on rules array", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              rules: {
                $arrayMerge: "append",
                $values: [{ type: "required_signatures" }],
              } as never,
            },
          },
        },
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts $arrayMerge directive on conditions.refName.include", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              conditions: {
                refName: {
                  include: {
                    $arrayMerge: "append",
                    $values: ["refs/heads/develop"],
                  } as never,
                },
              },
            },
          },
        },
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts $arrayMerge directive on conditions.refName.exclude", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              conditions: {
                refName: {
                  exclude: {
                    $arrayMerge: "prepend",
                    $values: ["refs/heads/temp/*"],
                  } as never,
                },
              },
            },
          },
        },
      });

      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("rejects invalid $arrayMerge strategy in bypassActors", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              bypassActors: {
                $arrayMerge: "invalid",
                $values: [{ actorId: 1, actorType: "User" }],
              } as never,
            },
          },
        },
      });

      assert.throws(
        () => validateRawConfig(config),
        /bypassActors must be an array or \$arrayMerge directive/
      );
    });

    test("rejects rules with invalid $arrayMerge strategy", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              rules: {
                $arrayMerge: "invalid",
                $values: [{ type: "required_signatures" }],
              } as never,
            },
          },
        },
      });

      assert.throws(
        () => validateRawConfig(config),
        /rules must be an array or \$arrayMerge directive/
      );
    });

    test("rejects rules with invalid $values items (rule without type field)", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              rules: {
                $arrayMerge: "append",
                $values: [{ parameters: {} }],
              } as never,
            },
          },
        },
      });

      assert.throws(
        () => validateRawConfig(config),
        /rule must have a 'type' string field/
      );
    });

    test("rejects conditions.refName.include with non-string $values items", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              conditions: {
                refName: {
                  include: {
                    $arrayMerge: "append",
                    $values: [123],
                  } as never,
                },
              },
            },
          },
        },
      });

      assert.throws(
        () => validateRawConfig(config),
        /include must be an array of strings or \$arrayMerge directive with string \$values/
      );
    });

    test("rejects conditions.refName.exclude with non-string $values items", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              conditions: {
                refName: {
                  exclude: {
                    $arrayMerge: "prepend",
                    $values: [456],
                  } as never,
                },
              },
            },
          },
        },
      });

      assert.throws(
        () => validateRawConfig(config),
        /exclude must be an array of strings or \$arrayMerge directive with string \$values/
      );
    });

    test("rejects $arrayMerge directive with extra properties in bypassActors", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              bypassActors: {
                $arrayMerge: "append",
                $values: [{ actorId: 1, actorType: "User" }],
                extra: "key",
              } as never,
            },
          },
        },
      });

      assert.throws(
        () => validateRawConfig(config),
        /bypassActors must be an array or \$arrayMerge directive/
      );
    });

    test("rejects $arrayMerge directive with invalid $values items in bypassActors", () => {
      const config = createValidConfig({
        settings: {
          rulesets: {
            "main-protection": {
              target: "branch",
              bypassActors: {
                $arrayMerge: "append",
                $values: [{ actorId: "not-a-number", actorType: "User" }],
              } as never,
            },
          },
        },
      });

      assert.throws(
        () => validateRawConfig(config),
        /actorId must be a number/
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
        /Config requires at least one of:/
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

  describe("group validation", () => {
    const createValidConfig = (overrides?: Partial<RawConfig>): RawConfig => ({
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
      ...overrides,
    });

    test("valid group config passes", () => {
      const config = createValidConfig({
        groups: {
          mygroup: {
            files: { "extra.json": { content: { key: "value" } } },
          },
        },
        repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws for unknown group reference", () => {
      const config = createValidConfig({
        groups: {
          mygroup: { files: {} },
        },
        repos: [
          { git: "git@github.com:org/repo.git", groups: ["nonexistent"] },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /group 'nonexistent' is not defined/
      );
    });

    test("throws for duplicate group in repo list", () => {
      const config = createValidConfig({
        groups: {
          mygroup: { files: {} },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["mygroup", "mygroup"],
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /duplicate group 'mygroup'/
      );
    });

    test("throws for reserved group name 'inherit'", () => {
      const config = createValidConfig({
        groups: {
          inherit: { files: {} },
        },
      });
      assert.throws(() => validateRawConfig(config), /reserved/i);
    });

    test("throws when groups is not an object", () => {
      const config = createValidConfig({
        groups: ["not-an-object"] as unknown as RawConfig["groups"],
      });
      assert.throws(
        () => validateRawConfig(config),
        /groups must be an object/
      );
    });

    test("throws when repo groups is not an array of strings", () => {
      const config = createValidConfig({
        groups: { mygroup: { files: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: [123],
          } as unknown as RawConfig["repos"][number],
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /groups must be an array of strings/
      );
    });

    test("validates group file configs", () => {
      const config = createValidConfig({
        groups: {
          mygroup: {
            files: {
              "config.json": { content: 123 } as unknown as RawFileConfig,
            },
          },
        },
      });
      assert.throws(() => validateRawConfig(config), /content must be/);
    });

    test("validates group settings", () => {
      const config = createValidConfig({
        groups: {
          mygroup: {
            settings: {
              rulesets: "not-an-object",
            } as unknown as RawRepoSettings,
          },
        },
      });
      assert.throws(
        () => validateRawConfig(config),
        /rulesets must be an object/
      );
    });

    test("repo can reference file defined only in group", () => {
      const config = createValidConfig({
        groups: {
          mygroup: {
            files: { "group-only.json": { content: { key: "value" } } },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["mygroup"],
            files: {
              "group-only.json": { content: { override: true } },
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });
  });

  describe("conditional group validation", () => {
    test("valid conditional group passes", () => {
      const config = createValidConfig({
        groups: {
          terraform: { files: { "main.tf": { content: "# tf" } } },
          renovate: { files: { "renovate.json": { content: {} } } },
        },
        conditionalGroups: [
          {
            when: { allOf: ["terraform", "renovate"] },
            settings: {
              labels: {
                "infra-deps": { color: "00ff00" },
              },
            },
          },
        ],
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["terraform", "renovate"],
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when conditionalGroups is not an array", () => {
      const config = createValidConfig({
        conditionalGroups:
          "not-array" as unknown as RawConditionalGroupConfig[],
      });
      assert.throws(
        () => validateRawConfig(config),
        /conditionalGroups must be an array/
      );
    });

    test("throws when when clause is missing", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            settings: { labels: { x: { color: "aabbcc" } } },
          } as unknown as RawConditionalGroupConfig,
        ],
      });
      assert.throws(() => validateRawConfig(config), /when.*required/i);
    });

    test("throws when when clause has neither allOf nor anyOf", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: {},
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /at least one of.*allOf.*anyOf.*noneOf/i
      );
    });

    test("throws when allOf is empty array", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: [] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(() => validateRawConfig(config), /allOf.*non-empty/i);
    });

    test("throws when anyOf is empty array", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { anyOf: [] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(() => validateRawConfig(config), /anyOf.*non-empty/i);
    });

    test("throws for non-existent group in allOf", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: ["nonexistent"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /nonexistent.*not defined/i
      );
    });

    test("throws for non-existent group in anyOf", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { anyOf: ["nonexistent"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /nonexistent.*not defined/i
      );
    });

    test("throws for duplicate group in allOf", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: ["a", "a"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(() => validateRawConfig(config), /duplicate.*allOf/i);
    });

    test("throws for duplicate group in anyOf", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { anyOf: ["a", "a"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(() => validateRawConfig(config), /duplicate.*anyOf/i);
    });

    test("allows same group in both allOf and anyOf", () => {
      const config = createValidConfig({
        groups: {
          a: { files: { "a.txt": { content: "a" } } },
          b: { files: { "b.txt": { content: "b" } } },
        },
        conditionalGroups: [
          {
            when: { allOf: ["a"], anyOf: ["a", "b"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("validates conditional group file configs", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: ["a"] },
            files: {
              "test.txt": { content: 123 } as unknown as RawFileConfig,
            },
          },
        ],
      });
      assert.throws(() => validateRawConfig(config), /content must be/);
    });

    test("validates conditional group settings", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: ["a"] },
            settings: {
              rulesets: "not-an-object",
            } as unknown as RawRepoSettings,
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /rulesets must be an object/
      );
    });

    test("config with only conditionalGroups content is valid", () => {
      const validConfig: RawConfig = {
        id: "cond-only",
        groups: { a: {} },
        conditionalGroups: [
          {
            when: { allOf: ["a"] },
            settings: {
              labels: {
                "my-label": { color: "aabbcc" },
              },
            },
          },
        ],
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(validConfig));
    });

    test("conditional group with only prOptions is valid", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: ["a"] },
            prOptions: { labels: ["auto-merge"] },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("repo can override file from conditional group (knownFiles expanded)", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: ["a"] },
            files: {
              "cond-only.json": { content: { key: "value" } },
            },
          },
        ],
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["a"],
            files: {
              "cond-only.json": { content: { override: true } },
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("repo can opt out of ruleset from conditional group (rootCtx expanded)", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: ["a"] },
            settings: {
              rulesets: {
                "cond-ruleset": { target: "branch" },
              },
            },
          },
        ],
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["a"],
            settings: {
              rulesets: {
                "cond-ruleset": false,
              },
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("repo can opt out of label from conditional group (rootCtx expanded)", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: ["a"] },
            settings: {
              labels: {
                "cond-label": { color: "aabbcc" },
              },
            },
          },
        ],
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["a"],
            settings: {
              labels: {
                "cond-label": false,
              },
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("repo can opt out of repo settings from conditional group (no root repo settings)", () => {
      const config: RawConfig = {
        id: "test-config",
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: ["a"] },
            settings: {
              repo: { hasIssues: true },
            },
          },
        ],
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["a"],
            settings: {
              repo: false,
            },
          },
        ],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when allOf contains a non-string entry", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { allOf: [42] as unknown as string[] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /allOf.*entries must be strings/i
      );
    });

    test("throws when anyOf contains a non-string entry", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { anyOf: [42] as unknown as string[] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /anyOf.*entries must be strings/i
      );
    });

    test("config with only conditionalGroups files passes validateRawConfig", () => {
      const config: RawConfig = {
        id: "cond-files-only",
        groups: { a: {} },
        conditionalGroups: [
          {
            when: { allOf: ["a"] },
            files: {
              "cond.txt": { content: "hello" },
            },
          },
        ],
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("config with only conditionalGroups prOptions passes validateRawConfig", () => {
      const config: RawConfig = {
        id: "cond-pr-only",
        groups: { a: {} },
        conditionalGroups: [
          {
            when: { allOf: ["a"] },
            prOptions: { labels: ["auto-merge"] },
          },
        ],
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("repo can opt out of repo settings from regular group (rootCtx expanded)", () => {
      const config: RawConfig = {
        id: "test-config",
        groups: {
          a: {
            files: { "a.txt": { content: "a" } },
            settings: {
              repo: { hasIssues: true },
            },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["a"],
            settings: {
              repo: false,
            },
          },
        ],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("valid conditional group with noneOf only", () => {
      const config = createValidConfig({
        groups: {
          a: { files: { "a.txt": { content: "a" } } },
          b: { files: { "b.txt": { content: "b" } } },
        },
        conditionalGroups: [
          {
            when: { noneOf: ["a"] },
            files: { "fallback.txt": { content: "fallback" } },
          },
        ],
        repos: [
          {
            git: "git@github.com:org/repo.git",
            groups: ["b"],
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when noneOf is empty array", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { noneOf: [] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(() => validateRawConfig(config), /noneOf.*non-empty/i);
    });

    test("throws for non-existent group in noneOf", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { noneOf: ["nonexistent"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(
        () => validateRawConfig(config),
        /nonexistent.*not defined/i
      );
    });

    test("throws for duplicate group in noneOf", () => {
      const config = createValidConfig({
        groups: { a: { files: { "a.txt": { content: "a" } } } },
        conditionalGroups: [
          {
            when: { noneOf: ["a", "a"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(() => validateRawConfig(config), /duplicate.*noneOf/i);
    });

    test("throws when noneOf overlaps with allOf", () => {
      const config = createValidConfig({
        groups: {
          a: { files: { "a.txt": { content: "a" } } },
          b: { files: { "b.txt": { content: "b" } } },
        },
        conditionalGroups: [
          {
            when: { allOf: ["a"], noneOf: ["a"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(() => validateRawConfig(config), /noneOf.*overlap.*allOf/i);
    });

    test("throws when noneOf overlaps with anyOf", () => {
      const config = createValidConfig({
        groups: {
          a: { files: { "a.txt": { content: "a" } } },
          b: { files: { "b.txt": { content: "b" } } },
        },
        conditionalGroups: [
          {
            when: { anyOf: ["a", "b"], noneOf: ["a"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.throws(() => validateRawConfig(config), /noneOf.*overlap.*anyOf/i);
    });

    test("accepts noneOf with non-overlapping allOf", () => {
      const config = createValidConfig({
        groups: {
          a: { files: { "a.txt": { content: "a" } } },
          b: { files: { "b.txt": { content: "b" } } },
        },
        conditionalGroups: [
          {
            when: { allOf: ["a"], noneOf: ["b"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts noneOf with non-overlapping anyOf", () => {
      const config = createValidConfig({
        groups: {
          a: { files: { "a.txt": { content: "a" } } },
          b: { files: { "b.txt": { content: "b" } } },
        },
        conditionalGroups: [
          {
            when: { anyOf: ["a"], noneOf: ["b"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts noneOf with non-overlapping allOf and anyOf", () => {
      const config = createValidConfig({
        groups: {
          a: { files: { "a.txt": { content: "a" } } },
          b: { files: { "b.txt": { content: "b" } } },
          c: { files: { "c.txt": { content: "c" } } },
        },
        conditionalGroups: [
          {
            when: { allOf: ["a"], anyOf: ["b"], noneOf: ["c"] },
            settings: { labels: { x: { color: "aabbcc" } } },
          },
        ],
      });
      assert.doesNotThrow(() => validateRawConfig(config));
    });
  });
});

describe("validateForSync", () => {
  test("throws when no files and no settings", () => {
    const config: RawConfig = {
      id: "empty",
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSync(config),
      /Config requires at least one of:/
    );
  });

  test("throws when files is empty and no settings", () => {
    const config: RawConfig = {
      id: "empty-files",
      files: {},
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSync(config),
      /Config requires at least one of:/
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

  test("passes with settings-only config (no files)", () => {
    const config: RawConfig = {
      id: "settings-only",
      settings: {
        rulesets: {
          "main-protection": { target: "branch" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.doesNotThrow(() => validateForSync(config));
  });

  test("passes with repo-level settings only", () => {
    const config: RawConfig = {
      id: "repo-settings-only",
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

    assert.doesNotThrow(() => validateForSync(config));
  });

  test("passes with group-level settings only", () => {
    const config = {
      id: "group-settings-only",
      groups: {
        mygroup: {
          settings: {
            labels: {
              bug: { color: "d73a4a" },
            },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    } as RawConfig;

    assert.doesNotThrow(() => validateForSync(config));
  });

  test("passes when groups define files but root files is empty", () => {
    const config: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        mygroup: {
          files: { "config.json": { content: { key: "value" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    };
    assert.doesNotThrow(() => validateForSync(config));
  });

  test("passes when groups define files and no root files field", () => {
    const config = {
      id: "test-config",
      groups: {
        mygroup: {
          files: { "config.json": { content: { key: "value" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    } as RawConfig;
    assert.doesNotThrow(() => validateForSync(config));
  });

  test("throws when settings exists but has no actionable config", () => {
    const config: RawConfig = {
      id: "empty-settings",
      settings: {},
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    assert.throws(
      () => validateForSync(config),
      /Config requires at least one of:/
    );
  });

  test("config with only conditionalGroups content passes sync validation", () => {
    const config: RawConfig = {
      id: "cond-sync",
      groups: { a: {} },
      conditionalGroups: [
        {
          when: { allOf: ["a"] },
          settings: {
            labels: {
              "my-label": { color: "aabbcc" },
            },
          },
        },
      ],
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.doesNotThrow(() => validateForSync(config));
  });

  test("config with only conditionalGroups files passes validateForSync", () => {
    const config: RawConfig = {
      id: "cond-files-sync",
      groups: { a: {} },
      conditionalGroups: [
        {
          when: { allOf: ["a"] },
          files: {
            "cond.txt": { content: "hello" },
          },
        },
      ],
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.doesNotThrow(() => validateForSync(config));
  });

  test("config with only conditionalGroups prOptions passes validateForSync", () => {
    const config: RawConfig = {
      id: "cond-pr-sync",
      groups: { a: {} },
      conditionalGroups: [
        {
          when: { allOf: ["a"] },
          prOptions: { labels: ["auto-merge"] },
        },
      ],
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.doesNotThrow(() => validateForSync(config));
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

  test("returns false when repo is false (opt-out)", () => {
    assert.equal(hasActionableSettings({ repo: false as never }), false);
  });
});

describe("validateRawConfig - lifecycle fields", () => {
  test("accepts upstream field on repo", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/forked-tool.git",
          upstream: "git@github.com:opensource/cool-tool.git",
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts source field on repo", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/migrated-app.git",
          source: "https://dev.azure.com/org/project/_git/legacy-app",
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("rejects upstream and source together", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          upstream: "git@github.com:other/repo.git",
          source: "https://dev.azure.com/org/project/_git/repo",
        },
      ],
    };
    assert.throws(
      () => validateRawConfig(config),
      /upstream.*source.*mutually exclusive/i
    );
  });

  test("rejects invalid upstream URL", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          upstream: "not-a-valid-url",
        },
      ],
    };
    assert.throws(() => validateRawConfig(config), /upstream.*valid git URL/i);
  });

  test("rejects invalid source URL", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          source: "not-a-valid-url",
        },
      ],
    };
    assert.throws(() => validateRawConfig(config), /source.*valid git URL/i);
  });

  test("rejects non-string upstream", () => {
    const config = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          upstream: 123,
        },
      ],
    };
    assert.throws(
      () => validateRawConfig(config as unknown as RawConfig),
      /upstream.*must be a string/i
    );
  });

  test("rejects non-string source", () => {
    const config = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          source: { url: "foo" },
        },
      ],
    };
    assert.throws(
      () => validateRawConfig(config as unknown as RawConfig),
      /source.*must be a string/i
    );
  });

  test("accepts HTTPS upstream URL", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          upstream: "https://github.com/opensource/tool.git",
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("accepts SSH source URL", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          source: "git@ssh.dev.azure.com:v3/org/project/repo",
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("rejects GitHub SSH URL as migration source", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          source: "git@github.com:other-org/source-repo.git",
        },
      ],
    };
    assert.throws(
      () => validateRawConfig(config),
      /source.*cannot be a GitHub URL.*not supported/i
    );
  });

  test("rejects GitHub HTTPS URL as migration source", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          source: "https://github.com/other-org/source-repo.git",
        },
      ],
    };
    assert.throws(
      () => validateRawConfig(config),
      /source.*cannot be a GitHub URL.*not supported/i
    );
  });

  test("rejects GHE URL as migration source when githubHosts configured", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      githubHosts: ["github.mycompany.com"],
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
          source: "git@github.mycompany.com:other-org/source-repo.git",
        },
      ],
    };
    assert.throws(
      () => validateRawConfig(config),
      /source.*cannot be a GitHub URL.*not supported/i
    );
  });

  test("accepts repo without upstream or source", () => {
    const config: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/repo.git",
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });
});

describe("validateRepoSettings", () => {
  // Helper to create a minimal valid config with settings
  const createSettingsConfig = (
    repo: Record<string, unknown>
  ): import("../../../src/config/index.js").RawConfig => ({
    id: "test-config",
    settings: {
      repo: repo as import("../../../src/config/index.js").GitHubRepoSettings,
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
    const config: import("../../../src/config/index.js").RawConfig = {
      id: "test-config",
      settings: {
        repo: "invalid" as never,
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(() => validateRawConfig(config), /repo must be an object/);
  });
});

describe("labels validation", () => {
  test("valid label config passes validation", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: { color: "d73a4a", description: "Something isn't working" },
          feature: { color: "#0e8a16" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("invalid color format (not 6-char hex) throws", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: { color: "xyz" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(
      () => validateRawConfig(config),
      /color must be a 6-character hex code/
    );
  });

  test("description over 100 chars throws", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: { color: "d73a4a", description: "a".repeat(101) },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(() => validateRawConfig(config), /exceeds 100 characters/);
  });

  test("throws when 'inherit: true' is used at root labels level", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          inherit: true as never,
          bug: { color: "d73a4a" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(
      () => validateRawConfig(config),
      /reserved key.*cannot be used as a label name/
    );
  });

  test("throws when 'inherit: false' is used at root labels level", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          inherit: false as never,
          bug: { color: "d73a4a" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(
      () => validateRawConfig(config),
      /reserved key.*cannot be used as a label name/
    );
  });

  test("opt-out of non-existent root label throws", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: { color: "d73a4a" },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          settings: {
            labels: {
              nonexistent: false,
            },
          },
        },
      ],
    };
    assert.throws(
      () => validateRawConfig(config),
      /Cannot opt out of label 'nonexistent'/
    );
  });

  test("validateForSync passes with labels-only config", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: { color: "d73a4a" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.doesNotThrow(() => validateForSync(config));
  });

  test("hasActionableSettings returns true for labels-only settings", () => {
    assert.equal(
      hasActionableSettings({
        labels: { bug: { color: "d73a4a" } },
      }),
      true
    );
  });

  test("hasActionableSettings returns false for labels with only inherit key", () => {
    assert.equal(
      hasActionableSettings({
        labels: { inherit: false },
      }),
      false
    );
  });

  test("throws when label is null (not an object)", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: null as never,
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(
      () => validateRawConfig(config),
      /label 'bug' must be an object/
    );
  });

  test("throws when label is an array (not an object)", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: ["d73a4a"] as never,
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(
      () => validateRawConfig(config),
      /label 'bug' must be an object/
    );
  });

  test("throws when label is a string (not an object)", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: "d73a4a" as never,
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(
      () => validateRawConfig(config),
      /label 'bug' must be an object/
    );
  });

  test("throws when label new_name is not a string", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: { color: "d73a4a", new_name: 123 as never },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(
      () => validateRawConfig(config),
      /label 'bug' new_name must be a string/
    );
  });

  test("allows label with valid new_name field", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: { color: "d73a4a", new_name: "defect" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("throws when labels is an array (not an object)", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: [{ color: "d73a4a" }] as never,
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(() => validateRawConfig(config), /labels must be an object/);
  });

  test("throws when labels is null (not an object)", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: null as never,
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(() => validateRawConfig(config), /labels must be an object/);
  });

  test("allows per-repo label: false opt-out when root label exists", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: { color: "d73a4a" },
          feature: { color: "0e8a16" },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          settings: {
            labels: {
              bug: false,
            },
          },
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("throws when label description is not a string", () => {
    const config: RawConfig = {
      id: "test-config",
      settings: {
        labels: {
          bug: { color: "d73a4a", description: 123 as never },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    assert.throws(
      () => validateRawConfig(config),
      /label 'bug' description must be a string/
    );
  });

  describe("prOptions labels validation", () => {
    test("accepts valid labels array in prOptions", () => {
      const config = {
        id: "test",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prOptions: {
          labels: ["config-sync", "automated"],
        },
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when prOptions labels is not an array", () => {
      const config = {
        id: "test",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prOptions: {
          labels: "not-an-array",
        },
      } as unknown as RawConfig;
      assert.throws(
        () => validateRawConfig(config),
        /prOptions\.labels must be an array/
      );
    });

    test("throws when prOptions labels contains non-string element", () => {
      const config = {
        id: "test",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prOptions: {
          labels: ["valid", 123],
        },
      } as unknown as RawConfig;
      assert.throws(
        () => validateRawConfig(config),
        /prOptions\.labels entries must be non-empty strings/
      );
    });

    test("throws when prOptions labels contains empty string", () => {
      const config = {
        id: "test",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prOptions: {
          labels: ["valid", ""],
        },
      } as unknown as RawConfig;
      assert.throws(
        () => validateRawConfig(config),
        /prOptions\.labels entries must be non-empty strings/
      );
    });
  });
});

describe("group validation - extended coverage", () => {
  const createValidConfig = (overrides?: Partial<RawConfig>): RawConfig => ({
    id: "test-config",
    files: {
      "config.json": { content: { key: "value" } },
    },
    repos: [{ git: "git@github.com:org/repo.git" }],
    ...overrides,
  });

  test("group file with JSON extension but text content throws", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: {
            "config.json": { content: "text content" } as RawFileConfig,
          },
        },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /JSON\/YAML extension but string content/
    );
  });

  test("group file with text extension but object content throws", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: {
            "script.sh": { content: { key: "value" } } as RawFileConfig,
          },
        },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /text extension but object content/
    );
  });

  test("group file with false value passes validation", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: {
            "config.json": false,
          },
        },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("group file with inherit key passes validation", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: {
            inherit: false,
            "extra.json": { content: { key: "value" } },
          },
        },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("group file with undefined value passes validation", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: {
            "config.json": undefined as unknown as RawFileConfig,
          },
        },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("group file with no content passes validation", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: {
            "config.json": {} as RawFileConfig,
          },
        },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("repo can opt out of ruleset defined in group", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          settings: {
            rulesets: {
              "group-ruleset": { target: "branch" },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          settings: {
            rulesets: {
              "group-ruleset": false,
            },
          },
        },
      ],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("repo can opt out of label defined in group", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          settings: {
            labels: {
              "group-label": { color: "d73a4a" },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          settings: {
            labels: {
              "group-label": false,
            },
          },
        },
      ],
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("throws when groups is null", () => {
    const config = createValidConfig({
      groups: null as unknown as RawConfig["groups"],
    });
    assert.throws(() => validateRawConfig(config), /groups must be an object/);
  });

  test("repo references group without groups defined at root throws", () => {
    const config = createValidConfig({
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["nonexistent"],
        },
      ],
    });
    assert.throws(
      () => validateRawConfig(config),
      /group 'nonexistent' is not defined/
    );
  });

  test("group with YAML extension but text content throws", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: {
            "config.yaml": { content: "text content" } as RawFileConfig,
          },
        },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /JSON\/YAML extension but string content/
    );
  });

  test("group file with invalid content type throws", () => {
    const config = createValidConfig({
      groups: {
        mygroup: {
          files: {
            "config.json": { content: 42 } as unknown as RawFileConfig,
          },
        },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /content must be an object, string, or array of strings/
    );
  });
});

describe("validateForSync - group coverage", () => {
  test("throws when only group files are false opt-outs", () => {
    const config = {
      id: "test-config",
      groups: {
        mygroup: {
          files: {
            "config.json": false,
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    } as RawConfig;
    assert.throws(
      () => validateForSync(config),
      /Config requires at least one of:/
    );
  });

  test("throws when group files only contain inherit key", () => {
    const config = {
      id: "test-config",
      groups: {
        mygroup: {
          files: {
            inherit: false,
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    } as RawConfig;
    assert.throws(
      () => validateForSync(config),
      /Config requires at least one of:/
    );
  });

  test("passes when group has real files mixed with opt-outs", () => {
    const config = {
      id: "test-config",
      groups: {
        mygroup: {
          files: {
            "removed.json": false,
            "real.json": { content: { key: "value" } },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    } as RawConfig;
    assert.doesNotThrow(() => validateForSync(config));
  });

  test("passes when one of multiple groups has files", () => {
    const config = {
      id: "test-config",
      groups: {
        emptyGroup: {},
        fileGroup: {
          files: { "config.json": { content: { key: "value" } } },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["emptyGroup", "fileGroup"],
        },
      ],
    } as RawConfig;
    assert.doesNotThrow(() => validateForSync(config));
  });
});

describe("validateRawConfig - group files with no root files", () => {
  test("passes when only groups define files and root files is undefined", () => {
    const config = {
      id: "test-config",
      groups: {
        mygroup: {
          files: { "config.json": { content: { key: "value" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    } as RawConfig;
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("passes when groups define settings but no files or root settings", () => {
    const config = {
      id: "test-config",
      groups: {
        mygroup: {
          settings: {
            rulesets: {
              "branch-protection": { target: "branch" },
            },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    } as RawConfig;
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("throws when groups exist but have no files and no settings", () => {
    const config = {
      id: "test-config",
      groups: {
        mygroup: {},
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    } as RawConfig;
    assert.throws(
      () => validateRawConfig(config),
      /Config requires at least one of:/
    );
  });

  test("groups with only false file entries do not count as having files", () => {
    const config = {
      id: "test-config",
      groups: {
        mygroup: {
          files: {
            "config.json": false,
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    } as RawConfig;
    assert.throws(
      () => validateRawConfig(config),
      /Config requires at least one of:/
    );
  });

  test("groups with only inherit key do not count as having files", () => {
    const config = {
      id: "test-config",
      groups: {
        mygroup: {
          files: {
            inherit: false,
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["mygroup"] }],
    } as RawConfig;
    assert.throws(
      () => validateRawConfig(config),
      /Config requires at least one of:/
    );
  });
});

describe("group extends validation", () => {
  const createValidConfig = (overrides?: Partial<RawConfig>): RawConfig => ({
    id: "test-config",
    files: { "config.json": { content: { key: "value" } } },
    repos: [{ git: "git@github.com:org/repo.git" }],
    ...overrides,
  });

  test("valid extends with string passes", () => {
    const config = createValidConfig({
      groups: {
        parent: { files: {} },
        child: { extends: "parent", files: {} },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("valid extends with array passes", () => {
    const config = createValidConfig({
      groups: {
        parentA: { files: {} },
        parentB: { files: {} },
        child: { extends: ["parentA", "parentB"], files: {} },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("throws for extends referencing non-existent group", () => {
    const config = createValidConfig({
      groups: {
        child: { extends: "nonexistent", files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: extends references undefined group 'nonexistent'/
    );
  });

  test("throws for extends array with non-existent group", () => {
    const config = createValidConfig({
      groups: {
        parent: { files: {} },
        child: { extends: ["parent", "missing"], files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: extends references undefined group 'missing'/
    );
  });

  test("throws for extends self-reference", () => {
    const config = createValidConfig({
      groups: {
        selfref: { extends: "selfref", files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.selfref: extends cannot reference itself/
    );
  });

  test("throws for extends as empty string", () => {
    const config = createValidConfig({
      groups: {
        parent: { files: {} },
        child: { extends: "", files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: 'extends' must be a non-empty string or array of strings/
    );
  });

  test("throws for extends array with self-reference entry", () => {
    const config = createValidConfig({
      groups: {
        parent: { files: {} },
        child: { extends: ["parent", "child"], files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: extends cannot reference itself/
    );
  });

  test("throws for circular extends (a -> b -> a)", () => {
    const config = createValidConfig({
      groups: {
        a: { extends: "b", files: {} },
        b: { extends: "a", files: {} },
      },
    });
    assert.throws(() => validateRawConfig(config), /[Cc]ircular extends/);
  });

  test("throws for circular extends (a -> b -> c -> a)", () => {
    const config = createValidConfig({
      groups: {
        a: { extends: "b", files: {} },
        b: { extends: "c", files: {} },
        c: { extends: "a", files: {} },
      },
    });
    assert.throws(() => validateRawConfig(config), /[Cc]ircular extends/);
  });

  test("throws for extends as empty array", () => {
    const config = createValidConfig({
      groups: {
        child: { extends: [] as string[], files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: 'extends' must be a non-empty string or array of strings/
    );
  });

  test("throws for extends with non-string value", () => {
    const config = createValidConfig({
      groups: {
        child: { extends: 123 as unknown as string, files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: 'extends' must be a non-empty string or array of strings/
    );
  });

  test("throws for extends array with non-string entry", () => {
    const config = createValidConfig({
      groups: {
        parent: { files: {} },
        child: { extends: ["parent", 42 as unknown as string], files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /groups\.child: 'extends' array entries must be strings/
    );
  });

  test("throws for extends as reserved group name", () => {
    const config = createValidConfig({
      groups: {
        extends: { files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /'extends' is a reserved key and cannot be used as a group name/
    );
  });

  test("transitive extends with valid chain passes", () => {
    const config = createValidConfig({
      groups: {
        grandparent: { files: {} },
        parent: { extends: "grandparent", files: {} },
        child: { extends: "parent", files: {} },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("diamond extends passes (no cycle)", () => {
    const config = createValidConfig({
      groups: {
        base: { files: {} },
        left: { extends: "base", files: {} },
        right: { extends: "base", files: {} },
        top: { extends: ["left", "right"], files: {} },
      },
    });
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("throws for empty string in extends array", () => {
    const config = createValidConfig({
      groups: {
        parent: { files: {} },
        child: { extends: ["parent", ""] as string[], files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /extends.*non-empty strings/
    );
  });

  test("throws for duplicate entry in extends array", () => {
    const config = createValidConfig({
      groups: {
        parent: { files: {} },
        child: { extends: ["parent", "parent"], files: {} },
      },
    });
    assert.throws(
      () => validateRawConfig(config),
      /duplicate 'parent' in extends/
    );
  });

  test("repo can override file from transitive parent group", () => {
    const config: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        parent: {
          files: { "parent-file.json": { content: { from: "parent" } } },
        },
        child: {
          extends: "parent",
          files: { "child-file.json": { content: { from: "child" } } },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["child"],
          files: {
            "parent-file.json": { content: { override: true } },
          },
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  test("repo can opt out of settings from transitive parent group", () => {
    const config: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      groups: {
        parent: {
          settings: {
            labels: {
              "parent-label": { color: "ff0000", description: "" },
            },
          },
        },
        child: {
          extends: "parent",
          files: {},
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["child"],
          settings: {
            labels: {
              "parent-label": false,
            },
          },
        },
      ],
    };
    assert.doesNotThrow(() => validateRawConfig(config));
  });

  describe("validateVariables", () => {
    test("passes validateForSync with variables-only config (no files)", () => {
      const config: import("../../../src/config/index.js").RawConfig = {
        id: "variables-only",
        settings: {
          variables: { MY_VAR: "value" },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateForSync(config));
    });

    test("accepts valid variable names", () => {
      const config = createValidConfig({
        settings: {
          variables: { MY_VAR: "value", ANOTHER_123: "val" },
        },
      });
      assert.doesNotThrow(() => validateForSync(config));
    });

    test("rejects variable names starting with GITHUB_", () => {
      const config = createValidConfig({
        settings: {
          variables: { GITHUB_TOKEN: "value" },
        },
      });
      assert.throws(() => validateForSync(config), /GITHUB_/);
    });

    test("rejects variable names with invalid characters", () => {
      const config = createValidConfig({
        settings: {
          variables: { "my-var": "value" },
        },
      });
      assert.throws(() => validateForSync(config), /invalid.*character/i);
    });

    test("skips reserved peer keys (deleteOrphaned, inherit) during name validation", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              variables: {
                MY_VAR: "value",
                deleteOrphaned: true,
                inherit: false,
              } as unknown as RawRepoSettings["variables"],
            },
          },
        ],
      });
      assert.doesNotThrow(() => validateForSync(config));
    });

    test("rejects invalid variable name in group", () => {
      const config: RawConfig = {
        id: "test-config",
        files: { "f.json": { content: {} } },
        groups: {
          myGroup: {
            settings: {
              variables: { GITHUB_BAD: "value" },
            },
          },
        },
        repos: [{ git: "git@github.com:org/repo.git", groups: ["myGroup"] }],
      };
      assert.throws(() => validateForSync(config), /GITHUB_/);
    });

    test("rejects invalid variable name in conditional group", () => {
      const config: RawConfig = {
        id: "test-config",
        files: { "f.json": { content: {} } },
        groups: { g1: {} },
        conditionalGroups: [
          {
            when: { allOf: ["g1"] },
            settings: {
              variables: { GITHUB_BAD: "value" },
            },
          },
        ],
        repos: [{ git: "git@github.com:org/repo.git", groups: ["g1"] }],
      };
      assert.throws(() => validateForSync(config), /GITHUB_/);
    });

    test("rejects case-insensitive duplicate variable names", () => {
      const config = createValidConfig({
        settings: {
          variables: { MY_VAR: "value1", my_var: "value2" },
        },
      });
      assert.throws(
        () => validateForSync(config),
        /Duplicate variable name: 'my_var' and 'MY_VAR' collide/
      );
    });

    test("rejects non-string variable values", () => {
      const config = createValidConfig({
        settings: {
          variables: { MY_VAR: 123 as unknown as string },
        },
      });
      assert.throws(
        () => validateForSync(config),
        /Variable 'MY_VAR' must have a string value \(got number\)/
      );
    });

    test("accepts false as variable value (opt-out)", () => {
      const config = createValidConfig({
        settings: {
          variables: { MY_VAR: false as unknown as string },
        },
      });
      assert.doesNotThrow(() => validateForSync(config));
    });

    test("throws when 'inherit' is used at root-level variables", () => {
      const config = createValidConfig({
        settings: {
          variables: { inherit: true, MY_VAR: "value" } as unknown as Record<
            string,
            string
          >,
        },
      });
      assert.throws(() => validateRawConfig(config), /inherit.*root/i);
    });

    test("throws when variables.deleteOrphaned is not a boolean", () => {
      const config = createValidConfig({
        settings: {
          variables: {
            deleteOrphaned: "yes",
            MY_VAR: "value",
          } as unknown as Record<string, string>,
        },
      });
      assert.throws(
        () => validateForSync(config),
        /variables\.deleteOrphaned must be a boolean/
      );
    });

    test("throws when variables.inherit is not a boolean", () => {
      const config = createValidConfig({
        repos: [
          {
            git: ["https://github.com/org/repo"],
            settings: {
              variables: {
                inherit: "yes",
                MY_VAR: "value",
              } as unknown as Record<string, string>,
            },
          },
        ],
      });
      assert.throws(
        () => validateForSync(config),
        /variables\.inherit must be a boolean/
      );
    });

    test("accepts valid boolean deleteOrphaned in variables", () => {
      const config = createValidConfig({
        settings: {
          variables: {
            deleteOrphaned: true,
            MY_VAR: "value",
          } as unknown as Record<string, string>,
        },
      });
      assert.doesNotThrow(() => validateForSync(config));
    });
  });

  describe("validateSecrets", () => {
    test("accepts valid secret config", () => {
      const config = createValidConfig({
        secrets: { MY_SECRET: { env: "SOURCE_VAR" } },
      });
      assert.doesNotThrow(() => validateSecretsConfig(config));
    });

    test("rejects secret names starting with GITHUB_", () => {
      const config = createValidConfig({
        secrets: { GITHUB_TOKEN: { env: "TOKEN" } },
      });
      assert.throws(() => validateSecretsConfig(config), /GITHUB_/);
    });

    test("rejects secret without env field", () => {
      const config = createValidConfig({
        secrets: { MY_SECRET: {} as SecretConfig },
      });
      assert.throws(() => validateSecretsConfig(config), /env/);
    });

    test("skips when no secrets configured", () => {
      const config = createValidConfig({});
      assert.doesNotThrow(() => validateSecretsConfig(config));
    });

    test("rejects deleteOrphaned used as a secret name", () => {
      const config = createValidConfig({
        secrets: {
          deleteOrphaned: { env: "FOO" },
        } as unknown as RawConfig["secrets"],
      });
      assert.throws(
        () => validateSecretsConfig(config),
        /deleteOrphaned.*reserved/i
      );
    });

    test("rejects duplicate case-insensitive secret names", () => {
      const config = createValidConfig({
        secrets: {
          MY_SECRET: { env: "SRC_UPPER" },
          my_secret: { env: "SRC_LOWER" },
        },
      });
      assert.throws(
        () => validateSecretsConfig(config),
        /[Dd]uplicate secret name/
      );
    });

    test("rejects secret names with invalid characters", () => {
      const config = createValidConfig({
        secrets: { "MY-SECRET": { env: "SRC" } },
      });
      assert.throws(() => validateSecretsConfig(config), /invalid.*character/i);
    });
  });

  describe("secrets-only config", () => {
    test("accepts config with only secrets and repos", () => {
      const config: RawConfig = {
        id: "test",
        repos: [{ git: "https://github.com/o/r.git" }],
        secrets: {
          MY_SECRET: { env: "SOURCE_VAR" },
        },
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });
  });

  describe("cross-validation", () => {
    test("rejects overlapping variable and secret names", () => {
      const config = createValidConfig({
        repos: [
          {
            git: "https://github.com/o/r.git",
            settings: {
              variables: { DEPLOY_TOKEN: "value" },
            },
          },
        ],
        secrets: {
          DEPLOY_TOKEN: { env: "SRC" },
        },
      });
      assert.throws(() => validateForSync(config), /DEPLOY_TOKEN.*overlap/i);
    });

    test("rejects overlapping root variable and secret names", () => {
      const config = createValidConfig({
        settings: {
          variables: { DEPLOY_TOKEN: "value" },
        },
        secrets: {
          DEPLOY_TOKEN: { env: "SRC" },
        },
      });
      assert.throws(() => validateForSync(config), /DEPLOY_TOKEN.*overlap/i);
    });

    test("rejects overlapping group variable and secret names", () => {
      const config: RawConfig = {
        id: "test-config",
        files: { "f.json": { content: {} } },
        groups: {
          myGroup: {
            settings: {
              variables: { DEPLOY_TOKEN: "value" },
            },
          },
        },
        repos: [{ git: "git@github.com:org/repo.git", groups: ["myGroup"] }],
        secrets: { DEPLOY_TOKEN: { env: "SRC" } },
      };
      assert.throws(() => validateForSync(config), /DEPLOY_TOKEN.*overlap/i);
    });

    test("rejects overlapping conditional group variable and secret names", () => {
      const config: RawConfig = {
        id: "test-config",
        files: { "f.json": { content: {} } },
        groups: { g1: {} },
        conditionalGroups: [
          {
            when: { allOf: ["g1"] },
            settings: {
              variables: { DEPLOY_TOKEN: "value" },
            },
          },
        ],
        repos: [{ git: "git@github.com:org/repo.git", groups: ["g1"] }],
        secrets: { DEPLOY_TOKEN: { env: "SRC" } },
      };
      assert.throws(() => validateForSync(config), /DEPLOY_TOKEN.*overlap/i);
    });

    test("rejects case-insensitive overlapping variable and secret names", () => {
      const config = createValidConfig({
        settings: {
          variables: { deploy_token: "value" },
        },
        secrets: { DEPLOY_TOKEN: { env: "SRC" } },
      });
      assert.throws(() => validateForSync(config), /deploy_token.*overlap/i);
    });
  });

  describe("validateVariableSecretOverlaps standalone", () => {
    test("detects overlap when called independently", () => {
      const config = createValidConfig({
        settings: {
          variables: { API_KEY: "value" },
        },
        secrets: { API_KEY: { env: "SRC" } },
      });
      assert.throws(
        () => validateVariableSecretOverlaps(config),
        /API_KEY.*overlap/i
      );
    });

    test("passes when no overlap exists", () => {
      const config = createValidConfig({
        settings: {
          variables: { MY_VAR: "value" },
        },
        secrets: { MY_SECRET: { env: "SRC" } },
      });
      assert.doesNotThrow(() => validateVariableSecretOverlaps(config));
    });

    test("passes when no secrets defined", () => {
      const config = createValidConfig({
        settings: {
          variables: { MY_VAR: "value" },
        },
      });
      assert.doesNotThrow(() => validateVariableSecretOverlaps(config));
    });
  });
});
