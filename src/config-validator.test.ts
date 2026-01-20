import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { validateRawConfig } from "./config-validator.js";
import type { RawConfig } from "./config.js";

describe("validateRawConfig", () => {
  // Helper to create a minimal valid config
  const createValidConfig = (overrides?: Partial<RawConfig>): RawConfig => ({
    files: {
      "config.json": { content: { key: "value" } },
    },
    repos: [{ git: "git@github.com:org/repo.git" }],
    ...overrides,
  });

  describe("files validation", () => {
    test("throws when files is missing", () => {
      const config = {} as RawConfig;

      assert.throws(
        () => validateRawConfig(config),
        /Config missing required field: files/,
      );
    });

    test("throws when files is empty", () => {
      const config = createValidConfig({ files: {} });

      assert.throws(
        () => validateRawConfig(config),
        /Config files object cannot be empty/,
      );
    });

    test("throws when file name contains path traversal (..)", () => {
      const config = createValidConfig({
        files: { "../config.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /Invalid fileName.*must be a relative path/,
      );
    });

    test("throws when file name contains path traversal in middle", () => {
      const config = createValidConfig({
        files: { "path/../config.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /Invalid fileName.*must be a relative path/,
      );
    });

    test("throws when file name is absolute path (Unix)", () => {
      const config = createValidConfig({
        files: { "/etc/config.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /Invalid fileName.*must be a relative path/,
      );
    });

    test("throws when file name contains newline", () => {
      const config = createValidConfig({
        files: { "config\n.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /cannot contain newlines or null bytes/,
      );
    });

    test("throws when file name contains carriage return", () => {
      const config = createValidConfig({
        files: { "config\r.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /cannot contain newlines or null bytes/,
      );
    });

    test("throws when file name contains null byte", () => {
      const config = createValidConfig({
        files: { "config\0.json": { content: {} } },
      });

      assert.throws(
        () => validateRawConfig(config),
        /cannot contain newlines or null bytes/,
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
        /has invalid mergeStrategy: invalid/,
      );
    });
  });

  describe("repos validation", () => {
    test("throws when repos is missing", () => {
      const config = { files: { "config.json": { content: {} } } } as RawConfig;

      assert.throws(
        () => validateRawConfig(config),
        /Config missing required field: repos/,
      );
    });

    test("throws when repos is not an array", () => {
      const config = createValidConfig();
      (config as Record<string, unknown>).repos = "not-an-array";

      assert.throws(
        () => validateRawConfig(config),
        /Config missing required field: repos \(must be an array\)/,
      );
    });

    test("throws when repo is missing git field", () => {
      const config = createValidConfig({
        repos: [{} as never],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Repo at index 0 missing required field: git/,
      );
    });

    test("throws when repo has empty git array", () => {
      const config = createValidConfig({
        repos: [{ git: [] }],
      });

      assert.throws(
        () => validateRawConfig(config),
        /Repo at index 0 has empty git array/,
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
        /Repo at index 0 references undefined file 'nonexistent.json'/,
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
        /has override: true for file 'config.json' but no content defined/,
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
        /Repo at index 0 references undefined file 'nonexistent.json'/,
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
        /createOnly must be a boolean/,
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
        /createOnly must be a boolean/,
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
        /header must be a string or array of strings/,
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
        /header must be a string or array of strings/,
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
        /header must be a string or array of strings/,
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
        /schemaUrl must be a string/,
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
        /schemaUrl must be a string/,
      );
    });
  });

  describe("empty content validation", () => {
    test("allows undefined content for empty file", () => {
      const config: RawConfig = {
        files: {
          ".prettierignore": {},
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows empty file with header", () => {
      const config: RawConfig = {
        files: {
          "config.yaml": { header: "Schema-only file" },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows empty file with schemaUrl", () => {
      const config: RawConfig = {
        files: {
          "config.yaml": { schemaUrl: "https://example.com/schema.json" },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("allows empty file with createOnly", () => {
      const config: RawConfig = {
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
        files: {
          "config.json": { content: { key: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts multiple files in config", () => {
      const config: RawConfig = {
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
        files: {
          json: { content: "some text content" }, // file named "json" with no extension
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts string content for text files", () => {
      const config: RawConfig = {
        files: {
          ".gitignore": { content: "node_modules/\ndist/\n" },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts string array content for text files", () => {
      const config: RawConfig = {
        files: {
          ".gitignore": { content: ["node_modules/", "dist/"] },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("accepts text content with mergeStrategy", () => {
      const config: RawConfig = {
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
        files: {
          "config.json": { content: "not valid json content" as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has JSON\/YAML extension but string content/,
      );
    });

    test("throws when YAML file has string content", () => {
      const config: RawConfig = {
        files: {
          "config.yaml": { content: "key: value" as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has JSON\/YAML extension but string content/,
      );
    });

    test("throws when YML file has string array content", () => {
      const config: RawConfig = {
        files: {
          "config.yml": { content: ["line1", "line2"] as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has JSON\/YAML extension but string content/,
      );
    });

    test("accepts object content for .json5 files", () => {
      const config: RawConfig = {
        files: {
          "config.json5": { content: { key: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.doesNotThrow(() => validateRawConfig(config));
    });

    test("throws when JSON5 file has string content", () => {
      const config: RawConfig = {
        files: {
          "config.json5": { content: "string content" as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has JSON\/YAML extension but string content/,
      );
    });

    test("throws when text file has object content", () => {
      const config: RawConfig = {
        files: {
          ".gitignore": { content: { key: "value" } as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has text extension but object content/,
      );
    });

    test("throws when .env file has object content", () => {
      const config: RawConfig = {
        files: {
          ".env.example": { content: { KEY: "value" } as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /has text extension but object content/,
      );
    });

    test("throws when array has non-string elements", () => {
      const config: RawConfig = {
        files: {
          ".gitignore": { content: ["valid", 123, "also valid"] as never },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };
      assert.throws(
        () => validateRawConfig(config),
        /content must be an object, string, or array of strings/,
      );
    });

    test("throws when per-repo JSON file override has string content", () => {
      const config: RawConfig = {
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
        /has JSON\/YAML extension but string content/,
      );
    });

    test("throws when per-repo text file override has object content", () => {
      const config: RawConfig = {
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
        /has text extension but object content/,
      );
    });

    test("accepts per-repo text file override with string array", () => {
      const config: RawConfig = {
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
        /executable must be a boolean/,
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
        /executable must be a boolean/,
      );
    });
  });
});
