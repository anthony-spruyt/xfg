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

const directive = (strategy: string, ...values: unknown[]) => ({
  $arrayMerge: strategy,
  $values: values,
});

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

describe("array directives in the normalizer", () => {
  describe("prOptions.labels", () => {
    test("a repo directive appends to the root labels", () => {
      const config = normalize({
        prOptions: { labels: ["a"] },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            prOptions: { labels: directive("append", "b") },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].prOptions?.labels, ["a", "b"]);
    });

    test("a group directive appends to the root labels", () => {
      const config = normalize({
        prOptions: { labels: ["a"] },
        groups: { g: { prOptions: { labels: directive("append", "b") } } },
        repos: [{ git: "https://github.com/org/repo.git", groups: ["g"] }],
      });
      assert.deepStrictEqual(config.repos[0].prOptions?.labels, ["a", "b"]);
    });

    test("a plain repo list replaces a group directive", () => {
      const config = normalize({
        groups: { g: { prOptions: { labels: directive("append", "b") } } },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            groups: ["g"],
            prOptions: { labels: ["c"] },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].prOptions?.labels, ["c"]);
    });

    test("a directive with no base leaves only its values", () => {
      const config = normalize({
        prOptions: { labels: directive("append", "a") },
      });
      assert.deepStrictEqual(config.repos[0].prOptions, { labels: ["a"] });
    });

    test("a directive left by a group resolves against a later directive", () => {
      const config = normalize({
        groups: { g: { prOptions: { labels: directive("append", "a") } } },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            groups: ["g"],
            prOptions: { labels: directive("append", "b") },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].prOptions?.labels, ["a", "b"]);
    });

    test("repeated labels are dropped, first wins", () => {
      const config = normalize({
        prOptions: { labels: ["a", "b"] },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            prOptions: { labels: directive("append", "b", "c") },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].prOptions?.labels, [
        "a",
        "b",
        "c",
      ]);
    });

    test("ai still replaces whole while labels merge", () => {
      const config = normalize({
        prOptions: { ai: { provider: "anthropic", model: "x" }, labels: ["a"] },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            prOptions: { ai: { provider: "openai" }, labels: ["b"] },
          },
        ],
      });
      assert.deepStrictEqual(config.repos[0].prOptions?.ai, {
        provider: "openai",
      });
      assert.deepStrictEqual(config.repos[0].prOptions?.labels, ["b"]);
    });
  });

  describe("settings blocks", () => {
    test("a directive appends to inherited actions.patternsAllowed", () => {
      assert.deepStrictEqual(
        merge(
          { actions: { patternsAllowed: ["a@*"] } },
          { actions: { patternsAllowed: directive("append", "b@*") } }
        ),
        { actions: { patternsAllowed: ["a@*", "b@*"] } }
      );
    });

    test("a plain actions.patternsAllowed replaces the inherited one", () => {
      assert.deepStrictEqual(
        merge(
          { actions: { patternsAllowed: ["a@*"] } },
          { actions: { patternsAllowed: ["b@*"] } }
        ),
        { actions: { patternsAllowed: ["b@*"] } }
      );
    });

    test("a directive with no base resolves to its values", () => {
      assert.deepStrictEqual(
        merge(undefined, {
          actions: { patternsAllowed: directive("append", "a@*") },
        }),
        { actions: { patternsAllowed: ["a@*"] } }
      );
    });

    test("an invalid directive names the block it sits in", () => {
      assert.throws(
        () =>
          merge(
            { actions: { patternsAllowed: ["a@*"] } },
            { actions: { patternsAllowed: directive("union", "b@*") } }
          ),
        /settings\.actions: patternsAllowed: \$arrayMerge must be one of/
      );
    });

    test("a directive in a code scanning layer resolves to its values", () => {
      assert.deepStrictEqual(
        merge(undefined, {
          codeScanning: {
            state: "configured",
            languages: directive("append", "go"),
          },
        }),
        { codeScanning: { state: "configured", languages: ["go"] } }
      );
    });

    test("a directive in a deployment branch policy resolves to its values", () => {
      const pattern = { type: "branch", name: "main" };
      assert.deepStrictEqual(
        merge(undefined, {
          environments: {
            prod: {
              deploymentBranchPolicy: { custom: directive("append", pattern) },
            },
          },
        }),
        {
          environments: {
            prod: { deploymentBranchPolicy: { custom: [pattern] } },
          },
        }
      );
    });

    test("a directive of users appends to the inherited users", () => {
      assert.deepStrictEqual(
        merge(
          { collaborators: { users: ["alice"] } },
          { collaborators: { users: directive("append", "bob") } }
        ),
        { collaborators: { users: ["alice", "bob"] } }
      );
    });

    test("a directive of users with no base resolves to its values", () => {
      assert.deepStrictEqual(
        merge(undefined, {
          collaborators: { users: directive("append", "bob") },
        }),
        { collaborators: { users: ["bob"] } }
      );
    });
  });

  describe("repeated items", () => {
    test("repeated primitives in one ruleset array are dropped", () => {
      assert.deepStrictEqual(
        merge(undefined, {
          rulesets: {
            main: {
              conditions: {
                refName: { include: ["a", "b", "a"], exclude: ["x", "x"] },
              },
            },
          },
        }),
        {
          rulesets: {
            main: {
              conditions: { refName: { include: ["a", "b"], exclude: ["x"] } },
            },
          },
        }
      );
    });

    test("an append that repeats an inherited ruleset item adds nothing", () => {
      assert.deepStrictEqual(
        merge(
          {
            rulesets: {
              main: { conditions: { refName: { include: ["a"] } } },
            },
          },
          {
            rulesets: {
              main: {
                conditions: {
                  refName: { include: directive("append", "a", "b") },
                },
              },
            },
          }
        ),
        {
          rulesets: {
            main: { conditions: { refName: { include: ["a", "b"] } } },
          },
        }
      );
    });

    test("repeated code scanning languages are dropped", () => {
      assert.deepStrictEqual(
        merge(undefined, {
          codeScanning: { state: "configured", languages: ["go", "go"] },
        }),
        { codeScanning: { state: "configured", languages: ["go"] } }
      );
    });

    test("repeated action patterns are dropped", () => {
      assert.deepStrictEqual(
        merge(undefined, { actions: { patternsAllowed: ["a@*", "a@*"] } }),
        { actions: { patternsAllowed: ["a@*"] } }
      );
    });

    test("object items are kept even when they look alike", () => {
      const actor = { actorId: 1, actorType: "Team" };
      assert.deepStrictEqual(
        merge(undefined, {
          rulesets: { main: { bypassActors: [actor, { ...actor }] } },
        }),
        { rulesets: { main: { bypassActors: [actor, { ...actor }] } } }
      );
    });
  });

  describe("names that look like directive keys", () => {
    test("a ruleset named $values survives", () => {
      assert.deepStrictEqual(
        merge(undefined, { rulesets: { $values: { target: "branch" } } }),
        { rulesets: { $values: { target: "branch" } } }
      );
    });

    test("a label named $arrayMerge survives", () => {
      assert.deepStrictEqual(
        merge(undefined, { labels: { $arrayMerge: { color: "ff0000" } } }),
        { labels: { $arrayMerge: { color: "ff0000" } } }
      );
    });

    test("an environment named $matchBy survives", () => {
      assert.deepStrictEqual(
        merge(undefined, {
          environments: {
            $matchBy: { deploymentBranchPolicy: { protectedBranches: true } },
          },
        }),
        {
          environments: {
            $matchBy: { deploymentBranchPolicy: { protectedBranches: true } },
          },
        }
      );
    });
  });
});
