import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  normalizeConfig,
  mergeSettings,
} from "../../../src/config/normalizer.js";
import type {
  RawConfig,
  RawRepoConfig,
  RawRepoFileOverride,
  RawFileConfig,
  RawRepoSettings,
  RawRootSettings,
  PullRequestRuleParameters,
} from "../../../src/config/index.js";

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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);

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

      const result = normalizeConfig(raw, process.env);

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

      const result = normalizeConfig(raw, process.env);

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

      const result = normalizeConfig(raw, process.env);

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

      const result = normalizeConfig(raw, process.env);

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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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
                  items: { $arrayMerge: "append", $values: ["b"] },
                },
              },
            },
          },
        ],
      };

      const result = normalizeConfig(raw, process.env);
      const jsonStr = JSON.stringify(result.repos[0].files[0].content);
      assert.ok(!jsonStr.includes("$arrayMerge"));
      assert.ok(!jsonStr.includes("$values"));
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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
        () => normalizeConfig(raw, process.env),
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);

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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
      assert.equal(result.repos[0].files[0].content, null);
      assert.equal(
        result.repos[0].files[0].schemaUrl,
        "https://example.com/schema.json"
      );
    });
  });

  describe("type safety", () => {
    test("overlay wins when merging text base with object overlay", () => {
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

      const result = normalizeConfig(raw, process.env);
      const repo = result.repos[0];
      const file = repo.files.find((f) => f.fileName === ".gitignore");
      assert.deepEqual(file?.content, { invalid: "object" });
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
      assert.equal(result.repos[0].settings?.deleteOrphaned, false);
    });

    test("settings is undefined when no settings defined", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

    // $arrayMerge: directive with no base resolves to $values
    // (uses `as never` because TypeScript types don't include directive shape yet)
    test("$arrayMerge directive with no base resolves to $values", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  target: "branch",
                  bypassActors: {
                    $arrayMerge: "append",
                    $values: [
                      {
                        actorId: 9999,
                        actorType: "Integration",
                        bypassMode: "always",
                      },
                    ],
                  } as never,
                },
              },
            },
          },
        ],
      };

      const result = normalizeConfig(raw, process.env);
      const actors =
        result.repos[0].settings?.rulesets?.["pr-rules"]?.bypassActors;
      assert.equal(actors?.length, 1);
      assert.equal(actors?.[0]?.actorId, 9999);
    });

    test("$arrayMerge: prepend on rules prepends per-repo to root", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  rules: {
                    $arrayMerge: "prepend",
                    $values: [{ type: "required_signatures" }],
                  } as never,
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

      const result = normalizeConfig(raw, process.env);
      const rules = result.repos[0].settings?.rulesets?.["pr-rules"]?.rules;
      assert.equal(rules?.length, 2);
      assert.equal(rules?.[0]?.type, "required_signatures");
      assert.equal(rules?.[1]?.type, "pull_request");
    });

    test("$arrayMerge: append on conditions.refName.include", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
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
          },
        ],
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              conditions: {
                refName: {
                  include: ["refs/heads/main"],
                  exclude: [],
                },
              },
            },
          },
        },
      };

      const result = normalizeConfig(raw, process.env);
      const include =
        result.repos[0].settings?.rulesets?.["pr-rules"]?.conditions?.refName
          ?.include;
      assert.deepEqual(include, ["refs/heads/main", "refs/heads/develop"]);
    });

    test("$arrayMerge: append on bypassActors appends per-repo to root", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  bypassActors: {
                    $arrayMerge: "append",
                    $values: [
                      {
                        actorId: 9999,
                        actorType: "Integration",
                        bypassMode: "always",
                      },
                    ],
                  } as never,
                },
              },
            },
          },
        ],
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              bypassActors: [
                {
                  actorId: 2740,
                  actorType: "Integration",
                  bypassMode: "always",
                },
              ],
            },
          },
        },
      };

      const result = normalizeConfig(raw, process.env);
      const actors =
        result.repos[0].settings?.rulesets?.["pr-rules"]?.bypassActors;
      assert.equal(actors?.length, 2);
      assert.equal(actors?.[0]?.actorId, 2740);
      assert.equal(actors?.[1]?.actorId, 9999);
    });

    test("$arrayMerge: replace behaves same as default array replacement", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  rules: {
                    $arrayMerge: "replace",
                    $values: [{ type: "required_signatures" }],
                  } as never,
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

      const result = normalizeConfig(raw, process.env);
      const rules = result.repos[0].settings?.rulesets?.["pr-rules"]?.rules;
      assert.equal(rules?.length, 1);
      assert.equal(rules?.[0]?.type, "required_signatures");
    });

    test("different $arrayMerge strategies on sibling arrays in same ruleset", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: {} } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            settings: {
              rulesets: {
                "pr-rules": {
                  bypassActors: {
                    $arrayMerge: "append",
                    $values: [
                      {
                        actorId: 9999,
                        actorType: "Integration",
                        bypassMode: "always",
                      },
                    ],
                  } as never,
                  rules: {
                    $arrayMerge: "prepend",
                    $values: [{ type: "required_signatures" }],
                  } as never,
                },
              },
            },
          },
        ],
        settings: {
          rulesets: {
            "pr-rules": {
              target: "branch",
              bypassActors: [
                {
                  actorId: 2740,
                  actorType: "Integration",
                  bypassMode: "always",
                },
              ],
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

      const result = normalizeConfig(raw, process.env);
      const actors =
        result.repos[0].settings?.rulesets?.["pr-rules"]?.bypassActors;
      const rules = result.repos[0].settings?.rulesets?.["pr-rules"]?.rules;
      // bypassActors: append
      assert.equal(actors?.length, 2);
      assert.equal(actors?.[0]?.actorId, 2740);
      assert.equal(actors?.[1]?.actorId, 9999);
      // rules: prepend
      assert.equal(rules?.length, 2);
      assert.equal(rules?.[0]?.type, "required_signatures");
      assert.equal(rules?.[1]?.type, "pull_request");
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

        const result = normalizeConfig(raw, process.env);
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

        const result = normalizeConfig(raw, process.env);
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
              } as RawRepoConfig["files"],
            },
          ],
        };

        const result = normalizeConfig(raw, process.env);
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

        const result = normalizeConfig(raw, process.env);
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

        const result = normalizeConfig(raw, process.env);
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

        const result = normalizeConfig(raw, process.env);
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
                } as RawRepoSettings["rulesets"],
              },
            },
          ],
          settings: {
            rulesets: {
              "main-protection": { target: "branch" },
            },
          },
        };

        const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
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

      const result = normalizeConfig(raw, process.env);
      assert.equal(result.repos[0].settings?.repo, undefined);
      assert.ok(result.repos[0].settings?.rulesets?.["main-protection"]);
    });
  });
});

