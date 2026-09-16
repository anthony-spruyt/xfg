import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  resolveExtendsChain,
  expandRepoGroups,
} from "../../../src/config/extends-resolver.js";
import type { RawGroupConfig } from "../../../src/config/index.js";

describe("resolveExtendsChain", () => {
  test("group without extends returns just itself", () => {
    const groups: Record<string, RawGroupConfig> = {
      a: { files: {} },
    };
    assert.deepStrictEqual(resolveExtendsChain("a", groups), ["a"]);
  });

  test("single parent returns [parent, child]", () => {
    const groups: Record<string, RawGroupConfig> = {
      parent: { files: {} },
      child: { extends: "parent", files: {} },
    };
    assert.deepStrictEqual(resolveExtendsChain("child", groups), [
      "parent",
      "child",
    ]);
  });

  test("multi-parent returns parents L-R then child", () => {
    const groups: Record<string, RawGroupConfig> = {
      a: { files: {} },
      b: { files: {} },
      child: { extends: ["a", "b"], files: {} },
    };
    assert.deepStrictEqual(resolveExtendsChain("child", groups), [
      "a",
      "b",
      "child",
    ]);
  });

  test("transitive: grandparent -> parent -> child", () => {
    const groups: Record<string, RawGroupConfig> = {
      gp: { files: {} },
      p: { extends: "gp", files: {} },
      c: { extends: "p", files: {} },
    };
    assert.deepStrictEqual(resolveExtendsChain("c", groups), ["gp", "p", "c"]);
  });

  test("diamond: shared ancestor appears once", () => {
    const groups: Record<string, RawGroupConfig> = {
      base: { files: {} },
      left: { extends: "base", files: {} },
      right: { extends: "base", files: {} },
      top: { extends: ["left", "right"], files: {} },
    };
    assert.deepStrictEqual(resolveExtendsChain("top", groups), [
      "base",
      "left",
      "right",
      "top",
    ]);
  });

  test("throws on circular extends", () => {
    const groups: Record<string, RawGroupConfig> = {
      a: { extends: "b", files: {} },
      b: { extends: "a", files: {} },
    };
    assert.throws(
      () => resolveExtendsChain("a", groups),
      /[Cc]ircular extends/
    );
  });

  test("throws when referenced group does not exist", () => {
    const groups: Record<string, RawGroupConfig> = {
      child: { extends: "missing", files: {} },
    };
    assert.throws(() => resolveExtendsChain("child", groups), /does not exist/);
  });

  test("throws when extends chain exceeds MAX_EXTENDS_DEPTH", () => {
    const depth = 102;
    const groups: Record<string, RawGroupConfig> = {};
    for (let i = 0; i < depth; i++) {
      const name = `g${i}`;
      if (i === 0) {
        groups[name] = { files: {} };
      } else {
        groups[name] = { extends: `g${i - 1}`, files: {} };
      }
    }
    assert.throws(
      () => resolveExtendsChain(`g${depth - 1}`, groups),
      /exceeds maximum depth of 100/
    );
  });
});

describe("expandRepoGroups", () => {
  test("expands multiple groups with deduplication", () => {
    const groups: Record<string, RawGroupConfig> = {
      base: { files: {} },
      left: { extends: "base", files: {} },
      right: { extends: "base", files: {} },
    };
    assert.deepStrictEqual(expandRepoGroups(["left", "right"], groups), [
      "base",
      "left",
      "right",
    ]);
  });

  test("mixed extending and non-extending groups", () => {
    const groups: Record<string, RawGroupConfig> = {
      base: { files: {} },
      derived: { extends: "base", files: {} },
      standalone: { files: {} },
    };
    assert.deepStrictEqual(
      expandRepoGroups(["derived", "standalone"], groups),
      ["base", "derived", "standalone"]
    );
  });

  test("empty groups returns empty", () => {
    assert.deepStrictEqual(expandRepoGroups([], {}), []);
  });
});
