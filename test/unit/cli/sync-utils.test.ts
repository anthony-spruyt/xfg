import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  getUniqueFileNames,
  generateBranchName,
  formatFileNames,
  determineMergeOutcome,
} from "../../../src/cli/sync-utils.js";
import type { RepoConfig } from "../../../src/config/index.js";
import type { ProcessorResult } from "../../../src/sync/index.js";

function makeRepo(fileNames: string[]): RepoConfig {
  return {
    git: "https://github.com/test/repo",
    files: fileNames.map((fileName) => ({ fileName, content: null })),
  };
}

function makeResult(overrides: Partial<ProcessorResult> = {}): ProcessorResult {
  return {
    success: true,
    repoName: "test-repo",
    message: "ok",
    ...overrides,
  };
}

describe("getUniqueFileNames", () => {
  test("returns file names from a single repo", () => {
    const config = { repos: [makeRepo(["a.yaml", "b.json"])] };
    assert.deepEqual(getUniqueFileNames(config), ["a.yaml", "b.json"]);
  });

  test("deduplicates file names across repos", () => {
    const config = {
      repos: [
        makeRepo(["shared.yaml", "unique-a.json"]),
        makeRepo(["shared.yaml", "unique-b.json"]),
      ],
    };
    const result = getUniqueFileNames(config);
    assert.deepEqual(result, ["shared.yaml", "unique-a.json", "unique-b.json"]);
  });

  test("returns empty array when no repos", () => {
    const config = { repos: [] };
    assert.deepEqual(getUniqueFileNames(config), []);
  });

  test("returns empty array when repos have no files", () => {
    const config = { repos: [makeRepo([])] };
    assert.deepEqual(getUniqueFileNames(config), []);
  });

  test("preserves insertion order across multiple repos", () => {
    const config = {
      repos: [makeRepo(["z.yaml", "a.yaml"]), makeRepo(["m.yaml"])],
    };
    assert.deepEqual(getUniqueFileNames(config), [
      "z.yaml",
      "a.yaml",
      "m.yaml",
    ]);
  });

  test("handles single file across many repos", () => {
    const config = {
      repos: [
        makeRepo([".eslintrc.json"]),
        makeRepo([".eslintrc.json"]),
        makeRepo([".eslintrc.json"]),
      ],
    };
    assert.deepEqual(getUniqueFileNames(config), [".eslintrc.json"]);
  });
});

describe("generateBranchName", () => {
  test("uses sanitized file name for single file", () => {
    assert.equal(generateBranchName(["MyFile.yaml"]), "chore/sync-myfile");
  });

  test("returns generic branch name for multiple files", () => {
    assert.equal(generateBranchName(["a.yaml", "b.json"]), "chore/sync-config");
  });

  test("returns generic branch name for empty array", () => {
    // length !== 1, so falls through to default
    assert.equal(generateBranchName([]), "chore/sync-config");
  });

  test("sanitizes special characters in single file name", () => {
    assert.equal(
      generateBranchName(["my file@v2.json"]),
      "chore/sync-my-file-v2"
    );
  });

  test("handles dotfile as single file", () => {
    assert.equal(generateBranchName([".eslintrc.json"]), "chore/sync-eslintrc");
  });
});

describe("formatFileNames", () => {
  test("returns single file name as-is", () => {
    assert.equal(formatFileNames(["config.yaml"]), "config.yaml");
  });

  test("joins two file names with comma", () => {
    assert.equal(formatFileNames(["a.yaml", "b.json"]), "a.yaml, b.json");
  });

  test("joins three file names with commas", () => {
    assert.equal(
      formatFileNames(["a.yaml", "b.json", "c.txt"]),
      "a.yaml, b.json, c.txt"
    );
  });

  test("returns count for more than three files", () => {
    assert.equal(
      formatFileNames(["a.yaml", "b.json", "c.txt", "d.md"]),
      "4 files"
    );
  });

  test("returns count for many files", () => {
    const files = Array.from({ length: 10 }, (_, i) => `file${i}.yaml`);
    assert.equal(formatFileNames(files), "10 files");
  });
});

describe("determineMergeOutcome", () => {
  test("returns undefined when result is not successful", () => {
    const result = makeResult({ success: false });
    assert.equal(determineMergeOutcome(result), undefined);
  });

  test("returns 'direct' when successful with no PR URL", () => {
    const result = makeResult({ prUrl: undefined });
    assert.equal(determineMergeOutcome(result), "direct");
  });

  test("returns 'force' when PR was merged", () => {
    const result = makeResult({
      prUrl: "https://github.com/test/repo/pull/1",
      mergeResult: { merged: true, message: "merged" },
    });
    assert.equal(determineMergeOutcome(result), "force");
  });

  test("returns 'auto' when auto-merge is enabled but not yet merged", () => {
    const result = makeResult({
      prUrl: "https://github.com/test/repo/pull/1",
      mergeResult: {
        merged: false,
        autoMergeEnabled: true,
        message: "auto-merge enabled",
      },
    });
    assert.equal(determineMergeOutcome(result), "auto");
  });

  test("returns 'manual' when PR exists but not merged and no auto-merge", () => {
    const result = makeResult({
      prUrl: "https://github.com/test/repo/pull/1",
      mergeResult: {
        merged: false,
        autoMergeEnabled: false,
        message: "awaiting review",
      },
    });
    assert.equal(determineMergeOutcome(result), "manual");
  });

  test("returns 'manual' when PR exists with no merge result", () => {
    const result = makeResult({
      prUrl: "https://github.com/test/repo/pull/1",
    });
    assert.equal(determineMergeOutcome(result), "manual");
  });

  test("returns 'direct' when successful with empty string prUrl", () => {
    // Empty string is falsy, so treated as no PR
    const result = makeResult({ prUrl: "" });
    assert.equal(determineMergeOutcome(result), "direct");
  });

  test("returns 'force' even when autoMergeEnabled is also true", () => {
    // merged takes precedence over autoMergeEnabled
    const result = makeResult({
      prUrl: "https://github.com/test/repo/pull/1",
      mergeResult: {
        merged: true,
        autoMergeEnabled: true,
        message: "merged with auto-merge",
      },
    });
    assert.equal(determineMergeOutcome(result), "force");
  });

  test("returns 'manual' when mergeResult has autoMergeEnabled undefined", () => {
    const result = makeResult({
      prUrl: "https://github.com/test/repo/pull/1",
      mergeResult: {
        merged: false,
        message: "pending",
      },
    });
    assert.equal(determineMergeOutcome(result), "manual");
  });
});
