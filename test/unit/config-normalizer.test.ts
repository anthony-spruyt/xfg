import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeConfig, mergeSettings } from "../../src/config/normalizer.js";
import type {
  RawConfig,
  PullRequestRuleParameters,
} from "../../src/config/index.js";

describe("normalizeConfig", () => {
  beforeEach(() => {
    process.env.TEST_VAR = "test-value";
  });

  afterEach(() => {
    delete process.env.TEST_VAR;
  });

  describe("git array expansion", () => {
    test("expands single git URL to one repo entry", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos.length, 1);
      assert.equal(result.repos[0].git, "git@github.com:org/repo.git");
    });

    test("expands git array to multiple repo entries", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: { key: "value" } } },
        repos: [
          {
            git: [
              "git@github.com:org/repo1.git",
              "git@github.com:org/repo2.git",
            ],
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos.length, 2);
      assert.equal(result.repos[0].git, "git@github.com:org/repo1.git");
      assert.equal(result.repos[1].git, "git@github.com:org/repo2.git");
    });

    test("each expanded repo gets all files", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" } },
          "settings.yaml": { content: { enabled: true } },
        },
        repos: [
          {
            git: [
              "git@github.com:org/repo1.git",
              "git@github.com:org/repo2.git",
            ],
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files.length, 2);
      assert.equal(result.repos[1].files.length, 2);
    });

    test("handles multiple repos with mixed single and array git", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          { git: "git@github.com:org/single.git" },
          {
            git: [
              "git@github.com:org/array1.git",
              "git@github.com:org/array2.git",
            ],
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos.length, 3);
    });
  });

  describe("all repos receive all files", () => {
    test("all files delivered to all repos by default", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "eslint.json": { content: { extends: ["base"] } },
          "prettier.json": { content: { semi: true } },
        },
        repos: [
          { git: "git@github.com:org/repo1.git" },
          { git: "git@github.com:org/repo2.git" },
        ],
      };

      const result = normalizeConfig(raw);

      // Both repos should have both files
      assert.equal(result.repos[0].files.length, 2);
      assert.equal(result.repos[1].files.length, 2);

      // Check file names
      const repo1FileNames = result.repos[0].files.map((f) => f.fileName);
      assert.deepEqual(repo1FileNames, ["eslint.json", "prettier.json"]);
    });
  });

  describe("file exclusion", () => {
    test("excludes file when set to false", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "eslint.json": { content: { extends: ["base"] } },
          "prettier.json": { content: { semi: true } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "eslint.json": false,
            },
          },
        ],
      };

      const result = normalizeConfig(raw);

      // Only prettier.json should be included
      assert.equal(result.repos[0].files.length, 1);
      assert.equal(result.repos[0].files[0].fileName, "prettier.json");
    });

    test("excludes multiple files", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "eslint.json": { content: { extends: ["base"] } },
          "prettier.json": { content: { semi: true } },
          "tsconfig.json": { content: { strict: true } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "eslint.json": false,
              "tsconfig.json": false,
            },
          },
        ],
      };

      const result = normalizeConfig(raw);

      // Only prettier.json should be included
      assert.equal(result.repos[0].files.length, 1);
      assert.equal(result.repos[0].files[0].fileName, "prettier.json");
    });

    test("different repos can exclude different files", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "eslint.json": { content: { extends: ["base"] } },
          "prettier.json": { content: { semi: true } },
        },
        repos: [
          {
            git: "git@github.com:org/repo1.git",
            files: {
              "eslint.json": false,
            },
          },
          {
            git: "git@github.com:org/repo2.git",
            files: {
              "prettier.json": false,
            },
          },
        ],
      };

      const result = normalizeConfig(raw);

      // repo1: only prettier.json
      assert.equal(result.repos[0].files.length, 1);
      assert.equal(result.repos[0].files[0].fileName, "prettier.json");

      // repo2: only eslint.json
      assert.equal(result.repos[1].files.length, 1);
      assert.equal(result.repos[1].files[0].fileName, "eslint.json");
    });

    test("can mix exclusion with overrides", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "eslint.json": { content: { extends: ["base"] } },
          "prettier.json": { content: { semi: true } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "eslint.json": false,
              "prettier.json": { content: { tabWidth: 4 } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);

      // Only prettier.json, with merged content
      assert.equal(result.repos[0].files.length, 1);
      assert.equal(result.repos[0].files[0].fileName, "prettier.json");
      assert.deepEqual(result.repos[0].files[0].content, {
        semi: true,
        tabWidth: 4,
      });
    });
  });

  describe("content merging", () => {
    test("uses file base content when repo has no override", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { base: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].content, { base: "value" });
    });

    test("merges repo file content with file base content", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { base: "value", override: "original" } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { content: { override: "updated", added: "new" } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].content, {
        base: "value",
        override: "updated",
        added: "new",
      });
    });

    test("deep merges nested objects", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { nested: { a: 1, b: 2 } } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { content: { nested: { b: 3, c: 4 } } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].content, {
        nested: { a: 1, b: 3, c: 4 },
      });
    });

    test("uses override mode when override is true", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { base: "value" } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": {
                override: true,
                content: { only: "repo-value" },
              },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].content, {
        only: "repo-value",
      });
    });

    test("uses override mode with text content", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": { content: "node_modules\ndist" },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": {
                override: true,
                content: "coverage\n.env",
              },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      // Override with text content - uses repo content only
      assert.equal(result.repos[0].files[0].content, "coverage\n.env");
    });

    test("uses override mode with text array content", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": { content: ["node_modules", "dist"] },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": {
                override: true,
                content: ["coverage", ".env"],
              },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      // Override with text array content - uses repo content only
      assert.deepEqual(result.repos[0].files[0].content, ["coverage", ".env"]);
    });

    test("respects per-file mergeStrategy", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": {
            content: { items: ["a", "b"] },
            mergeStrategy: "append",
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { content: { items: ["c", "d"] } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].content, {
        items: ["a", "b", "c", "d"],
      });
    });

    test("string text content always replaces (mergeStrategy ignored)", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": {
            content: "node_modules\ndist",
            mergeStrategy: "append", // ignored for string content
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": { content: "coverage\n.env" },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      // String content always replaces - mergeStrategy is ignored
      assert.equal(result.repos[0].files[0].content, "coverage\n.env");
    });

    test("merges text array content with append strategy", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": {
            content: ["node_modules", "dist"],
            mergeStrategy: "append",
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": { content: ["coverage", ".env"] },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      // Text array content merged with append
      assert.deepEqual(result.repos[0].files[0].content, [
        "node_modules",
        "dist",
        "coverage",
        ".env",
      ]);
    });

    test("merges text content with prepend strategy", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": {
            content: ["node_modules", "dist"],
            mergeStrategy: "prepend",
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": { content: ["coverage", ".env"] },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      // Text array content merged with prepend - repo content before base
      assert.deepEqual(result.repos[0].files[0].content, [
        "coverage",
        ".env",
        "node_modules",
        "dist",
      ]);
    });

    test("merges text content with replace strategy (default)", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": {
            content: ["node_modules", "dist"],
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": { content: ["coverage", ".env"] },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      // Text array content with default replace - repo content replaces base
      assert.deepEqual(result.repos[0].files[0].content, ["coverage", ".env"]);
    });

    test("strips merge directives from output", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { items: ["a"] } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": {
                content: {
                  items: { $arrayMerge: "append", values: ["b"] },
                },
              },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      const jsonStr = JSON.stringify(result.repos[0].files[0].content);
      assert.ok(!jsonStr.includes("$arrayMerge"));
    });
  });

  describe("environment variable interpolation", () => {
    test("interpolates env vars in content", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { value: "${TEST_VAR}" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].content, {
        value: "test-value",
      });
    });

    test("interpolates env vars with defaults", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { value: "${MISSING:-default}" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].content, { value: "default" });
    });

    test("throws on missing required env var", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { value: "${MISSING_VAR}" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      assert.throws(
        () => normalizeConfig(raw),
        /Missing required environment variable: MISSING_VAR/
      );
    });
  });

  describe("output structure", () => {
    test("preserves fileName in files array", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "my/config.json": { content: { key: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].fileName, "my/config.json");
    });

    test("output repos are independent (no shared references)", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: { key: "value" } } },
        repos: [
          {
            git: [
              "git@github.com:org/repo1.git",
              "git@github.com:org/repo2.git",
            ],
          },
        ],
      };

      const result = normalizeConfig(raw);

      // Modify one repo's content
      (result.repos[0].files[0].content as Record<string, unknown>).key =
        "modified";

      // Other repo should be unaffected
      assert.equal(
        (result.repos[1].files[0].content as Record<string, unknown>).key,
        "value"
      );
    });

    test("returns empty repos array when input has empty repos", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos, []);
    });
  });

  describe("multiple files with different strategies", () => {
    test("each file uses its own mergeStrategy", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "append.json": {
            content: { items: ["a"] },
            mergeStrategy: "append",
          },
          "replace.json": {
            content: { items: ["x"] },
            mergeStrategy: "replace",
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "append.json": { content: { items: ["b"] } },
              "replace.json": { content: { items: ["y"] } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      const appendFile = result.repos[0].files.find(
        (f) => f.fileName === "append.json"
      );
      const replaceFile = result.repos[0].files.find(
        (f) => f.fileName === "replace.json"
      );

      assert.deepEqual(
        (appendFile?.content as Record<string, unknown>)?.items,
        ["a", "b"]
      );
      assert.deepEqual(
        (replaceFile?.content as Record<string, unknown>)?.items,
        ["y"]
      );
    });
  });

  describe("createOnly propagation", () => {
    test("passes root-level createOnly: true to FileContent", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" }, createOnly: true },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].createOnly, true);
    });

    test("passes root-level createOnly: false to FileContent", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" }, createOnly: false },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].createOnly, false);
    });

    test("createOnly is undefined when not specified", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].createOnly, undefined);
    });

    test("per-repo createOnly overrides root-level", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" }, createOnly: true },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { createOnly: false },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].createOnly, false);
    });

    test("per-repo createOnly: true overrides undefined root", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { createOnly: true },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].createOnly, true);
    });

    test("different repos can have different createOnly values", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" }, createOnly: true },
        },
        repos: [
          { git: "git@github.com:org/repo1.git" },
          {
            git: "git@github.com:org/repo2.git",
            files: {
              "config.json": { createOnly: false },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      // repo1 inherits root createOnly: true
      assert.equal(result.repos[0].files[0].createOnly, true);
      // repo2 overrides to false
      assert.equal(result.repos[1].files[0].createOnly, false);
    });

    test("createOnly works with override mode", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { base: "value" } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": {
                createOnly: true,
                override: true,
                content: { only: "repo-value" },
              },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].createOnly, true);
      assert.deepEqual(result.repos[0].files[0].content, {
        only: "repo-value",
      });
    });
  });

  describe("empty file handling", () => {
    test("undefined content results in null FileContent", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".prettierignore": {},
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].content, null);
    });

    test("empty file with createOnly", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".prettierignore": { createOnly: true },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].content, null);
      assert.equal(result.repos[0].files[0].createOnly, true);
    });

    test("repo content merges into undefined root content", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": {},
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.yaml": { content: { key: "value" } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].content, { key: "value" });
    });

    test("repo text content merges into undefined root content", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": {},
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": { content: "node_modules\ndist" },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].content, "node_modules\ndist");
    });

    test("repo text array content merges into undefined root content", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": {},
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": { content: ["node_modules", "dist"] },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].content, [
        "node_modules",
        "dist",
      ]);
    });

    test("override with no content creates empty file", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": { content: { base: "value" } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.yaml": { override: true },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].content, null);
    });
  });

  describe("header normalization", () => {
    test("string header normalized to array", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": { content: {}, header: "Single comment" },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].header, ["Single comment"]);
    });

    test("array header passed through", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": { content: {}, header: ["Line 1", "Line 2"] },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].header, ["Line 1", "Line 2"]);
    });

    test("per-repo header overrides root header", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": { content: {}, header: "Root header" },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.yaml": { header: "Repo header" },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].header, ["Repo header"]);
    });

    test("header is undefined when not specified", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": { content: {} },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].header, undefined);
    });
  });

  describe("schemaUrl propagation", () => {
    test("root schemaUrl passed to FileContent", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": {
            content: {},
            schemaUrl: "https://example.com/schema.json",
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(
        result.repos[0].files[0].schemaUrl,
        "https://example.com/schema.json"
      );
    });

    test("per-repo schemaUrl overrides root", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": {
            content: {},
            schemaUrl: "https://root.com/schema.json",
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.yaml": { schemaUrl: "https://repo.com/schema.json" },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(
        result.repos[0].files[0].schemaUrl,
        "https://repo.com/schema.json"
      );
    });

    test("schemaUrl is undefined when not specified", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": { content: {} },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].schemaUrl, undefined);
    });

    test("empty file with schemaUrl", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.yaml": { schemaUrl: "https://example.com/schema.json" },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].content, null);
      assert.equal(
        result.repos[0].files[0].schemaUrl,
        "https://example.com/schema.json"
      );
    });
  });

  describe("type safety", () => {
    test("throws when merging text base with object overlay", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          ".gitignore": { content: "node_modules" }, // text content
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              ".gitignore": { content: { invalid: "object" } }, // object content - type mismatch
            },
          },
        ],
      };

      assert.throws(
        () => normalizeConfig(raw),
        /Expected text content for .gitignore, got object/
      );
    });
  });

  describe("prTemplate propagation", () => {
    test("prTemplate passed through to Config", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prTemplate: "## Custom Template\n\n${xfg:pr.fileChanges}",
      };

      const result = normalizeConfig(raw);
      assert.equal(
        result.prTemplate,
        "## Custom Template\n\n${xfg:pr.fileChanges}"
      );
    });

    test("missing prTemplate results in undefined", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.prTemplate, undefined);
    });
  });

  describe("executable propagation", () => {
    test("passes root-level executable: true to FileContent", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "deploy.sh": { content: "#!/bin/bash", executable: true },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].executable, true);
    });

    test("passes root-level executable: false to FileContent", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "script.sh": { content: "#!/bin/bash", executable: false },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].executable, false);
    });

    test("executable is undefined when not specified", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].executable, undefined);
    });

    test("per-repo executable overrides root-level", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "script.sh": { content: "#!/bin/bash", executable: true },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "script.sh": { executable: false },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].executable, false);
    });

    test("per-repo executable: true overrides undefined root", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          run: { content: "#!/bin/bash" },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              run: { executable: true },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].executable, true);
    });

    test("different repos can have different executable values", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "script.sh": { content: "#!/bin/bash", executable: true },
        },
        repos: [
          { git: "git@github.com:org/repo1.git" },
          {
            git: "git@github.com:org/repo2.git",
            files: {
              "script.sh": { executable: false },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].executable, true);
      assert.equal(result.repos[1].files[0].executable, false);
    });
  });

  describe("template propagation", () => {
    test("template: true from root is propagated", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "README.md": { content: "# ${xfg:repo.name}", template: true },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].template, true);
    });

    test("template is undefined when not specified", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].template, undefined);
    });

    test("per-repo template overrides root-level", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: {}, template: true },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { template: false },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].template, false);
    });

    test("per-repo template: true overrides undefined root", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: {} },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { template: true },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].template, true);
    });

    test("different repos can have different template values", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "README.md": { content: "# ${xfg:repo.name}", template: true },
        },
        repos: [
          { git: "git@github.com:org/repo1.git" },
          {
            git: "git@github.com:org/repo2.git",
            files: {
              "README.md": { template: false },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].template, true);
      assert.equal(result.repos[1].files[0].template, false);
    });
  });

  describe("vars merging", () => {
    test("root-level vars are propagated", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": {
            content: {},
            template: true,
            vars: { env: "prod", region: "us-east-1" },
          },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].vars, {
        env: "prod",
        region: "us-east-1",
      });
    });

    test("vars is undefined when not specified", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: {}, template: true },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].vars, undefined);
    });

    test("per-repo vars merge with root-level vars", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": {
            content: {},
            template: true,
            vars: { env: "prod", region: "us-east-1" },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { vars: { cluster: "main" } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].vars, {
        env: "prod",
        region: "us-east-1",
        cluster: "main",
      });
    });

    test("per-repo vars override root-level vars for same key", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": {
            content: {},
            template: true,
            vars: { env: "prod", region: "us-east-1" },
          },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { vars: { env: "staging" } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].vars, {
        env: "staging",
        region: "us-east-1",
      });
    });

    test("per-repo vars only (no root vars)", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: {}, template: true },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { vars: { env: "dev" } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].vars, { env: "dev" });
    });

    test("different repos can have different vars", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": {
            content: {},
            template: true,
            vars: { env: "prod" },
          },
        },
        repos: [
          { git: "git@github.com:org/repo1.git" },
          {
            git: "git@github.com:org/repo2.git",
            files: {
              "config.json": { vars: { env: "staging", region: "eu-west-1" } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].files[0].vars, { env: "prod" });
      assert.deepEqual(result.repos[1].files[0].vars, {
        env: "staging",
        region: "eu-west-1",
      });
    });
  });

  describe("deleteOrphaned propagation", () => {
    test("global deleteOrphaned: true propagates to all files", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" } },
          "settings.yaml": { content: { enabled: true } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
        deleteOrphaned: true,
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].deleteOrphaned, true);
      assert.equal(result.repos[0].files[1].deleteOrphaned, true);
      assert.equal(result.deleteOrphaned, true);
    });

    test("deleteOrphaned is undefined when not specified", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].deleteOrphaned, undefined);
      assert.equal(result.deleteOrphaned, undefined);
    });

    test("per-file deleteOrphaned overrides global default", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" }, deleteOrphaned: true },
          "settings.yaml": { content: { enabled: true } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
        deleteOrphaned: false,
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].deleteOrphaned, true);
      assert.equal(result.repos[0].files[1].deleteOrphaned, false);
    });

    test("per-repo deleteOrphaned overrides per-file and global", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" }, deleteOrphaned: true },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { deleteOrphaned: false },
            },
          },
        ],
        deleteOrphaned: true,
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].deleteOrphaned, false);
    });

    test("different repos can have different deleteOrphaned values", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" }, deleteOrphaned: true },
        },
        repos: [
          { git: "git@github.com:org/repo1.git" },
          {
            git: "git@github.com:org/repo2.git",
            files: {
              "config.json": { deleteOrphaned: false },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      // repo1 inherits per-file deleteOrphaned: true
      assert.equal(result.repos[0].files[0].deleteOrphaned, true);
      // repo2 overrides to false
      assert.equal(result.repos[1].files[0].deleteOrphaned, false);
    });

    test("per-repo deleteOrphaned: true overrides undefined per-file and global", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" } },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": { deleteOrphaned: true },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].deleteOrphaned, true);
    });

    test("deleteOrphaned works with file exclusion", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "config.json": { content: { key: "value" }, deleteOrphaned: true },
          "settings.yaml": { content: { enabled: true }, deleteOrphaned: true },
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "config.json": false, // excluded
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      // Only settings.yaml should be included
      assert.equal(result.repos[0].files.length, 1);
      assert.equal(result.repos[0].files[0].fileName, "settings.yaml");
      assert.equal(result.repos[0].files[0].deleteOrphaned, true);
    });

    test("inheritance order: per-repo > per-file > global", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {
          "file1.json": { content: {} }, // inherits global
          "file2.json": { content: {}, deleteOrphaned: false }, // per-file overrides global
          "file3.json": { content: {}, deleteOrphaned: true }, // per-file overrides global
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "file2.json": { deleteOrphaned: true }, // per-repo overrides per-file
              "file3.json": { deleteOrphaned: false }, // per-repo overrides per-file
            },
          },
        ],
        deleteOrphaned: true, // global default
      };

      const result = normalizeConfig(raw);
      const files = result.repos[0].files;
      const file1 = files.find((f) => f.fileName === "file1.json");
      const file2 = files.find((f) => f.fileName === "file2.json");
      const file3 = files.find((f) => f.fileName === "file3.json");

      assert.equal(file1?.deleteOrphaned, true); // from global
      assert.equal(file2?.deleteOrphaned, true); // per-repo overrides per-file false
      assert.equal(file3?.deleteOrphaned, false); // per-repo overrides per-file true
    });
  });

  describe("settings merging", () => {
    test("root settings are propagated to repos", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      };

      const result = normalizeConfig(raw);
      assert.deepEqual(result.repos[0].settings?.rulesets?.["pr-rules"], {
        target: "branch",
        enforcement: "active",
      });
    });

    test("per-repo settings override root settings", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  enforcement: "disabled",
                },
              },
            },
          },
        ],
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      };

      const result = normalizeConfig(raw);
      // enforcement should be overridden, target inherited
      assert.equal(
        result.repos[0].settings?.rulesets?.["pr-rules"]?.enforcement,
        "disabled"
      );
      assert.equal(
        result.repos[0].settings?.rulesets?.["pr-rules"]?.target,
        "branch"
      );
    });

    test("deep merges ruleset rules array", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  rules: [{ type: "required_signatures" }],
                },
              },
            },
          },
        ],
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              rules: [
                {
                  type: "pull_request",
                  parameters: { requiredApprovingReviewCount: 1 },
                },
              ],
            },
          },
        },
      };

      const result = normalizeConfig(raw);
      // Per-repo rules array should replace root rules array (not merge)
      assert.equal(
        result.repos[0].settings?.rulesets?.["pr-rules"]?.rules?.length,
        1
      );
      assert.equal(
        result.repos[0].settings?.rulesets?.["pr-rules"]?.rules?.[0]?.type,
        "required_signatures"
      );
    });

    test("deep merges pull_request rule parameters", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  rules: [
                    {
                      type: "pull_request",
                      parameters: { requiredApprovingReviewCount: 3 },
                    },
                  ],
                },
              },
            },
          },
        ],
        settings: {
          rulesets: {
            "pr-rules": {
              rules: [
                {
                  type: "pull_request",
                  parameters: {
                    requiredApprovingReviewCount: 1,
                    dismissStaleReviewsOnPush: true,
                  },
                },
              ],
            },
          },
        },
      };

      const result = normalizeConfig(raw);
      // Per-repo rules replace root rules entirely
      const prRule =
        result.repos[0].settings?.rulesets?.["pr-rules"]?.rules?.[0];
      assert.equal(prRule?.type, "pull_request");
      const params = prRule?.parameters as
        | PullRequestRuleParameters
        | undefined;
      assert.equal(params?.requiredApprovingReviewCount, 3);
    });

    test("different repos can have different settings", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          { git: "git@github.com:org/repo1.git" },
          {
            git: "git@github.com:org/repo2.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  enforcement: "disabled",
                },
              },
            },
          },
        ],
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      };

      const result = normalizeConfig(raw);
      // repo1 inherits root settings
      assert.equal(
        result.repos[0].settings?.rulesets?.["pr-rules"]?.enforcement,
        "active"
      );
      // repo2 overrides enforcement
      assert.equal(
        result.repos[1].settings?.rulesets?.["pr-rules"]?.enforcement,
        "disabled"
      );
    });

    test("per-repo can add new rulesets not in root", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "release-rules": {
                  target: "tag",
                  enforcement: "active",
                },
              },
            },
          },
        ],
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              enforcement: "active",
            },
          },
        },
      };

      const result = normalizeConfig(raw);
      // Both rulesets should exist
      assert.ok(result.repos[0].settings?.rulesets?.["pr-rules"]);
      assert.ok(result.repos[0].settings?.rulesets?.["release-rules"]);
    });

    test("settings.deleteOrphaned: per-repo overrides root", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              deleteOrphaned: false,
            },
          },
        ],
        settings: {
          deleteOrphaned: true,
        },
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].settings?.deleteOrphaned, false);
    });

    test("settings is undefined when no settings defined", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].settings, undefined);
    });

    test("git array expansion preserves settings for each repo", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: [
              "git@github.com:org/repo1.git",
              "git@github.com:org/repo2.git",
            ],
            settings: {
              rulesets: {
                "pr-rules": {
                  target: "branch",
                },
              },
            },
          },
        ],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos.length, 2);
      assert.deepEqual(result.repos[0].settings, result.repos[1].settings);
    });

    test("merged settings do not share references", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          { git: "git@github.com:org/repo1.git" },
          { git: "git@github.com:org/repo2.git" },
        ],
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              bypassActors: [{ actorId: 123, actorType: "Team" }],
            },
          },
        },
      };

      const result = normalizeConfig(raw);
      // Modify repo1's settings
      result.repos[0].settings!.rulesets!["pr-rules"]!.bypassActors!.push({
        actorId: 456,
        actorType: "User",
      });

      // repo2 should be unaffected
      assert.equal(
        result.repos[1].settings?.rulesets?.["pr-rules"]?.bypassActors?.length,
        1
      );
    });
  });

  describe("inheritance opt-out", () => {
    describe("files inherit: false", () => {
      test("inherit: false skips all root files", () => {
        const raw: RawConfig = {
          id: "test-config",
          files: {
            "eslint.json": { content: { extends: ["base"] } },
            "prettier.json": { content: { semi: true } },
          },
          repos: [
            {
              git: "git@github.com:org/repo.git",
              files: {
                inherit: false,
              },
            },
          ],
        };

        const result = normalizeConfig(raw);
        assert.equal(result.repos[0].files.length, 0);
      });

      test("inherit: false with custom file includes only custom", () => {
        const raw: RawConfig = {
          id: "test-config",
          files: {
            "eslint.json": { content: { extends: ["base"] } },
            "custom.json": { content: {} },
          },
          repos: [
            {
              git: "git@github.com:org/repo.git",
              files: {
                inherit: false,
                "custom.json": { content: { custom: true } },
              },
            },
          ],
        };

        const result = normalizeConfig(raw);
        assert.equal(result.repos[0].files.length, 1);
        assert.equal(result.repos[0].files[0].fileName, "custom.json");
        assert.deepEqual(result.repos[0].files[0].content, { custom: true });
      });

      test("inherit: true is same as not specifying", () => {
        const raw: RawConfig = {
          id: "test-config",
          files: {
            "eslint.json": { content: { extends: ["base"] } },
          },
          repos: [
            {
              git: "git@github.com:org/repo.git",
              files: {
                inherit: true,
              },
            },
          ],
        };

        const result = normalizeConfig(raw);
        assert.equal(result.repos[0].files.length, 1);
        assert.equal(result.repos[0].files[0].fileName, "eslint.json");
      });
    });

    describe("rulesets opt-out", () => {
      test("rulesetName: false excludes single ruleset", () => {
        const raw: RawConfig = {
          id: "test-config",
          files: { "config.json": { content: {} } },
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
          settings: {
            rulesets: {
              "main-protection": { target: "branch", enforcement: "active" },
              "release-protection": { target: "branch", enforcement: "active" },
            },
          },
        };

        const result = normalizeConfig(raw);
        assert.ok(result.repos[0].settings?.rulesets);
        assert.equal(
          result.repos[0].settings?.rulesets?.["main-protection"],
          undefined
        );
        assert.ok(result.repos[0].settings?.rulesets?.["release-protection"]);
      });

      test("rulesets inherit: false skips all root rulesets", () => {
        const raw: RawConfig = {
          id: "test-config",
          files: { "config.json": { content: {} } },
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
          settings: {
            rulesets: {
              "main-protection": { target: "branch" },
              "release-protection": { target: "branch" },
            },
          },
        };

        const result = normalizeConfig(raw);
        assert.equal(result.repos[0].settings?.rulesets, undefined);
      });

      test("rulesets inherit: false with custom ruleset includes only custom", () => {
        const raw: RawConfig = {
          id: "test-config",
          files: { "config.json": { content: {} } },
          repos: [
            {
              git: "git@github.com:org/repo.git",
              settings: {
                rulesets: {
                  inherit: false,
                  "custom-ruleset": { target: "tag", enforcement: "active" },
                },
              },
            },
          ],
          settings: {
            rulesets: {
              "main-protection": { target: "branch" },
            },
          },
        };

        const result = normalizeConfig(raw);
        assert.ok(result.repos[0].settings?.rulesets);
        assert.equal(
          result.repos[0].settings?.rulesets?.["main-protection"],
          undefined
        );
        assert.ok(result.repos[0].settings?.rulesets?.["custom-ruleset"]);
        assert.equal(
          result.repos[0].settings?.rulesets?.["custom-ruleset"]?.target,
          "tag"
        );
      });

      test("rulesets inherit: true is same as not specifying", () => {
        const raw: RawConfig = {
          id: "test-config",
          files: { "config.json": { content: {} } },
          repos: [
            {
              git: "git@github.com:org/repo.git",
              settings: {
                rulesets: {
                  inherit: true,
                },
              },
            },
          ],
          settings: {
            rulesets: {
              "main-protection": { target: "branch" },
            },
          },
        };

        const result = normalizeConfig(raw);
        assert.ok(result.repos[0].settings?.rulesets?.["main-protection"]);
      });
    });
  });

  describe("repo settings opt-out", () => {
    test("repo: false excludes all root repo settings", () => {
      const raw: RawConfig = {
        id: "test-config",
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
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].settings?.repo, undefined);
    });

    test("repo: false still allows rulesets to be inherited", () => {
      const raw: RawConfig = {
        id: "test-config",
        settings: {
          repo: {
            hasIssues: true,
          },
          rulesets: {
            "main-protection": { target: "branch", enforcement: "active" },
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
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].settings?.repo, undefined);
      assert.ok(result.repos[0].settings?.rulesets?.["main-protection"]);
    });
  });
});

