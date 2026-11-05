import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  normalizeConfig,
  mergeSettings,
} from "../../../src/config/normalizer.js";
import type {
  RawConfig,
  RawRepoSettings,
  RawRootSettings,
} from "../../../src/config/types.js";

function merge(root: unknown, repo: unknown): unknown {
  return mergeSettings(
    root as RawRootSettings | undefined,
    repo as RawRepoSettings | undefined
  );
}

function normalize(raw: Record<string, unknown>) {
  return normalizeConfig(
    {
      id: "test",
      repos: [{ git: "https://github.com/org/repo.git" }],
      ...raw,
    } as unknown as RawConfig,
    {}
  );
}

describe("inherit: false on object blocks", () => {
  describe("settings.repo", () => {
    const root = { repo: { description: "root", hasIssues: true } };

    test("drops the inherited fields and keeps the layer's own", () => {
      assert.deepStrictEqual(
        merge(root, { repo: { inherit: false, hasWiki: true } }),
        { repo: { hasWiki: true } }
      );
    });

    test("alone leaves an empty block", () => {
      assert.deepStrictEqual(merge(root, { repo: { inherit: false } }), {
        repo: {},
      });
    });

    test("inherit: true changes nothing and is not kept", () => {
      assert.deepStrictEqual(
        merge(root, { repo: { inherit: true, hasWiki: true } }),
        { repo: { description: "root", hasIssues: true, hasWiki: true } }
      );
    });

    test("without inherit the fields merge", () => {
      assert.deepStrictEqual(merge(root, { repo: { hasWiki: true } }), {
        repo: { description: "root", hasIssues: true, hasWiki: true },
      });
    });

    test("a group's inherit: false drops the root fields and a repo adds on top", () => {
      const config = normalize({
        settings: root,
        groups: {
          g: { settings: { repo: { inherit: false, hasWiki: true } } },
        },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            groups: ["g"],
            settings: { repo: { hasProjects: true } },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].settings?.repo, {
        hasWiki: true,
        hasProjects: true,
      });
    });
  });

  describe("settings.actions", () => {
    const root = {
      actions: {
        enabled: true,
        allowedActions: "selected",
        patternsAllowed: ["a@*"],
      },
    };

    test("drops the inherited fields and keeps the layer's own", () => {
      assert.deepStrictEqual(
        merge(root, { actions: { inherit: false, enabled: false } }),
        { actions: { enabled: false } }
      );
    });

    test("drops an inherited array, and a directive then has no base", () => {
      assert.deepStrictEqual(
        merge(root, {
          actions: {
            inherit: false,
            allowedActions: "selected",
            patternsAllowed: { $arrayMerge: "append", $values: ["b@*"] },
          },
        }),
        { actions: { allowedActions: "selected", patternsAllowed: ["b@*"] } }
      );
    });

    test("inherit: true changes nothing and is not kept", () => {
      assert.deepStrictEqual(
        merge(root, { actions: { inherit: true, enabled: false } }),
        {
          actions: {
            enabled: false,
            allowedActions: "selected",
            patternsAllowed: ["a@*"],
          },
        }
      );
    });
  });

  describe("prOptions", () => {
    test("drops the inherited fields, ai included", () => {
      const config = normalize({
        prOptions: {
          merge: "squash",
          labels: ["a"],
          ai: { provider: "openai" },
        },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            prOptions: { inherit: false, labels: ["b"] },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].prOptions, { labels: ["b"] });
    });

    test("alone leaves no prOptions", () => {
      const config = normalize({
        prOptions: { merge: "squash" },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            prOptions: { inherit: false },
          },
        ],
      });
      assert.equal(config.repos[0].prOptions, undefined);
    });

    test("is not kept when nothing is inherited", () => {
      const config = normalize({
        repos: [
          {
            git: "https://github.com/org/repo.git",
            prOptions: { inherit: false, labels: ["b"] },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].prOptions, { labels: ["b"] });
    });

    test("a group's inherit: false drops the root fields and a repo adds on top", () => {
      const config = normalize({
        prOptions: { merge: "squash", labels: ["a"] },
        groups: { g: { prOptions: { inherit: false, merge: "auto" } } },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            groups: ["g"],
            prOptions: { labels: ["b"] },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].prOptions, {
        merge: "auto",
        labels: ["b"],
      });
    });

    test("inherit: true changes nothing and is not kept", () => {
      const config = normalize({
        prOptions: { merge: "squash", labels: ["a"] },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            prOptions: { inherit: true, merge: "auto" },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].prOptions, {
        merge: "auto",
        labels: ["a"],
      });
    });

    test("ai merges field by field when the layer sets it", () => {
      const config = normalize({
        prOptions: { ai: { provider: "openai", model: "x" } },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            prOptions: { ai: { model: "y" } },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].prOptions?.ai, {
        provider: "openai",
        model: "y",
      });
    });
  });
});