describe("normalizeConfig - lifecycle fields", () => {
  test("preserves upstream field", () => {
    const rawConfig: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/forked-tool.git",
          upstream: "git@github.com:opensource/cool-tool.git",
        },
      ],
    };

    const config = normalizeConfig(rawConfig, process.env);

    assert.equal(
      config.repos[0].upstream,
      "git@github.com:opensource/cool-tool.git"
    );
  });

  test("preserves source field", () => {
    const rawConfig: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: "git@github.com:my-org/migrated-app.git",
          source: "https://dev.azure.com/org/project/_git/legacy-app",
        },
      ],
    };

    const config = normalizeConfig(rawConfig, process.env);

    assert.equal(
      config.repos[0].source,
      "https://dev.azure.com/org/project/_git/legacy-app"
    );
  });

  test("expands git array with upstream on each", () => {
    const rawConfig: RawConfig = {
      id: "test",
      files: { "test.txt": { content: "test" } },
      repos: [
        {
          git: [
            "git@github.com:my-org/fork1.git",
            "git@github.com:my-org/fork2.git",
          ],
          upstream: "git@github.com:opensource/tool.git",
        },
      ],
    };

    const config = normalizeConfig(rawConfig, process.env);

    assert.equal(config.repos.length, 2);
    assert.equal(
      config.repos[0].upstream,
      "git@github.com:opensource/tool.git"
    );
    assert.equal(
      config.repos[1].upstream,
      "git@github.com:opensource/tool.git"
    );
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

  // Labels merge tests
  test("mergeSettings merges root and per-repo labels (per-repo overrides root color)", () => {
    const root: RawRepoSettings = {
      labels: {
        bug: { color: "d73a4a", description: "Something isn't working" },
      },
    };
    const perRepo: RawRepoSettings = {
      labels: {
        bug: { color: "ff0000" },
      },
    };
    const result = mergeSettings(root, perRepo);
    assert.equal(result?.labels?.bug.color, "ff0000");
    assert.equal(result?.labels?.bug.description, "Something isn't working");
  });

  test("mergeSettings handles inherit: false for labels", () => {
    const root: RawRepoSettings = {
      labels: {
        bug: { color: "d73a4a" },
        feature: { color: "0e8a16" },
      },
    };
    const perRepo: RawRepoSettings = {
      labels: {
        inherit: false,
        custom: { color: "aaaaaa" },
      },
    };
    const result = mergeSettings(root, perRepo);
    assert.equal(result?.labels?.bug, undefined);
    assert.equal(result?.labels?.feature, undefined);
    assert.ok(result?.labels?.custom);
  });

  test("mergeSettings handles individual label opt-out (label: false)", () => {
    const root: RawRepoSettings = {
      labels: {
        bug: { color: "d73a4a" },
        feature: { color: "0e8a16" },
      },
    };
    const perRepo: RawRepoSettings = {
      labels: {
        bug: false,
      },
    };
    const result = mergeSettings(root, perRepo);
    assert.equal(result?.labels?.bug, undefined);
    assert.ok(result?.labels?.feature);
  });

  test("mergeSettings per-repo label overrides root label properties", () => {
    const root: RawRepoSettings = {
      labels: {
        bug: { color: "d73a4a", description: "Old desc" },
      },
    };
    const perRepo: RawRepoSettings = {
      labels: {
        bug: { color: "d73a4a", description: "New desc" },
      },
    };
    const result = mergeSettings(root, perRepo);
    assert.equal(result?.labels?.bug.description, "New desc");
  });

  test("normalizeConfig strips # from label color values during normalization", () => {
    const raw: RawConfig = {
      id: "test",
      settings: {
        labels: {
          bug: { color: "#D73A4A" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    const config = normalizeConfig(raw, process.env);
    assert.equal(config.repos[0].settings?.labels?.bug.color, "d73a4a");
  });

  test("root labels are preserved in Config.settings.labels", () => {
    const raw: RawConfig = {
      id: "test",
      settings: {
        labels: {
          bug: { color: "#D73A4A", description: "Something isn't working" },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };
    const config = normalizeConfig(raw, process.env);
    assert.equal(config.settings?.labels?.bug.color, "d73a4a");
    assert.equal(
      config.settings?.labels?.bug.description,
      "Something isn't working"
    );
  });

  test("per-repo-only labels appear without root labels", () => {
    const raw: RawConfig = {
      id: "test",
      repos: [
        {
          git: "git@github.com:org/repo.git",
          settings: {
            labels: {
              custom: { color: "aaaaaa" },
            },
          },
        },
      ],
    };
    const config = normalizeConfig(raw, process.env);
    assert.ok(config.repos[0].settings?.labels?.custom);
    assert.equal(config.repos[0].settings?.labels?.custom.color, "aaaaaa");
  });

  describe("PR options merging", () => {
    test("global labels propagate to repo", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prOptions: {
          labels: ["config-sync", "automated"],
        },
      };

      const result = normalizeConfig(raw, process.env);
      assert.deepEqual(result.repos[0].prOptions?.labels, [
        "config-sync",
        "automated",
      ]);
    });

    test("per-repo labels replace global labels", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: { key: "value" } } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            prOptions: {
              labels: ["critical-config"],
            },
          },
        ],
        prOptions: {
          labels: ["config-sync", "automated"],
        },
      };

      const result = normalizeConfig(raw, process.env);
      assert.deepEqual(result.repos[0].prOptions?.labels, ["critical-config"]);
    });

    test("per-repo empty labels array clears global labels", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: { key: "value" } } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            prOptions: {
              labels: [],
            },
          },
        ],
        prOptions: {
          labels: ["config-sync"],
        },
      };

      const result = normalizeConfig(raw, process.env);
      assert.deepEqual(result.repos[0].prOptions?.labels, []);
    });

    test("repo without labels inherits global labels", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "config.json": { content: { key: "value" } } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            prOptions: {
              merge: "manual",
            },
          },
        ],
        prOptions: {
          labels: ["config-sync"],
          merge: "auto",
        },
      };

      const result = normalizeConfig(raw, process.env);
      assert.deepEqual(result.repos[0].prOptions?.labels, ["config-sync"]);
      assert.equal(result.repos[0].prOptions?.merge, "manual");
    });
  });
});