describe("mergeSettings with repo", () => {
  test("should merge root and per-repo repo settings", () => {
    const root = {
      repo: {
        hasIssues: true,
        hasWiki: true,
      },
    };
    const perRepo = {
      repo: {
        hasWiki: false,
        allowSquashMerge: true,
      },
    };
    const result = mergeSettings(root, perRepo);
    assert.deepEqual(result?.repo, {
      hasIssues: true,
      hasWiki: false,
      allowSquashMerge: true,
    });
  });

  test("should use only root repo settings when no per-repo override", () => {
    const root = {
      repo: {
        hasIssues: true,
      },
    };
    const result = mergeSettings(root, undefined);
    assert.deepEqual(result?.repo, { hasIssues: true });
  });

  test("should use only per-repo repo settings when no root", () => {
    const perRepo = {
      repo: {
        hasIssues: false,
      },
    };
    const result = mergeSettings(undefined, perRepo);
    assert.deepEqual(result?.repo, { hasIssues: false });
  });

  test("should merge both rulesets and repo settings", () => {
    const root = {
      rulesets: {
        "main-protection": { target: "branch" as const },
      },
      repo: {
        hasIssues: true,
      },
    };
    const perRepo = {
      repo: {
        hasWiki: false,
      },
    };
    const result = mergeSettings(root, perRepo);
    assert.ok(result?.rulesets?.["main-protection"]);
    assert.deepEqual(result?.repo, {
      hasIssues: true,
      hasWiki: false,
    });
  });

  test("should return no repo settings when per-repo repo is false", () => {
    const root: RawRepoSettings = {
      repo: {
        hasIssues: true,
        hasWiki: true,
      },
    };
    const perRepo: RawRepoSettings = {
      repo: false,
    };
    const result = mergeSettings(root, perRepo);
    assert.equal(result?.repo, undefined);
  });

  test("should return no repo settings when per-repo repo is false even without root", () => {
    const perRepo: RawRepoSettings = {
      repo: false,
    };
    const result = mergeSettings(undefined, perRepo);
    assert.equal(result?.repo, undefined);
  });
});
