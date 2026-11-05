import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { mergeSettings } from "../../../src/config/normalizer.js";
import type {
  RawRepoSettings,
  RawRootSettings,
} from "../../../src/config/types.js";

function merge(root: unknown, repo: unknown): unknown {
  return mergeSettings(
    root as RawRootSettings | undefined,
    repo as RawRepoSettings | undefined
  );
}

describe("mergeSettings - empty blocks", () => {
  describe("repo and actions blocks", () => {
    for (const key of ["repo", "actions"]) {
      test(`${key}: {} at the root is kept`, () => {
        assert.deepStrictEqual(merge({ [key]: {} }, undefined), { [key]: {} });
      });

      test(`${key}: {} in the repo layer is kept`, () => {
        assert.deepStrictEqual(merge(undefined, { [key]: {} }), { [key]: {} });
      });

      test(`${key}: {} in both layers is kept`, () => {
        assert.deepStrictEqual(merge({ [key]: {} }, { [key]: {} }), {
          [key]: {},
        });
      });

      test(`${key}: {} in the repo layer inherits the root fields`, () => {
        const field = key === "repo" ? { hasWiki: true } : { cacheSizeGb: 5 };
        assert.deepStrictEqual(merge({ [key]: field }, { [key]: {} }), {
          [key]: field,
        });
      });
    }

    test("repo: false in the repo layer opts out of the root", () => {
      assert.strictEqual(
        merge({ repo: { hasWiki: true } }, { repo: false }),
        undefined
      );
    });

    test("actions: false in the repo layer opts out of the root", () => {
      assert.strictEqual(
        merge({ actions: { cacheSizeGb: 5 } }, { actions: false }),
        undefined
      );
    });
  });

  describe("collaborators", () => {
    test("an empty users list with nothing else is dropped", () => {
      assert.strictEqual(
        merge(undefined, { collaborators: { users: [] } }),
        undefined
      );
    });

    test("an empty users list with deleteOrphaned: false is kept", () => {
      assert.deepStrictEqual(
        merge(undefined, {
          collaborators: { users: [], deleteOrphaned: false },
        }),
        { collaborators: { users: [], deleteOrphaned: false } }
      );
    });

    test("deleteOrphaned alone yields an empty users list", () => {
      assert.deepStrictEqual(
        merge(undefined, { collaborators: { deleteOrphaned: true } }),
        { collaborators: { users: [], deleteOrphaned: true } }
      );
      assert.deepStrictEqual(
        merge(undefined, { collaborators: { deleteOrphaned: false } }),
        { collaborators: { users: [], deleteOrphaned: false } }
      );
    });

    test("deleteOrphaned from the root is kept", () => {
      assert.deepStrictEqual(
        merge({ collaborators: { users: [], deleteOrphaned: false } }, {}),
        { collaborators: { users: [], deleteOrphaned: false } }
      );
    });

    test("deleteOrphaned set in the repo layer wins over the root", () => {
      const result = merge(
        { collaborators: { users: ["a"], deleteOrphaned: true } },
        { collaborators: { users: ["b"], deleteOrphaned: false } }
      ) as RawRepoSettings;
      assert.strictEqual(result.collaborators?.deleteOrphaned, false);
    });

    test("deleteOrphaned left out in the repo layer is inherited", () => {
      const result = merge(
        { collaborators: { users: ["a"], deleteOrphaned: true } },
        { collaborators: { users: ["b"] } }
      ) as RawRepoSettings;
      assert.strictEqual(result.collaborators?.deleteOrphaned, true);
    });

    test("inherit: false with no users drops the root block", () => {
      assert.strictEqual(
        merge(
          { collaborators: { users: ["a"] } },
          { collaborators: { inherit: false } }
        ),
        undefined
      );
      assert.strictEqual(
        merge(
          { collaborators: { users: ["a"] } },
          { collaborators: { inherit: false, users: [] } }
        ),
        undefined
      );
    });
  });

  for (const key of ["variables", "secrets"]) {
    describe(key, () => {
      test("an empty map is dropped", () => {
        assert.strictEqual(merge(undefined, { [key]: {} }), undefined);
      });

      test("deleteOrphaned: false alone is dropped", () => {
        assert.strictEqual(
          merge(undefined, { [key]: { deleteOrphaned: false } }),
          undefined
        );
      });

      test("deleteOrphaned: true alone is kept", () => {
        assert.deepStrictEqual(
          merge(undefined, { [key]: { deleteOrphaned: true } }),
          { [key]: { deleteOrphaned: true } }
        );
      });

      test("an empty map in the repo layer inherits the root entries", () => {
        assert.deepStrictEqual(merge({ [key]: { A: "1" } }, { [key]: {} }), {
          [key]: { A: "1" },
        });
      });

      test("opting out the only entry drops the block", () => {
        assert.strictEqual(
          merge({ [key]: { A: "1" } }, { [key]: { A: false } }),
          undefined
        );
      });

      test("inherit: false with no entries drops the root entries", () => {
        assert.strictEqual(
          merge({ [key]: { A: "1" } }, { [key]: { inherit: false } }),
          undefined
        );
      });

      test("deleteOrphaned set in the repo layer wins over the root", () => {
        assert.deepStrictEqual(
          merge(
            { [key]: { A: "1", deleteOrphaned: true } },
            { [key]: { B: "2", deleteOrphaned: false } }
          ),
          { [key]: { A: "1", B: "2", deleteOrphaned: false } }
        );
      });

      test("deleteOrphaned left out in the repo layer is inherited", () => {
        assert.deepStrictEqual(
          merge(
            { [key]: { A: "1", deleteOrphaned: true } },
            { [key]: { B: "2" } }
          ),
          { [key]: { A: "1", B: "2", deleteOrphaned: true } }
        );
      });
    });
  }

  describe("labels, rulesets and codeScanning", () => {
    test("an empty labels map is dropped", () => {
      assert.strictEqual(merge(undefined, { labels: {} }), undefined);
    });

    test("opting out the only label drops the block", () => {
      assert.strictEqual(
        merge({ labels: { a: { color: "ff0000" } } }, { labels: { a: false } }),
        undefined
      );
    });

    test("an empty rulesets map is dropped", () => {
      assert.strictEqual(merge(undefined, { rulesets: {} }), undefined);
    });

    test("opting out the only ruleset drops the block", () => {
      assert.strictEqual(
        merge(
          { rulesets: { a: { target: "branch" } } },
          { rulesets: { a: false } }
        ),
        undefined
      );
    });

    test("codeScanning: false in the repo layer opts out of the root", () => {
      assert.strictEqual(
        merge(
          { codeScanning: { state: "configured" } },
          { codeScanning: false }
        ),
        undefined
      );
    });
  });

  describe("inherit: false and an entry of the same name", () => {
    test("a ruleset drops the inherited fields of that ruleset", () => {
      assert.deepStrictEqual(
        merge(
          { rulesets: { x: { target: "branch", enforcement: "active" } } },
          {
            rulesets: { inherit: false, x: { rules: [{ type: "deletion" }] } },
          }
        ),
        { rulesets: { x: { rules: [{ type: "deletion" }] } } }
      );
    });

    test("a label drops the inherited fields of that label", () => {
      assert.deepStrictEqual(
        merge(
          { labels: { a: { color: "ff0000", description: "d" } } },
          { labels: { inherit: false, a: { color: "00ff00" } } }
        ),
        { labels: { a: { color: "00ff00" } } }
      );
    });
  });

  describe("settings as a whole", () => {
    test("no settings anywhere is undefined", () => {
      assert.strictEqual(merge(undefined, undefined), undefined);
    });

    test("empty settings in both layers is undefined", () => {
      assert.strictEqual(merge({}, {}), undefined);
    });

    test("deleteOrphaned set in the repo layer wins over the root", () => {
      assert.deepStrictEqual(
        merge({ deleteOrphaned: true }, { deleteOrphaned: false }),
        { deleteOrphaned: false }
      );
    });

    test("deleteOrphaned left out in the repo layer is inherited", () => {
      assert.deepStrictEqual(merge({ deleteOrphaned: true }, undefined), {
        deleteOrphaned: true,
      });
    });
  });
});
