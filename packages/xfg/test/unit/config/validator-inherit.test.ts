import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { validateRawConfig } from "../../../src/config/validator.js";
import type { RawConfig } from "../../../src/config/types.js";

function config(extra: Record<string, unknown>): RawConfig {
  return {
    id: "test",
    files: { "a.json": { content: { a: 1 } } },
    repos: [{ git: "https://github.com/org/repo.git" }],
    ...extra,
  } as unknown as RawConfig;
}

function accepts(extra: Record<string, unknown>): void {
  assert.doesNotThrow(() => validateRawConfig(config(extra)));
}

function rejects(extra: Record<string, unknown>, message: RegExp): void {
  assert.throws(() => validateRawConfig(config(extra)), message);
}

const repoLayer = (settings: Record<string, unknown>) => ({
  repos: [{ git: "https://github.com/org/repo.git", settings }],
});
const groupLayer = (settings: Record<string, unknown>) => ({
  groups: { g: { settings } },
});

describe("raw validation of inherit on object blocks", () => {
  for (const [block, fields] of [
    ["repo", { hasWiki: true }],
    ["actions", { enabled: true }],
  ] as const) {
    describe(`settings.${block}`, () => {
      const root = { settings: { [block]: fields } };

      test("accepts inherit: false in a repo layer", () => {
        accepts({ ...root, ...repoLayer({ [block]: { inherit: false } }) });
      });

      test("accepts inherit: false in a group layer", () => {
        accepts({ ...root, ...groupLayer({ [block]: { inherit: false } }) });
      });

      test("rejects an inherit that is not a boolean", () => {
        rejects(
          { ...root, ...repoLayer({ [block]: { inherit: "no" } }) },
          new RegExp(`${block}.*inherit must be a boolean`)
        );
      });

      test("rejects inherit at the root", () => {
        rejects(
          { settings: { [block]: { ...fields, inherit: false } } },
          new RegExp(`'inherit' is not allowed in root-level ${block}`)
        );
      });
    });
  }

  describe("prOptions", () => {
    test("accepts inherit: false in a repo layer", () => {
      accepts({
        prOptions: { merge: "squash" },
        repos: [
          {
            git: "https://github.com/org/repo.git",
            prOptions: { inherit: false },
          },
        ],
      });
    });

    test("accepts inherit: false in a group layer", () => {
      accepts({ groups: { g: { prOptions: { inherit: false } } } });
    });

    test("rejects an inherit that is not a boolean", () => {
      rejects(
        { groups: { g: { prOptions: { inherit: "no" } } } },
        /groups\.g: prOptions\.inherit must be a boolean/
      );
    });

    test("rejects inherit at the root", () => {
      rejects(
        { prOptions: { inherit: false } },
        /'inherit' is not allowed in root-level prOptions/
      );
    });
  });
});

describe("raw validation of inherit on a single entry", () => {
  const ruleset = { target: "branch", enforcement: "active" };
  const label = { color: "d73a4a" };
  const environment = { deploymentBranchPolicy: { protectedBranches: true } };

  for (const [block, name, entry, label_] of [
    ["rulesets", "main", ruleset, "ruleset 'main'"],
    ["labels", "bug", label, "label 'bug'"],
    ["environments", "release", environment, "environment 'release'"],
  ] as const) {
    describe(`settings.${block}`, () => {
      const root = { settings: { [block]: { [name]: entry } } };
      const withInherit = (value: unknown) => ({
        [block]: { [name]: { ...entry, inherit: value } },
      });

      test("accepts inherit: false in a repo layer", () => {
        accepts({ ...root, ...repoLayer(withInherit(false)) });
      });

      test("accepts inherit: false in a group layer", () => {
        accepts({ ...root, ...groupLayer(withInherit(false)) });
      });

      test("rejects an inherit that is not a boolean", () => {
        rejects(
          { ...root, ...repoLayer(withInherit("no")) },
          new RegExp(`${label_}: inherit must be a boolean`)
        );
      });

      test("rejects inherit on a root entry", () => {
        rejects(
          { settings: withInherit(false) },
          new RegExp(
            `'inherit' is not allowed in root-level ${label_} \\(nothing to inherit from\\)`
          )
        );
      });
    });
  }
});
