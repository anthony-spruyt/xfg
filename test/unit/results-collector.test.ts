import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { ResultsCollector } from "../../src/cli/results-collector.js";

describe("ResultsCollector", () => {
  test("getOrCreate returns new result for unknown repo", () => {
    const collector = new ResultsCollector();
    const result = collector.getOrCreate("my-repo");
    assert.equal(result.repoName, "my-repo");
  });

  test("getOrCreate returns same result for same repo", () => {
    const collector = new ResultsCollector();
    const first = collector.getOrCreate("my-repo");
    first.error = "some error";
    const second = collector.getOrCreate("my-repo");
    assert.equal(second.error, "some error");
  });

  test("appendError sets error on new entry", () => {
    const collector = new ResultsCollector();
    collector.appendError("my-repo", new Error("first"));
    const result = collector.getOrCreate("my-repo");
    assert.equal(result.error, "first");
  });

  test("appendError appends to existing error", () => {
    const collector = new ResultsCollector();
    collector.appendError("my-repo", new Error("first"));
    collector.appendError("my-repo", "second");
    const result = collector.getOrCreate("my-repo");
    assert.equal(result.error, "first; second");
  });

  test("getAll returns all collected results", () => {
    const collector = new ResultsCollector();
    collector.getOrCreate("repo-a");
    collector.getOrCreate("repo-b");
    const all = collector.getAll();
    assert.equal(all.length, 2);
    assert.equal(all[0].repoName, "repo-a");
    assert.equal(all[1].repoName, "repo-b");
  });
});
