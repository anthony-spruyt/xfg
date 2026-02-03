import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatSummary,
  writeSummary,
  isGitHubActions,
  SummaryData,
  RepoResult,
} from "../../src/github-summary.js";

describe("formatSummary", () => {
  describe("stats table", () => {
    test("generates stats table with all counts", () => {
      const data: SummaryData = {
        total: 4,
        succeeded: 2,
        skipped: 1,
        failed: 1,
        results: [],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("## Config Sync Summary"));
      assert.ok(markdown.includes("| Status | Count |"));
      assert.ok(markdown.includes("✅ Succeeded"));
      assert.ok(markdown.includes("| 2 |"));
      assert.ok(markdown.includes("⏭️ Skipped"));
      assert.ok(markdown.includes("| 1 |"));
      assert.ok(markdown.includes("❌ Failed"));
      assert.ok(markdown.includes("**Total**"));
      assert.ok(markdown.includes("**4**"));
    });

    test("handles zero counts correctly", () => {
      const data: SummaryData = {
        total: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        results: [],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("| 0 |"));
      assert.ok(markdown.includes("**0**"));
    });
  });

  describe("repo details table", () => {
    test("shows PR with manual merge (open)", () => {
      const result: RepoResult = {
        repoName: "org/repo-a",
        status: "succeeded",
        message: "PR created",
        prUrl: "https://github.com/org/repo-a/pull/42",
        mergeOutcome: "manual",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [result],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("<details>"));
      assert.ok(markdown.includes("Repository Details"));
      assert.ok(markdown.includes("org/repo-a"));
      assert.ok(markdown.includes("Open"));
      assert.ok(markdown.includes("[PR #42]"));
      assert.ok(markdown.includes("https://github.com/org/repo-a/pull/42"));
    });

    test("shows PR with auto-merge enabled", () => {
      const result: RepoResult = {
        repoName: "org/repo-b",
        status: "succeeded",
        message: "Auto-merge enabled",
        prUrl: "https://github.com/org/repo-b/pull/15",
        mergeOutcome: "auto",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [result],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("org/repo-b"));
      assert.ok(markdown.includes("Auto-merge"));
      assert.ok(markdown.includes("[PR #15]"));
    });

    test("shows PR with force merge (merged)", () => {
      const result: RepoResult = {
        repoName: "org/repo-c",
        status: "succeeded",
        message: "PR merged",
        prUrl: "https://github.com/org/repo-c/pull/99",
        mergeOutcome: "force",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [result],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("org/repo-c"));
      assert.ok(markdown.includes("Merged"));
      assert.ok(markdown.includes("[PR #99]"));
    });

    test("shows direct push without PR URL", () => {
      const result: RepoResult = {
        repoName: "org/repo-d",
        status: "succeeded",
        message: "Pushed to main",
        mergeOutcome: "direct",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [result],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("org/repo-d"));
      assert.ok(markdown.includes("Pushed"));
      assert.ok(markdown.includes("Direct to"));
    });

    test("shows skipped repos with reason", () => {
      const result: RepoResult = {
        repoName: "org/repo-e",
        status: "skipped",
        message: "No changes",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 0,
        skipped: 1,
        failed: 0,
        results: [result],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("org/repo-e"));
      assert.ok(markdown.includes("Skipped"));
      assert.ok(markdown.includes("No changes"));
    });

    test("shows failed repos with error message", () => {
      const result: RepoResult = {
        repoName: "org/repo-f",
        status: "failed",
        message: "Clone failed: timeout",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 0,
        skipped: 0,
        failed: 1,
        results: [result],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("org/repo-f"));
      assert.ok(markdown.includes("Failed"));
      assert.ok(markdown.includes("Clone failed: timeout"));
    });
  });

  describe("file changes formatting", () => {
    test("formats file changes as +N ~N -N", () => {
      const result: RepoResult = {
        repoName: "org/repo",
        status: "succeeded",
        message: "PR created",
        prUrl: "https://github.com/org/repo/pull/1",
        mergeOutcome: "manual",
        fileChanges: { added: 2, modified: 1, deleted: 0, unchanged: 0 },
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [result],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("+2"));
      assert.ok(markdown.includes("~1"));
      assert.ok(markdown.includes("-0"));
    });

    test("shows dash when no fileChanges", () => {
      const result: RepoResult = {
        repoName: "org/repo",
        status: "skipped",
        message: "No changes",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 0,
        skipped: 1,
        failed: 0,
        results: [result],
      };

      const markdown = formatSummary(data);

      // Should show dash for changes column when no fileChanges
      assert.ok(markdown.includes("| - |"));
    });
  });

  describe("edge cases", () => {
    test("handles empty results array", () => {
      const data: SummaryData = {
        total: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        results: [],
      };

      const markdown = formatSummary(data);

      // Should still have stats table
      assert.ok(markdown.includes("## Config Sync Summary"));
      // But no details section when empty
      assert.ok(!markdown.includes("<details>"));
    });

    test("escapes markdown special chars in messages", () => {
      const result: RepoResult = {
        repoName: "org/repo",
        status: "failed",
        message: "Error: `code` and |pipe| chars",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 0,
        skipped: 0,
        failed: 1,
        results: [result],
      };

      const markdown = formatSummary(data);

      // Pipe chars should be escaped in table cells
      assert.ok(!markdown.includes("||"));
    });

    test("escapes backslashes before pipes to prevent bypass", () => {
      const result: RepoResult = {
        repoName: "org/repo",
        status: "failed",
        message: "Error with \\| backslash-pipe",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 0,
        skipped: 0,
        failed: 1,
        results: [result],
      };

      const markdown = formatSummary(data);

      // Backslash should be escaped first, then pipe
      // Input: \| -> Output: \\| (escaped backslash) + \| (escaped pipe) = \\\|
      assert.ok(markdown.includes("\\\\\\|"));
    });

    test("handles all repos skipped", () => {
      const data: SummaryData = {
        total: 2,
        succeeded: 0,
        skipped: 2,
        failed: 0,
        results: [
          { repoName: "org/repo-a", status: "skipped", message: "No changes" },
          { repoName: "org/repo-b", status: "skipped", message: "No changes" },
        ],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("⏭️ Skipped"));
      assert.ok(markdown.includes("| 2 |"));
    });

    test("handles all repos failed", () => {
      const data: SummaryData = {
        total: 2,
        succeeded: 0,
        skipped: 0,
        failed: 2,
        results: [
          { repoName: "org/repo-a", status: "failed", message: "Error 1" },
          { repoName: "org/repo-b", status: "failed", message: "Error 2" },
        ],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("❌ Failed"));
      assert.ok(markdown.includes("Error 1"));
      assert.ok(markdown.includes("Error 2"));
    });

    test("handles succeeded without mergeOutcome", () => {
      const result: RepoResult = {
        repoName: "org/repo",
        status: "succeeded",
        message: "Done",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [result],
      };

      const markdown = formatSummary(data);

      // Should show generic "Succeeded" status
      assert.ok(markdown.includes("✅ Succeeded"));
    });

    test("handles PR URL without standard format", () => {
      const result: RepoResult = {
        repoName: "org/repo",
        status: "succeeded",
        message: "PR created",
        prUrl: "https://custom.host/merge-request/abc",
        mergeOutcome: "manual",
      };
      const data: SummaryData = {
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [result],
      };

      const markdown = formatSummary(data);

      // Should fall back to "PR" when number can't be extracted
      assert.ok(markdown.includes("[PR #PR]"));
    });
  });
});

