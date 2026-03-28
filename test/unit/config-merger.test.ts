import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  mergeConfigFragments,
  type ConfigFragment,
} from "../../src/config/config-merger.js";

describe("mergeConfigFragments", () => {
  test("concatenates repos from multiple fragments in order", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: {
          id: "test",
          files: { "test.json": { content: {} } },
          repos: [{ git: "git@github.com:org/repo-a.git" }],
        },
      },
      {
        fileName: "b.yaml",
        config: {
          repos: [{ git: "git@github.com:org/repo-b.git" }],
        },
      },
    ];

    const result = mergeConfigFragments(fragments);

    assert.equal(result.id, "test");
    assert.equal(result.repos.length, 2);
    assert.equal(result.repos[0].git, "git@github.com:org/repo-a.git");
    assert.equal(result.repos[1].git, "git@github.com:org/repo-b.git");
  });

  test("errors when no fragments are provided", () => {
    assert.throws(
      () => mergeConfigFragments([]),
      (err: Error) => err.message.includes("No config fragments to merge")
    );
  });

  test("errors when id is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      { fileName: "a.yaml", config: { id: "one", repos: [] } },
      { fileName: "b.yaml", config: { id: "two", repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) =>
        err.message.includes("'id' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when files is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: { id: "test", files: { "a.json": { content: {} } }, repos: [] },
      },
      {
        fileName: "b.yaml",
        config: { files: { "b.json": { content: {} } }, repos: [] },
      },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) =>
        err.message.includes("'files' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when prOptions is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: { id: "test", prOptions: { merge: "auto" }, repos: [] },
      },
      {
        fileName: "b.yaml",
        config: { prOptions: { merge: "direct" }, repos: [] },
      },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) =>
        err.message.includes("'prOptions' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when settings is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: { id: "test", settings: { labels: {} }, repos: [] },
      },
      { fileName: "b.yaml", config: { settings: { labels: {} }, repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) =>
        err.message.includes("'settings' is defined in both a.yaml and b.yaml")
    );
  });

  test("errors when prTemplate is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: { id: "test", prTemplate: "a", repos: [] },
      },
      { fileName: "b.yaml", config: { prTemplate: "b", repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) =>
        err.message.includes(
          "'prTemplate' is defined in both a.yaml and b.yaml"
        )
    );
  });

  test("errors when githubHosts is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: { id: "test", githubHosts: ["a.com"], repos: [] },
      },
      { fileName: "b.yaml", config: { githubHosts: ["b.com"], repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) =>
        err.message.includes(
          "'githubHosts' is defined in both a.yaml and b.yaml"
        )
    );
  });

  test("errors when deleteOrphaned is defined in multiple files", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: { id: "test", deleteOrphaned: true, repos: [] },
      },
      { fileName: "b.yaml", config: { deleteOrphaned: false, repos: [] } },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) =>
        err.message.includes(
          "'deleteOrphaned' is defined in both a.yaml and b.yaml"
        )
    );
  });

  test("errors when no file defines id", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: { repos: [{ git: "git@github.com:org/a.git" }] },
      },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) => err.message.includes("No 'id' found in any config file")
    );
  });

  test("errors when no file defines repos", () => {
    const fragments: ConfigFragment[] = [
      {
        fileName: "a.yaml",
        config: { id: "test", files: { "a.json": { content: {} } } },
      },
    ];

    assert.throws(
      () => mergeConfigFragments(fragments),
      (err: Error) =>
        err.message.includes("No 'repos' found in any config file")
    );
  });
});
