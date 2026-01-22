import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeConfig } from "./config-normalizer.js";
import type { RawConfig } from "./config.js";

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
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos.length, 1);
      assert.equal(result.repos[0].git, "git@github.com:org/repo.git");
    });

    test("expands git array to multiple repo entries", () => {
      const raw: RawConfig = {
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

    test("respects per-file mergeStrategy", () => {
      const raw: RawConfig = {
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

    test("strips merge directives from output", () => {
      const raw: RawConfig = {
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
        files: {
          "config.json": { content: { value: "${MISSING_VAR}" } },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      assert.throws(
        () => normalizeConfig(raw),
        /Missing required environment variable: MISSING_VAR/,
      );
    });
  });

  describe("output structure", () => {
    test("preserves fileName in files array", () => {
      const raw: RawConfig = {
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
      result.repos[0].files[0].content.key = "modified";

      // Other repo should be unaffected
      assert.equal(result.repos[1].files[0].content.key, "value");
    });

    test("returns empty repos array when input has empty repos", () => {
      const raw: RawConfig = {
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
        (f) => f.fileName === "append.json",
      );
      const replaceFile = result.repos[0].files.find(
        (f) => f.fileName === "replace.json",
      );

      assert.deepEqual(appendFile?.content.items, ["a", "b"]);
      assert.deepEqual(replaceFile?.content.items, ["y"]);
    });
  });

  describe("createOnly propagation", () => {
    test("passes root-level createOnly: true to FileContent", () => {
      const raw: RawConfig = {
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

    test("override with no content creates empty file", () => {
      const raw: RawConfig = {
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
        "https://example.com/schema.json",
      );
    });

    test("per-repo schemaUrl overrides root", () => {
      const raw: RawConfig = {
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
        "https://repo.com/schema.json",
      );
    });

    test("schemaUrl is undefined when not specified", () => {
      const raw: RawConfig = {
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
        files: {
          "config.yaml": { schemaUrl: "https://example.com/schema.json" },
        },
        repos: [{ git: "git@github.com:org/repo.git" }],
      };

      const result = normalizeConfig(raw);
      assert.equal(result.repos[0].files[0].content, null);
      assert.equal(
        result.repos[0].files[0].schemaUrl,
        "https://example.com/schema.json",
      );
    });
  });

  describe("type safety", () => {
    test("throws when merging text base with object overlay", () => {
      const raw: RawConfig = {
        files: {
          ".gitignore": { content: "node_modules" }, // text content
        },
        repos: [
          {
            git: "git@github.com:org/repo.git",
            files: {
              // @ts-expect-error - intentionally testing runtime type mismatch
              ".gitignore": { content: { invalid: "object" } }, // object content - type mismatch
            },
          },
        ],
      };

      assert.throws(
        () => normalizeConfig(raw),
        /Expected text content for .gitignore, got object/,
      );
    });
  });

  describe("prTemplate propagation", () => {
    test("prTemplate passed through to Config", () => {
      const raw: RawConfig = {
        files: { "config.json": { content: { key: "value" } } },
        repos: [{ git: "git@github.com:org/repo.git" }],
        prTemplate: "## Custom Template\n\n{{FILE_CHANGES}}",
      };

      const result = normalizeConfig(raw);
      assert.equal(result.prTemplate, "## Custom Template\n\n{{FILE_CHANGES}}");
    });

    test("missing prTemplate results in undefined", () => {
      const raw: RawConfig = {
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
});