describe("writeSummary", () => {
  let tempFile: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempFile = join(tmpdir(), `github-summary-test-${Date.now()}.md`);
    originalEnv = process.env.GITHUB_STEP_SUMMARY;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GITHUB_STEP_SUMMARY;
    } else {
      process.env.GITHUB_STEP_SUMMARY = originalEnv;
    }
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  });

  test("writes markdown to GITHUB_STEP_SUMMARY path", () => {
    process.env.GITHUB_STEP_SUMMARY = tempFile;
    const data: SummaryData = {
      total: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      results: [],
    };

    writeSummary(data);

    assert.ok(existsSync(tempFile));
    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.includes("## Config Sync Summary"));
  });

  test("appends newline after content", () => {
    process.env.GITHUB_STEP_SUMMARY = tempFile;
    const data: SummaryData = {
      total: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      results: [],
    };

    writeSummary(data);

    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.endsWith("\n"));
  });

  test("appends to existing file content", () => {
    writeFileSync(tempFile, "# Existing Content\n");
    process.env.GITHUB_STEP_SUMMARY = tempFile;
    const data: SummaryData = {
      total: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      results: [],
    };

    writeSummary(data);

    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.includes("# Existing Content"));
    assert.ok(content.includes("## Config Sync Summary"));
  });

  test("no-ops when env var not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    const data: SummaryData = {
      total: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      results: [],
    };

    // Should not throw
    writeSummary(data);

    // File should not be created
    assert.ok(!existsSync(tempFile));
  });

  test("no-ops when env var is empty string", () => {
    process.env.GITHUB_STEP_SUMMARY = "";
    const data: SummaryData = {
      total: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      results: [],
    };

    // Should not throw
    writeSummary(data);
  });
});

describe("isGitHubActions", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GITHUB_STEP_SUMMARY;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GITHUB_STEP_SUMMARY;
    } else {
      process.env.GITHUB_STEP_SUMMARY = originalEnv;
    }
  });

  test("returns true when GITHUB_STEP_SUMMARY set", () => {
    process.env.GITHUB_STEP_SUMMARY = "/path/to/summary";

    assert.equal(isGitHubActions(), true);
  });

  test("returns false when not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;

    assert.equal(isGitHubActions(), false);
  });

  test("returns false when empty string", () => {
    process.env.GITHUB_STEP_SUMMARY = "";

    assert.equal(isGitHubActions(), false);
  });
});