describe("group configuration", () => {
  test("repo with no groups behaves identically to before", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          files: {
            "config.json": { content: { extra: true } },
          },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos.length, 1);
    assert.equal(result.repos[0].files.length, 1);
    assert.deepStrictEqual(result.repos[0].files[0].content, {
      key: "value",
      extra: true,
    });
  });

  test("single group merges files onto root", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "root.json": { content: { fromRoot: true } },
      },
      groups: {
        mygroup: {
          files: {
            "group.json": { content: { fromGroup: true } },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos.length, 1);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("root.json"));
    assert.ok(fileNames.includes("group.json"));
  });

  test("multiple groups merge left-to-right, later wins", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "root.json": { content: { fromRoot: true } },
      },
      groups: {
        groupA: {
          files: { "shared.json": { content: { source: "A" } } },
        },
        groupB: {
          files: { "shared.json": { content: { source: "B" } } },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["groupA", "groupB"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const shared = result.repos[0].files.find(
      (f) => f.fileName === "shared.json"
    );
    assert.deepStrictEqual(shared?.content, { source: "B" });
  });

  test("repo overrides group file", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { base: true } },
      },
      groups: {
        mygroup: {
          files: {
            "config.json": { content: { fromGroup: true } },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          files: {
            "config.json": { content: { fromRepo: true } },
          },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files.find(
      (f) => f.fileName === "config.json"
    );
    // Deep merge: root → group → repo
    assert.equal((config?.content as Record<string, unknown>).base, true);
    assert.equal((config?.content as Record<string, unknown>).fromGroup, true);
    assert.equal((config?.content as Record<string, unknown>).fromRepo, true);
  });

  test("group inherit:false discards root files", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "root.json": { content: { fromRoot: true } },
      },
      groups: {
        mygroup: {
          files: {
            inherit: false,
            "group.json": { content: { fromGroup: true } },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(!fileNames.includes("root.json"));
    assert.ok(fileNames.includes("group.json"));
  });

  test("repo inherit:false discards root and group files", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "root.json": { content: { fromRoot: true } },
      },
      groups: {
        mygroup: {
          files: {
            "group.json": { content: { fromGroup: true } },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          files: {
            inherit: false,
            "repo.json": { content: { fromRepo: true } },
          } as unknown as NonNullable<RawRepoConfig["files"]>,
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    // With inherit:false on repo and no root definition of repo.json,
    // the repo file won't appear (it needs a root definition to be processed).
    // This test verifies root and group files are excluded.
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(!fileNames.includes("root.json"));
    assert.ok(!fileNames.includes("group.json"));
  });

  test("group file:false excludes a root file", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "keep.json": { content: { keep: true } },
        "remove.json": { content: { remove: true } },
      },
      groups: {
        mygroup: {
          files: {
            "remove.json": false,
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("keep.json"));
    assert.ok(!fileNames.includes("remove.json"));
  });

  test("repo file:false excludes a group file", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        mygroup: {
          files: {
            "group.json": { content: { fromGroup: true } },
            "other.json": { content: { other: true } },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          files: {
            "group.json": false,
          },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(!fileNames.includes("group.json"));
    assert.ok(fileNames.includes("other.json"));
  });

  test("git array expansion with groups", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        mygroup: {
          files: {
            "group.json": { content: { fromGroup: true } },
          },
        },
      },
      repos: [
        {
          git: ["git@github.com:org/repo1.git", "git@github.com:org/repo2.git"],
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos.length, 2);
    assert.equal(result.repos[0].files.length, 1);
    assert.equal(result.repos[1].files.length, 1);
    assert.equal(result.repos[0].files[0].fileName, "group.json");
    assert.equal(result.repos[1].files[0].fileName, "group.json");
  });

  test("no groups field on repo behaves identically", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      repos: [{ git: "git@github.com:org/repo.git" }],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos.length, 1);
    assert.equal(result.repos[0].files.length, 1);
    assert.deepStrictEqual(result.repos[0].files[0].content, { key: "value" });
  });

  test("empty groups array behaves identically", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: [],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].files.length, 1);
    assert.deepStrictEqual(result.repos[0].files[0].content, { key: "value" });
  });

  test("override:true at group level replaces root file content", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { fromRoot: true, shared: "root" } },
      },
      groups: {
        mygroup: {
          files: {
            "config.json": {
              content: { fromGroup: true },
              override: true,
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files[0];
    assert.deepStrictEqual(config.content, { fromGroup: true });
  });

  test("override:true at repo level replaces group file content", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { fromRoot: true } },
      },
      groups: {
        mygroup: {
          files: {
            "config.json": {
              content: { fromGroup: true, shared: "group" },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          files: {
            "config.json": {
              content: { fromRepo: true },
              override: true,
            },
          },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files[0];
    // override:true at repo level replaces all accumulated content (root + group)
    assert.deepStrictEqual(config.content, { fromRepo: true });
  });

  test("group prOptions merge into chain", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      prOptions: { merge: "auto" },
      groups: {
        mygroup: {
          prOptions: { labels: ["from-group"] },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.merge, "auto");
    assert.deepStrictEqual(result.repos[0].prOptions?.labels, ["from-group"]);
  });

  test("group settings merge into chain", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          "base-protection": {
            target: "branch",
            enforcement: "active",
          },
        },
      },
      groups: {
        mygroup: {
          settings: {
            rulesets: {
              "group-protection": {
                target: "branch",
                enforcement: "active",
              },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.ok(result.repos[0].settings?.rulesets?.["base-protection"]);
    assert.ok(result.repos[0].settings?.rulesets?.["group-protection"]);
  });

  test("group settings.rulesets.inherit:false discards accumulated rulesets", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          "root-protection": {
            target: "branch",
            enforcement: "active",
          },
        },
      },
      groups: {
        mygroup: {
          settings: {
            rulesets: {
              inherit: false,
              "group-only-protection": {
                target: "branch",
                enforcement: "active",
              },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    // Group's inherit:false discards root rulesets
    assert.ok(!result.repos[0].settings?.rulesets?.["root-protection"]);
    assert.ok(result.repos[0].settings?.rulesets?.["group-only-protection"]);
  });

  test("should allow group to override non-content file properties", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "script.sh": { content: "#!/bin/bash\necho hello", executable: false },
      },
      groups: {
        mygroup: {
          files: {
            "script.sh": {
              content: "#!/bin/bash\necho hello",
              executable: true,
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const script = result.repos[0].files.find(
      (f) => f.fileName === "script.sh"
    );
    assert.equal(script?.executable, true);
  });

  test("repo prOptions override group prOptions", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      groups: {
        mygroup: {
          prOptions: { merge: "auto", labels: ["from-group"] },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          prOptions: { merge: "force" },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.merge, "force");
    assert.deepStrictEqual(result.repos[0].prOptions?.labels, ["from-group"]);
  });

  test("group with no files is skipped in mergeGroupFiles", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "root.json": { content: { fromRoot: true } },
      },
      groups: {
        emptyGroup: {},
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["emptyGroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].files.length, 1);
    assert.equal(result.repos[0].files[0].fileName, "root.json");
  });

  test("group file with undefined value is skipped", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "root.json": { content: { fromRoot: true } },
      },
      groups: {
        mygroup: {
          files: {
            "undef.json": undefined as unknown as RawFileConfig,
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("root.json"));
    assert.ok(!fileNames.includes("undef.json"));
  });

  test("group merges text array content onto root text array content", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "script.sh": {
          content: ["#!/bin/bash", "echo root"],
          mergeStrategy: "append",
        },
      },
      groups: {
        mygroup: {
          files: {
            "script.sh": {
              content: ["echo group"],
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const script = result.repos[0].files.find(
      (f) => f.fileName === "script.sh"
    );
    // text array + text array with append = concatenation
    assert.ok(Array.isArray(script?.content));
    const lines = script?.content as string[];
    assert.ok(lines.includes("echo root"));
    assert.ok(lines.includes("echo group"));
  });

  test("group merges string text content onto root (string overlay replaces)", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "script.sh": {
          content: "#!/bin/bash\necho root",
        },
      },
      groups: {
        mygroup: {
          files: {
            "script.sh": {
              content: "#!/bin/bash\necho group",
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const script = result.repos[0].files.find(
      (f) => f.fileName === "script.sh"
    );
    // String overlay always replaces
    assert.equal(script?.content, "#!/bin/bash\necho group");
  });

  test("group content type mismatch (text root + object group) - overlay wins", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.sh": { content: "original text" },
      },
      groups: {
        mygroup: {
          files: {
            "config.sh": {
              content: { key: "value" },
            } as RawFileConfig,
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files.find(
      (f) => f.fileName === "config.sh"
    );
    // Type mismatch: overlay wins
    assert.deepStrictEqual(config?.content, { key: "value" });
  });

  test("group override:true with no content uses existing content", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { fromRoot: true } },
      },
      groups: {
        mygroup: {
          files: {
            "config.json": {
              override: true,
            } as RawRepoFileOverride,
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files[0];
    // override:true with no overlay content = use existing content
    assert.deepStrictEqual(config.content, { fromRoot: true });
  });

  test("group introduces new file not in root", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        mygroup: {
          files: {
            "new-file.json": { content: { brand: "new" } },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].files.length, 1);
    assert.equal(result.repos[0].files[0].fileName, "new-file.json");
    assert.deepStrictEqual(result.repos[0].files[0].content, { brand: "new" });
  });

  test("group with no prOptions is skipped in mergeGroupPROptions", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      prOptions: { merge: "auto" },
      groups: {
        emptyGroup: {},
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["emptyGroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.merge, "auto");
  });

  test("group with no settings is skipped in mergeGroupSettings", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          "root-rule": { target: "branch", enforcement: "active" },
        },
      },
      groups: {
        emptyGroup: {},
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["emptyGroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.ok(result.repos[0].settings?.rulesets?.["root-rule"]);
  });

  test("group settings without base (no root settings)", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      groups: {
        mygroup: {
          settings: {
            rulesets: {
              "group-rule": { target: "branch", enforcement: "active" },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.ok(result.repos[0].settings?.rulesets?.["group-rule"]);
  });

  test("group settings merge rulesets with existing base ruleset", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          "shared-rule": {
            target: "branch",
            enforcement: "active",
          },
        },
      },
      groups: {
        mygroup: {
          settings: {
            rulesets: {
              "shared-rule": {
                enforcement: "evaluate",
              },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const rule = result.repos[0].settings?.rulesets?.["shared-rule"] as Record<
      string,
      unknown
    >;
    // Group overrides enforcement, keeps target from root
    assert.equal(rule?.target, "branch");
    assert.equal(rule?.enforcement, "evaluate");
  });

  test("group settings ruleset: false accumulates opt-out marker", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          "root-rule": { target: "branch", enforcement: "active" },
          "keep-rule": { target: "branch", enforcement: "active" },
        },
      },
      groups: {
        mygroup: {
          settings: {
            rulesets: {
              "root-rule": false,
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    // mergeRawSettings accumulates false; mergeSettings then processes it
    // keep-rule should remain present
    assert.ok(result.repos[0].settings?.rulesets?.["keep-rule"]);
  });

  test("group settings repo: false opts out of repo settings", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        repo: {
          hasIssues: true,
          hasWiki: true,
        },
      },
      groups: {
        mygroup: {
          settings: {
            repo: false,
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    // repo: false in group opts out of all repo settings
    assert.equal(result.repos[0].settings?.repo, undefined);
  });

  test("group settings merge repo settings with base", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        repo: {
          hasIssues: true,
        },
      },
      groups: {
        mygroup: {
          settings: {
            repo: {
              hasWiki: false,
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const repo = result.repos[0].settings?.repo as Record<string, unknown>;
    assert.equal(repo?.hasIssues, true);
    assert.equal(repo?.hasWiki, false);
  });

  test("group settings merge repo settings when base repo is false", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        repo: false,
      },
      groups: {
        mygroup: {
          settings: {
            repo: {
              hasWiki: false,
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const repo = result.repos[0].settings?.repo as Record<string, unknown>;
    assert.equal(repo?.hasWiki, false);
  });

  test("group settings labels merging", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        labels: {
          bug: { color: "d73a4a", description: "Something broken" },
          feature: { color: "0e8a16" },
        },
      },
      groups: {
        mygroup: {
          settings: {
            labels: {
              bug: { color: "ff0000", description: "Group bug" },
              enhancement: { color: "a2eeef" },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const labels = result.repos[0].settings?.labels;
    // Group overrides bug label color/description
    assert.equal(labels?.bug?.color, "ff0000");
    assert.equal(labels?.bug?.description, "Group bug");
    // feature from root preserved
    assert.ok(labels?.feature);
    // enhancement from group added
    assert.equal(labels?.enhancement?.color, "a2eeef");
  });

  test("group settings labels inherit:false discards accumulated labels", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        labels: {
          bug: { color: "d73a4a" },
        },
      },
      groups: {
        mygroup: {
          settings: {
            labels: {
              inherit: false,
              enhancement: { color: "a2eeef" },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const labels = result.repos[0].settings?.labels;
    // bug from root should be discarded
    assert.equal(labels?.bug, undefined);
    // enhancement from group should be present
    assert.equal(labels?.enhancement?.color, "a2eeef");
  });

  test("group settings labels false opts out of specific label via repo", () => {
    // Group accumulates false, then per-repo level inherits that
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
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

    const result = normalizeConfig(raw, process.env);
    const labels = result.repos[0].settings?.labels;
    // bug opted out via per-repo false
    assert.equal(labels?.bug, undefined);
    // feature preserved
    assert.ok(labels?.feature);
  });

  test("group settings labels accumulates false marker", () => {
    // mergeRawSettings stores false; we verify feature label still present
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        labels: {
          bug: { color: "d73a4a" },
          feature: { color: "0e8a16" },
        },
      },
      groups: {
        mygroup: {
          settings: {
            labels: {
              bug: false,
              enhancement: { color: "a2eeef" },
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
              bug: false,
            },
          },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const labels = result.repos[0].settings?.labels;
    // bug opted out
    assert.equal(labels?.bug, undefined);
    // feature from root preserved
    assert.ok(labels?.feature);
    // enhancement from group preserved
    assert.ok(labels?.enhancement);
  });

  test("group settings deleteOrphaned overrides root", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          rule: { target: "branch" },
        },
        deleteOrphaned: false,
      },
      groups: {
        mygroup: {
          settings: {
            deleteOrphaned: true,
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].settings?.deleteOrphaned, true);
  });

  test("$arrayMerge directive in group settings merges with root", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "config.json": { content: {} } },
      groups: {
        "extra-bypass": {
          settings: {
            rulesets: {
              "pr-rules": {
                bypassActors: {
                  $arrayMerge: "append",
                  $values: [
                    { actorId: 5555, actorType: "Team", bypassMode: "always" },
                  ],
                } as never,
              },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["extra-bypass"],
        },
      ],
      settings: {
        rulesets: {
          "pr-rules": {
            target: "branch",
            bypassActors: [
              { actorId: 2740, actorType: "Integration", bypassMode: "always" },
            ],
          },
        },
      },
    };

    const result = normalizeConfig(raw, process.env);
    const actors =
      result.repos[0].settings?.rulesets?.["pr-rules"]?.bypassActors;
    assert.equal(actors?.length, 2);
    assert.equal(actors?.[0]?.actorId, 2740);
    assert.equal(actors?.[1]?.actorId, 5555);
  });

  test("$arrayMerge directive in conditional group settings merges with root", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "config.json": { content: {} } },
      groups: {
        "github-ci": {},
      },
      conditionalGroups: [
        {
          when: { allOf: ["github-ci"] },
          settings: {
            rulesets: {
              "pr-rules": {
                rules: {
                  $arrayMerge: "append",
                  $values: [
                    {
                      type: "required_status_checks",
                      parameters: {
                        requiredStatusChecks: [
                          { context: "summary / Check Results" },
                        ],
                      },
                    },
                  ],
                } as never,
              },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["github-ci"],
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

    const result = normalizeConfig(raw, process.env);
    const rules = result.repos[0].settings?.rulesets?.["pr-rules"]?.rules;
    assert.equal(rules?.length, 2);
    assert.equal(rules?.[0]?.type, "pull_request");
    assert.equal(rules?.[1]?.type, "required_status_checks");
  });

  test("stacked $arrayMerge directives across two groups with no root base array", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "config.json": { content: {} } },
      groups: {
        "group-a": {
          settings: {
            rulesets: {
              "pr-rules": {
                bypassActors: {
                  $arrayMerge: "append",
                  $values: [
                    {
                      actorId: 1111,
                      actorType: "Integration",
                      bypassMode: "always",
                    },
                  ],
                } as never,
              },
            },
          },
        },
        "group-b": {
          settings: {
            rulesets: {
              "pr-rules": {
                bypassActors: {
                  $arrayMerge: "append",
                  $values: [
                    { actorId: 2222, actorType: "Team", bypassMode: "always" },
                  ],
                } as never,
              },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["group-a", "group-b"],
        },
      ],
      settings: {
        rulesets: {
          "pr-rules": {
            target: "branch",
          },
        },
      },
    };

    const result = normalizeConfig(raw, process.env);
    const actors =
      result.repos[0].settings?.rulesets?.["pr-rules"]?.bypassActors;
    // group-a's directive resolves to [1111], group-b appends [2222]
    assert.equal(actors?.length, 2);
    assert.equal(actors?.[0]?.actorId, 1111);
    assert.equal(actors?.[1]?.actorId, 2222);
  });

  test("multiple groups chain settings left-to-right", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          "root-rule": { target: "branch", enforcement: "active" },
        },
      },
      groups: {
        groupA: {
          settings: {
            rulesets: {
              "group-a-rule": { target: "branch", enforcement: "active" },
            },
          },
        },
        groupB: {
          settings: {
            rulesets: {
              "group-b-rule": { target: "branch", enforcement: "evaluate" },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["groupA", "groupB"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.ok(result.repos[0].settings?.rulesets?.["root-rule"]);
    assert.ok(result.repos[0].settings?.rulesets?.["group-a-rule"]);
    assert.ok(result.repos[0].settings?.rulesets?.["group-b-rule"]);
  });

  test("overlayToRoot handles rulesets with inherit key", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      groups: {
        mygroup: {
          settings: {
            rulesets: {
              inherit: false,
              "group-rule": { target: "branch", enforcement: "active" },
            },
            deleteOrphaned: true,
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    // inherit key should be stripped, group-rule present
    assert.ok(result.repos[0].settings?.rulesets?.["group-rule"]);
    assert.equal(result.repos[0].settings?.deleteOrphaned, true);
  });

  test("overlayToRoot handles labels with inherit key", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      groups: {
        mygroup: {
          settings: {
            labels: {
              inherit: false,
              enhancement: { color: "a2eeef" },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.ok(result.repos[0].settings?.labels?.enhancement);
  });

  test("overlayToRoot handles repo settings", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      groups: {
        mygroup: {
          settings: {
            repo: {
              hasIssues: true,
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const repo = result.repos[0].settings?.repo as Record<string, unknown>;
    assert.equal(repo?.hasIssues, true);
  });

  test("group settings with new ruleset (no existing base for that name)", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          "existing-rule": { target: "branch" },
        },
      },
      groups: {
        mygroup: {
          settings: {
            rulesets: {
              "brand-new-rule": { target: "tag", enforcement: "active" },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const rule = result.repos[0].settings?.rulesets?.[
      "brand-new-rule"
    ] as Record<string, unknown>;
    assert.equal(rule?.target, "tag");
    assert.equal(rule?.enforcement, "active");
  });

  test("group settings labels merge with existing label entry", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        labels: {
          bug: { color: "d73a4a", description: "Root description" },
        },
      },
      groups: {
        mygroup: {
          settings: {
            labels: {
              bug: { color: "ff0000" },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const bug = result.repos[0].settings?.labels?.bug;
    // Group overrides color but description from root is preserved via mergeSettings
    assert.equal(bug?.color, "ff0000");
  });

  test("mergeRawSettings returns undefined when both base and overlay are undefined", () => {
    // This is exercised when both root settings and group settings are undefined
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      groups: {
        mygroup: {},
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].settings, undefined);
  });

  test("mergeRawSettings returns structuredClone of base when overlay has no settings", () => {
    // Tests the path where overlay is undefined but base exists
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          "root-rule": { target: "branch" },
        },
      },
      groups: {
        groupA: {
          settings: {
            rulesets: {
              "group-rule": { target: "branch" },
            },
          },
        },
        groupB: {}, // no settings -> overlay is undefined
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["groupA", "groupB"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.ok(result.repos[0].settings?.rulesets?.["root-rule"]);
    assert.ok(result.repos[0].settings?.rulesets?.["group-rule"]);
  });

  test("group settings rulesets.inherit:false with no overlay rulesets results in empty rulesets", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          "root-rule": { target: "branch", enforcement: "active" },
        },
        repo: { hasIssues: true },
      },
      groups: {
        mygroup: {
          settings: {
            rulesets: {
              inherit: false,
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    // Rulesets should be empty (inherit:false discarded root, no group rulesets added)
    // But repo settings should still be there
    assert.equal(result.repos[0].settings?.rulesets, undefined);
    const repo = result.repos[0].settings?.repo as Record<string, unknown>;
    assert.equal(repo?.hasIssues, true);
  });

  test("group settings labels.inherit:false with no overlay labels", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        labels: {
          bug: { color: "d73a4a" },
        },
        rulesets: {
          rule: { target: "branch" },
        },
      },
      groups: {
        mygroup: {
          settings: {
            labels: {
              inherit: false,
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    // Labels should be empty since inherit:false discarded root labels
    assert.equal(result.repos[0].settings?.labels, undefined);
    // But rulesets should still be there
    assert.ok(result.repos[0].settings?.rulesets?.["rule"]);
  });

  test("multiple groups chain prOptions left-to-right", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      prOptions: { merge: "auto" },
      groups: {
        groupA: {
          prOptions: { labels: ["from-A"] },
        },
        groupB: {
          prOptions: { merge: "force" },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["groupA", "groupB"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    // groupB overrides merge from root/groupA
    assert.equal(result.repos[0].prOptions?.merge, "force");
    // groupA labels preserved
    assert.deepStrictEqual(result.repos[0].prOptions?.labels, ["from-A"]);
  });

  test("group file deep merges object content with root object content", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": {
          content: { root: true, shared: { a: 1 } },
          mergeStrategy: "replace",
        },
      },
      groups: {
        mygroup: {
          files: {
            "config.json": {
              content: { group: true, shared: { b: 2 } },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const content = result.repos[0].files[0].content as Record<string, unknown>;
    assert.equal(content.root, true);
    assert.equal(content.group, true);
  });

  test("group file without content uses existing content", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { fromRoot: true } },
      },
      groups: {
        mygroup: {
          files: {
            "config.json": {
              createOnly: true,
            } as RawRepoFileOverride,
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files[0];
    assert.deepStrictEqual(config.content, { fromRoot: true });
    assert.equal(config.createOnly, true);
  });

  test("group file with no existing base content uses overlay content", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { fromRoot: true } },
      },
      groups: {
        groupA: {
          files: {
            "new.json": {
              content: { fromGroupA: true },
            },
          },
        },
        groupB: {
          files: {
            "new.json": {
              content: { fromGroupB: true },
            },
          },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["groupA", "groupB"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const newFile = result.repos[0].files.find(
      (f) => f.fileName === "new.json"
    );
    // groupB merges onto groupA's accumulated value
    const content = newFile?.content as Record<string, unknown>;
    assert.equal(content.fromGroupA, true);
    assert.equal(content.fromGroupB, true);
  });
});

describe("group extends", () => {
  test("single parent: child inherits parent files", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        parent: {
          files: { "parent.json": { content: { from: "parent" } } },
        },
        child: {
          extends: "parent",
          files: { "child.json": { content: { from: "child" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("parent.json"), "should include parent file");
    assert.ok(fileNames.includes("child.json"), "should include child file");
  });

  test("single parent: child overrides parent file content", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        parent: {
          files: {
            "shared.json": { content: { source: "parent", kept: true } },
          },
        },
        child: {
          extends: "parent",
          files: { "shared.json": { content: { source: "child" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const shared = result.repos[0].files.find(
      (f) => f.fileName === "shared.json"
    );
    assert.deepStrictEqual(shared?.content, { source: "child", kept: true });
  });

  test("multi-parent: extends array merges parents left-to-right", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        parentA: {
          files: { "a.json": { content: { from: "A" } } },
        },
        parentB: {
          files: { "b.json": { content: { from: "B" } } },
        },
        child: {
          extends: ["parentA", "parentB"],
          files: { "child.json": { content: { from: "child" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("a.json"));
    assert.ok(fileNames.includes("b.json"));
    assert.ok(fileNames.includes("child.json"));
  });

  test("transitive: grandparent -> parent -> child", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        grandparent: {
          files: { "gp.json": { content: { from: "grandparent" } } },
        },
        parent: {
          extends: "grandparent",
          files: { "p.json": { content: { from: "parent" } } },
        },
        child: {
          extends: "parent",
          files: { "c.json": { content: { from: "child" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("gp.json"));
    assert.ok(fileNames.includes("p.json"));
    assert.ok(fileNames.includes("c.json"));
  });

  test("diamond: shared ancestor appears once, before both children", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        base: {
          files: { "base.json": { content: { from: "base" } } },
        },
        left: {
          extends: "base",
          files: { "left.json": { content: { from: "left" } } },
        },
        right: {
          extends: "base",
          files: { "right.json": { content: { from: "right" } } },
        },
      },
      repos: [
        { git: "git@github.com:org/repo.git", groups: ["left", "right"] },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("base.json"), "base appears");
    assert.ok(fileNames.includes("left.json"), "left appears");
    assert.ok(fileNames.includes("right.json"), "right appears");
    // base.json should only appear once
    assert.equal(
      result.repos[0].files.filter((f) => f.fileName === "base.json").length,
      1,
      "base appears exactly once"
    );
  });

  test("no extends: group without extends unchanged", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "root.json": { content: { from: "root" } } },
      groups: {
        standalone: {
          files: { "standalone.json": { content: { from: "standalone" } } },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["standalone"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("root.json"));
    assert.ok(fileNames.includes("standalone.json"));
    assert.equal(result.repos[0].files.length, 2);
  });

  test("mixed: repo with extending and non-extending groups", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        base: {
          files: { "base.json": { content: { from: "base" } } },
        },
        derived: {
          extends: "base",
          files: { "derived.json": { content: { from: "derived" } } },
        },
        standalone: {
          files: { "standalone.json": { content: { from: "standalone" } } },
        },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["derived", "standalone"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.deepStrictEqual(fileNames.sort(), [
      "base.json",
      "derived.json",
      "standalone.json",
    ]);
  });

  test("child inherit:false discards parent files", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "root.json": { content: { from: "root" } } },
      groups: {
        parent: {
          files: { "parent.json": { content: { from: "parent" } } },
        },
        child: {
          extends: "parent",
          files: {
            inherit: false,
            "child.json": { content: { from: "child" } },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(!fileNames.includes("root.json"), "root discarded");
    assert.ok(!fileNames.includes("parent.json"), "parent discarded");
    assert.ok(fileNames.includes("child.json"), "child kept");
  });

  test("child file:false removes specific parent file", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        parent: {
          files: {
            "keep.json": { content: { keep: true } },
            "remove.json": { content: { remove: true } },
          },
        },
        child: {
          extends: "parent",
          files: {
            "remove.json": false,
            "child.json": { content: { from: "child" } },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("keep.json"), "keep.json stays");
    assert.ok(!fileNames.includes("remove.json"), "remove.json removed");
    assert.ok(fileNames.includes("child.json"), "child.json added");
  });

  test("parent prOptions merge into child", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      groups: {
        parent: {
          prOptions: { merge: "auto", labels: ["parent-label"] },
        },
        child: {
          extends: "parent",
          prOptions: { labels: ["child-label"] },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.merge, "auto");
    assert.deepStrictEqual(result.repos[0].prOptions?.labels, ["child-label"]);
  });

  test("parent settings merge into child", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      groups: {
        parent: {
          settings: {
            labels: {
              "parent-label": { color: "ff0000", description: "from parent" },
            },
          },
        },
        child: {
          extends: "parent",
          settings: {
            labels: {
              "child-label": { color: "00ff00", description: "from child" },
            },
          },
        },
      },
      repos: [{ git: "git@github.com:org/repo.git", groups: ["child"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const labels = result.repos[0].settings?.labels;
    assert.ok(labels?.["parent-label"], "parent label present");
    assert.ok(labels?.["child-label"], "child label present");
  });

  test("effective group set includes transitive parents for conditional groups", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        github: {
          files: { "github.json": { content: { from: "github" } } },
        },
        "github-ci": {
          extends: "github",
          files: { "ci.json": { content: { from: "ci" } } },
        },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["github"] },
          files: { "conditional.json": { content: { from: "conditional" } } },
        },
      ],
      repos: [{ git: "git@github.com:org/repo.git", groups: ["github-ci"] }],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("github.json"), "parent file");
    assert.ok(fileNames.includes("ci.json"), "child file");
    assert.ok(
      fileNames.includes("conditional.json"),
      "conditional group matched via transitive parent"
    );
  });
});

describe("conditional group configuration", () => {
  test("conditional group with allOf matches when all groups present", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { base: true } },
      },
      groups: {
        terraform: {
          files: { "tf.json": { content: { tf: true } } },
        },
        renovate: {
          files: { "renovate.json": { content: { renovate: true } } },
        },
      },
      conditionalGroups: [
        {
          when: { allOf: ["terraform", "renovate"] },
          settings: {
            labels: {
              "infra-managed": { color: "00ff00" },
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
    };

    const result = normalizeConfig(raw, process.env);
    assert.ok(result.repos[0].settings?.labels?.["infra-managed"]);
    assert.equal(
      result.repos[0].settings?.labels?.["infra-managed"]?.color,
      "00ff00"
    );
  });

  test("conditional group with allOf does not match when group missing", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { base: true } },
      },
      groups: {
        terraform: {
          files: { "tf.json": { content: { tf: true } } },
        },
        renovate: {
          files: { "renovate.json": { content: { renovate: true } } },
        },
      },
      conditionalGroups: [
        {
          when: { allOf: ["terraform", "renovate"] },
          settings: {
            labels: {
              "infra-managed": { color: "00ff00" },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["terraform"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(
      result.repos[0].settings?.labels?.["infra-managed"],
      undefined
    );
  });

  test("conditional group with anyOf matches when one group present", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        "github-ci": {},
        "github-trivy": {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["github-ci", "github-trivy"] },
          files: {
            "ci-shared.json": { content: { ci: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["github-ci"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const ciFile = result.repos[0].files.find(
      (f) => f.fileName === "ci-shared.json"
    );
    assert.ok(ciFile);
    assert.deepStrictEqual(ciFile?.content, { ci: true });
  });

  test("conditional group with anyOf does not match when no groups present", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        "github-ci": {},
        "github-trivy": {},
        unrelated: {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["github-ci", "github-trivy"] },
          files: {
            "ci-shared.json": { content: { ci: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["unrelated"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const ciFile = result.repos[0].files.find(
      (f) => f.fileName === "ci-shared.json"
    );
    assert.equal(ciFile, undefined);
  });

  test("combined allOf + anyOf requires both conditions", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        renovate: {},
        go: {},
        terraform: {},
      },
      conditionalGroups: [
        {
          when: { allOf: ["renovate"], anyOf: ["go", "terraform"] },
          files: {
            "combo.json": { content: { combo: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/both.git",
          groups: ["renovate", "terraform"],
        },
        {
          git: "git@github.com:org/renovate-only.git",
          groups: ["renovate"],
        },
        {
          git: "git@github.com:org/go-only.git",
          groups: ["go"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    // repo with both renovate + terraform -> matches
    const bothRepo = result.repos.find((r) => r.git.includes("both"));
    assert.ok(bothRepo?.files.find((f) => f.fileName === "combo.json"));

    // repo with renovate only -> no match (anyOf not satisfied)
    const renovateOnly = result.repos.find((r) =>
      r.git.includes("renovate-only")
    );
    assert.equal(
      renovateOnly?.files.find((f) => f.fileName === "combo.json"),
      undefined
    );

    // repo with go only -> no match (allOf not satisfied)
    const goOnly = result.repos.find((r) => r.git.includes("go-only"));
    assert.equal(
      goOnly?.files.find((f) => f.fileName === "combo.json"),
      undefined
    );
  });

  test("multiple conditional groups merge in array order", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        terraform: {},
        renovate: {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["terraform"] },
          files: {
            "shared.json": { content: { source: "first", first: true } },
          },
        },
        {
          when: { anyOf: ["renovate"] },
          files: {
            "shared.json": { content: { source: "second", second: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["terraform", "renovate"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const shared = result.repos[0].files.find(
      (f) => f.fileName === "shared.json"
    );
    const content = shared?.content as Record<string, unknown>;
    // Second conditional group wins for shared key
    assert.equal(content.source, "second");
    // Both contribute unique keys
    assert.equal(content.first, true);
    assert.equal(content.second, true);
  });

  test("conditional groups merge after explicit groups", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { fromRoot: true } },
      },
      groups: {
        mygroup: {
          files: {
            "config.json": { content: { fromGroup: true } },
          },
        },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          files: {
            "config.json": { content: { fromConditional: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files.find(
      (f) => f.fileName === "config.json"
    );
    const content = config?.content as Record<string, unknown>;
    // All three layers contribute
    assert.equal(content.fromRoot, true);
    assert.equal(content.fromGroup, true);
    assert.equal(content.fromConditional, true);
  });

  test("repo overrides win over conditional group values", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { base: true, key: "root" } },
      },
      groups: {
        mygroup: {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          files: {
            "config.json": { content: { key: "conditional", extra: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
          files: {
            "config.json": { content: { key: "repo" } },
          },
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files.find(
      (f) => f.fileName === "config.json"
    );
    const content = config?.content as Record<string, unknown>;
    // Repo override wins for key
    assert.equal(content.key, "repo");
    // Conditional group contributes extra
    assert.equal(content.extra, true);
    // Root contributes base
    assert.equal(content.base, true);
  });

  test("no conditional groups defined preserves existing behavior", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      repos: [
        {
          git: "git@github.com:org/repo.git",
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos.length, 1);
    assert.equal(result.repos[0].files.length, 1);
    assert.deepStrictEqual(result.repos[0].files[0].content, { key: "value" });
  });

  test("conditional group prOptions merge correctly", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      prOptions: { merge: "auto" },
      groups: {
        mygroup: {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          prOptions: { labels: ["conditional-label"] },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.equal(result.repos[0].prOptions?.merge, "auto");
    assert.deepStrictEqual(result.repos[0].prOptions?.labels, [
      "conditional-label",
    ]);
  });

  test("conditional group with inherit:false on files discards accumulated", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "root.json": { content: { fromRoot: true } },
      },
      groups: {
        mygroup: {
          files: {
            "group.json": { content: { fromGroup: true } },
          },
        },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          files: {
            inherit: false,
            "conditional.json": { content: { fromConditional: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    // Root and group files should be discarded
    assert.ok(!fileNames.includes("root.json"));
    assert.ok(!fileNames.includes("group.json"));
    // Only conditional file remains
    assert.ok(fileNames.includes("conditional.json"));
  });

  test("conditional group file:false removes file from accumulated set", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "keep.json": { content: { keep: true } },
        "remove.json": { content: { remove: true } },
      },
      groups: {
        mygroup: {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          files: {
            "remove.json": false,
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("keep.json"));
    assert.ok(!fileNames.includes("remove.json"));
  });

  test("conditional group override:true replaces content instead of merging", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { fromRoot: true, shared: "root" } },
      },
      groups: {
        mygroup: {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          files: {
            "config.json": {
              content: { fromConditional: true },
              override: true,
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const config = result.repos[0].files[0];
    assert.deepStrictEqual(config.content, { fromConditional: true });
  });

  test("repo with empty groups does not match any conditional", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { base: true } },
      },
      conditionalGroups: [
        {
          when: { anyOf: ["terraform"] },
          files: {
            "extra.json": { content: { extra: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("config.json"));
    assert.ok(!fileNames.includes("extra.json"));
  });

  test("conditional group rulesets merge correctly", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        rulesets: {
          "root-rule": { target: "branch", enforcement: "active" },
        },
      },
      groups: {
        mygroup: {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          settings: {
            rulesets: {
              "conditional-rule": { target: "branch", enforcement: "evaluate" },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    assert.ok(result.repos[0].settings?.rulesets?.["root-rule"]);
    assert.ok(result.repos[0].settings?.rulesets?.["conditional-rule"]);
    assert.equal(
      result.repos[0].settings?.rulesets?.["conditional-rule"]?.enforcement,
      "evaluate"
    );
  });

  test("conditional group repo settings merge correctly", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { key: "value" } },
      },
      settings: {
        repo: {
          hasIssues: true,
          hasWiki: true,
        },
      },
      groups: {
        mygroup: {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["mygroup"] },
          settings: {
            repo: {
              hasWiki: false,
              hasDiscussions: true,
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["mygroup"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const repo = result.repos[0].settings?.repo as Record<string, unknown>;
    assert.equal(repo?.hasIssues, true);
    assert.equal(repo?.hasWiki, false);
    assert.equal(repo?.hasDiscussions, true);
  });

  test("conditional group with noneOf matches when none of listed groups present", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { base: true } },
      },
      groups: {
        terraform: {
          files: { "tf.json": { content: { tf: true } } },
        },
        "no-terraform": {
          files: { "other.json": { content: { other: true } } },
        },
      },
      conditionalGroups: [
        {
          when: { noneOf: ["terraform"] },
          files: {
            "fallback.json": { content: { fallback: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/no-tf.git",
          groups: ["no-terraform"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(
      fileNames.includes("fallback.json"),
      "noneOf matched: group absent"
    );
  });

  test("conditional group with noneOf does not match when excluded group present", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {
        "config.json": { content: { base: true } },
      },
      groups: {
        terraform: {
          files: { "tf.json": { content: { tf: true } } },
        },
        "terraform-custom": {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["terraform"], noneOf: ["terraform-custom"] },
          files: {
            "default-tf.json": { content: { defaultTf: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/has-both.git",
          groups: ["terraform", "terraform-custom"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(
      !fileNames.includes("default-tf.json"),
      "noneOf excluded: terraform-custom present"
    );
  });

  test("conditional group with anyOf and noneOf matches correctly", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        "pre-commit": {
          files: { "hooks.json": { content: { hooks: true } } },
        },
        "pre-commit-custom": {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["pre-commit"], noneOf: ["pre-commit-custom"] },
          files: {
            "default-hooks.json": { content: { defaultHooks: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/normal.git",
          groups: ["pre-commit"],
        },
        {
          git: "git@github.com:org/custom.git",
          groups: ["pre-commit", "pre-commit-custom"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const normalFiles = result.repos[0].files.map((f) => f.fileName);
    const customFiles = result.repos[1].files.map((f) => f.fileName);
    assert.ok(
      normalFiles.includes("default-hooks.json"),
      "normal repo gets default hooks"
    );
    assert.ok(
      !customFiles.includes("default-hooks.json"),
      "custom repo excluded by noneOf"
    );
  });

  test("noneOf excludes via transitive parent groups", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        github: {
          files: { "github.json": { content: { from: "github" } } },
        },
        "github-ci": {
          extends: "github",
          files: { "ci.json": { content: { from: "ci" } } },
        },
        "non-github-platform": {},
      },
      conditionalGroups: [
        {
          when: {
            anyOf: ["github-ci", "non-github-platform"],
            noneOf: ["github"],
          },
          files: {
            "non-github.json": { content: { nonGithub: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/ci-repo.git",
          groups: ["github-ci"],
        },
        {
          git: "git@github.com:org/other-repo.git",
          groups: ["non-github-platform"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const ciFiles = result.repos[0].files.map((f) => f.fileName);
    const otherFiles = result.repos[1].files.map((f) => f.fileName);
    assert.ok(
      !ciFiles.includes("non-github.json"),
      "noneOf excludes via transitive parent: github-ci extends github"
    );
    assert.ok(
      otherFiles.includes("non-github.json"),
      "noneOf matches: non-github-platform does not have github in parent chain"
    );
  });

  test("noneOf standalone matches repo that has none of the listed groups", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        special: {},
        basic: {},
      },
      conditionalGroups: [
        {
          when: { noneOf: ["special"] },
          files: {
            "default.json": { content: { isDefault: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/repo.git",
          groups: ["basic"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const fileNames = result.repos[0].files.map((f) => f.fileName);
    assert.ok(fileNames.includes("default.json"), "noneOf standalone matched");
  });

  test("conditional group with allOf and noneOf matches correctly", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        renovate: {
          files: { "renovate.json": { content: { renovate: true } } },
        },
        terraform: {},
        "custom-renovate": {},
      },
      conditionalGroups: [
        {
          when: {
            allOf: ["renovate", "terraform"],
            noneOf: ["custom-renovate"],
          },
          files: {
            "default-renovate-tf.json": {
              content: { defaultRenovateTf: true },
            },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/standard.git",
          groups: ["renovate", "terraform"],
        },
        {
          git: "git@github.com:org/custom.git",
          groups: ["renovate", "terraform", "custom-renovate"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const standardFiles = result.repos[0].files.map((f) => f.fileName);
    const customFiles = result.repos[1].files.map((f) => f.fileName);
    assert.ok(
      standardFiles.includes("default-renovate-tf.json"),
      "allOf+noneOf matched: standard repo"
    );
    assert.ok(
      !customFiles.includes("default-renovate-tf.json"),
      "allOf+noneOf excluded: custom repo"
    );
  });

  test("noneOf with multiple entries requires all to be absent", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        base: {},
        "exclude-a": {},
        "exclude-b": {},
      },
      conditionalGroups: [
        {
          when: { anyOf: ["base"], noneOf: ["exclude-a", "exclude-b"] },
          files: {
            "default.json": { content: { isDefault: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/has-none.git",
          groups: ["base"],
        },
        {
          git: "git@github.com:org/has-one.git",
          groups: ["base", "exclude-a"],
        },
        {
          git: "git@github.com:org/has-both.git",
          groups: ["base", "exclude-a", "exclude-b"],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const noneFiles = result.repos[0].files.map((f) => f.fileName);
    const oneFiles = result.repos[1].files.map((f) => f.fileName);
    const bothFiles = result.repos[2].files.map((f) => f.fileName);
    assert.ok(
      noneFiles.includes("default.json"),
      "matches when no excluded groups present"
    );
    assert.ok(
      !oneFiles.includes("default.json"),
      "excluded when one of noneOf groups present"
    );
    assert.ok(
      !bothFiles.includes("default.json"),
      "excluded when all noneOf groups present"
    );
  });

  test("noneOf matches repo with empty groups (no groups assigned)", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: {},
      groups: {
        special: {},
      },
      conditionalGroups: [
        {
          when: { noneOf: ["special"] },
          files: {
            "fallback.json": { content: { fallback: true } },
          },
        },
      ],
      repos: [
        {
          git: "git@github.com:org/no-groups-repo.git",
        },
        {
          git: "git@github.com:org/empty-groups-repo.git",
          groups: [],
        },
      ],
    };

    const result = normalizeConfig(raw, process.env);
    const noGroupsFiles = result.repos[0].files.map((f) => f.fileName);
    const emptyGroupsFiles = result.repos[1].files.map((f) => f.fileName);
    assert.ok(
      noGroupsFiles.includes("fallback.json"),
      "noneOf matched: repo with no groups field"
    );
    assert.ok(
      emptyGroupsFiles.includes("fallback.json"),
      "noneOf matched: repo with empty groups array"
    );
  });

  describe("per-repo standalone file definitions", () => {
    test("includes repo-only file not defined in root or groups", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "shared.json": { content: { shared: true } } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "repo-only.json": { content: { local: true } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw, {});
      const fileNames = result.repos[0].files.map((f) => f.fileName);
      assert.ok(fileNames.includes("shared.json"));
      assert.ok(fileNames.includes("repo-only.json"));
    });

    test("repo-only file resolves content correctly", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {},
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
      };

      const result = normalizeConfig(raw, {});
      assert.equal(result.repos[0].files.length, 1);
      assert.equal(
        result.repos[0].files[0].fileName,
        ".github/renovate-overrides.json5"
      );
      assert.deepEqual(result.repos[0].files[0].content, {
        extends: ["config:base"],
      });
    });

    test("repo-only file does not leak to other repos", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "shared.json": { content: { shared: true } } },
        repos: [
          {
            git: "git@github.com:org/repo-a.git",
            files: {
              "only-a.json": { content: { a: true } },
            },
          },
          {
            git: "git@github.com:org/repo-b.git",
          },
        ],
      };

      const result = normalizeConfig(raw, {});
      const repoAFiles = result.repos[0].files.map((f) => f.fileName);
      const repoBFiles = result.repos[1].files.map((f) => f.fileName);
      assert.ok(repoAFiles.includes("only-a.json"));
      assert.ok(repoAFiles.includes("shared.json"));
      assert.ok(!repoBFiles.includes("only-a.json"));
      assert.ok(repoBFiles.includes("shared.json"));
    });

    test("repo-only file with false is excluded", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {},
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "excluded.json": false,
              "included.json": { content: { yes: true } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw, {});
      const fileNames = result.repos[0].files.map((f) => f.fileName);
      assert.ok(!fileNames.includes("excluded.json"));
      assert.ok(fileNames.includes("included.json"));
    });

    test("repo-only file included even with inherit: false", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: { "shared.json": { content: { shared: true } } },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              inherit: false,
              "repo-only.json": { content: { local: true } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw, {});
      const fileNames = result.repos[0].files.map((f) => f.fileName);
      assert.ok(!fileNames.includes("shared.json"), "inherited file excluded");
      assert.ok(
        fileNames.includes("repo-only.json"),
        "standalone file included"
      );
    });

    test("repo-only file inherits deleteOrphaned from root", () => {
      const raw: RawConfig = {
        id: "test-config",
        files: {},
        deleteOrphaned: true,
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              "local.json": { content: { x: 1 } },
            },
          },
        ],
      };

      const result = normalizeConfig(raw, {});
      assert.equal(result.repos[0].files[0].deleteOrphaned, true);
    });
  });
});

describe("mergeSettings variables", () => {
  test("merges root variables into repo settings", () => {
    const root: RawRootSettings = {
      variables: { ROOT_VAR: "root-value" },
    };
    const result = mergeSettings(root, undefined);
    assert.deepStrictEqual(result?.variables, { ROOT_VAR: "root-value" });
  });

  test("per-repo variables override root", () => {
    const root: RawRootSettings = {
      variables: { SHARED: "root" },
    };
    const perRepo: RawRepoSettings = {
      variables: { SHARED: "repo" },
    };
    const result = mergeSettings(root, perRepo);
    assert.equal(result?.variables?.SHARED, "repo");
  });

  test("per-repo inherit false discards root variables", () => {
    const root: RawRootSettings = {
      variables: { ROOT_VAR: "value" },
    };
    const perRepo: RawRepoSettings = {
      variables: Object.assign(
        { REPO_VAR: "val" },
        { inherit: false }
      ) as RawRepoSettings["variables"],
    };
    const result = mergeSettings(root, perRepo);
    assert.equal(result?.variables?.ROOT_VAR, undefined);
    assert.equal(result?.variables?.REPO_VAR, "val");
  });

  test("merges deleteOrphaned peer key from root variables", () => {
    const root: RawRootSettings = {
      variables: Object.assign(
        { ROOT_VAR: "value" },
        { deleteOrphaned: true }
      ) as RawRootSettings["variables"],
    };
    const result = mergeSettings(root, undefined);
    assert.equal(result?.variables?.ROOT_VAR, "value");
    assert.equal(
      (result?.variables as Record<string, unknown>)?.deleteOrphaned,
      true
    );
  });

  test("per-repo deleteOrphaned overrides root deleteOrphaned", () => {
    const root: RawRootSettings = {
      variables: Object.assign(
        { ROOT_VAR: "value" },
        { deleteOrphaned: true }
      ) as RawRootSettings["variables"],
    };
    const perRepo: RawRepoSettings = {
      variables: Object.assign(
        { ROOT_VAR: "value" },
        { deleteOrphaned: false }
      ) as RawRepoSettings["variables"],
    };
    const result = mergeSettings(root, perRepo);
    assert.equal(
      (result?.variables as Record<string, unknown>)?.deleteOrphaned,
      false
    );
  });

  test("per-repo variable: false opts out of root variable", () => {
    const root: RawRootSettings = {
      variables: { ROOT_VAR: "value", KEEP: "yes" },
    };
    const perRepo: RawRepoSettings = {
      variables: { ROOT_VAR: false as unknown as string },
    };
    const result = mergeSettings(root, perRepo);
    assert.equal(result?.variables?.ROOT_VAR, undefined);
    assert.equal(result?.variables?.KEEP, "yes");
  });
});

describe("mergeRawSettings variables", () => {
  test("group-level variables merge into root settings", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      settings: {
        variables: { ROOT_VAR: "root-value" },
      },
      groups: {
        myGroup: {
          settings: {
            variables: { GROUP_VAR: "group-value" },
          },
        },
      },
      repos: [
        {
          git: "https://github.com/o/r.git",
          groups: ["myGroup"],
        },
      ],
    };
    const config = normalizeConfig(raw, {});
    assert.equal(config.repos[0].settings?.variables?.ROOT_VAR, "root-value");
    assert.equal(config.repos[0].settings?.variables?.GROUP_VAR, "group-value");
  });

  test("group-level variables override root variables", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      settings: {
        variables: { SHARED: "root" },
      },
      groups: {
        myGroup: {
          settings: {
            variables: { SHARED: "group" },
          },
        },
      },
      repos: [
        {
          git: "https://github.com/o/r.git",
          groups: ["myGroup"],
        },
      ],
    };
    const config = normalizeConfig(raw, {});
    assert.equal(config.repos[0].settings?.variables?.SHARED, "group");
  });

  test("group-level variable: false removes inherited root variable", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      settings: {
        variables: { KEEP: "yes", REMOVE: "no" },
      },
      groups: {
        myGroup: {
          settings: {
            variables: Object.assign(
              { REMOVE: false },
              {}
            ) as unknown as RawRepoSettings["variables"],
          },
        },
      },
      repos: [
        {
          git: "https://github.com/o/r.git",
          groups: ["myGroup"],
        },
      ],
    };
    const config = normalizeConfig(raw, {});
    assert.equal(config.repos[0].settings?.variables?.KEEP, "yes");
    assert.equal(
      (config.repos[0].settings?.variables as Record<string, unknown>)?.REMOVE,
      undefined
    );
  });

  test("group-level inherit: false discards root variables", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      settings: {
        variables: { ROOT_VAR: "value" },
      },
      groups: {
        myGroup: {
          settings: {
            variables: Object.assign(
              { GROUP_VAR: "val" },
              { inherit: false }
            ) as RawRepoSettings["variables"],
          },
        },
      },
      repos: [
        {
          git: "https://github.com/o/r.git",
          groups: ["myGroup"],
        },
      ],
    };
    const config = normalizeConfig(raw, {});
    assert.equal(config.repos[0].settings?.variables?.ROOT_VAR, undefined);
    assert.equal(config.repos[0].settings?.variables?.GROUP_VAR, "val");
  });
});

describe("normalizeConfig secrets", () => {
  test("passes secrets config through to normalized config", () => {
    const raw: RawConfig = {
      id: "test-config",
      files: { "f.json": { content: {} } },
      repos: [{ git: "git@github.com:org/repo.git" }],
      secrets: {
        MY_SECRET: { env: "SOURCE_VAR" },
        deleteOrphaned: true,
      },
    };
    const config = normalizeConfig(raw, {});

    assert.deepStrictEqual(
      (config.secrets as Record<string, unknown>)["MY_SECRET"],
      { env: "SOURCE_VAR" }
    );
    assert.equal(
      (config.secrets as Record<string, unknown>)["deleteOrphaned"],
      true
    );
  });
});
