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
  describe("title", () => {
    test("uses provided title as the summary header", () => {
      const data: SummaryData = {
        title: "Repository Settings Summary",
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("## Repository Settings Summary"));
      assert.ok(!markdown.includes("Config Sync Summary"));
    });
  });

  describe("stats table", () => {
    test("generates stats table with all counts", () => {
      const data: SummaryData = {
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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
        title: "Config Sync Summary",
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

  describe("dry-run mode", () => {
    test("appends '(Dry Run)' to the title", () => {
      const data: SummaryData = {
        title: "Config Sync Summary",
        dryRun: true,
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("## Config Sync Summary (Dry Run)"));
    });

    test("includes warning admonition banner", () => {
      const data: SummaryData = {
        title: "Config Sync Summary",
        dryRun: true,
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("> [!WARNING]"));
      assert.ok(
        markdown.includes("> This was a dry run — no changes were applied")
      );
    });

    test("stats table shows hypothetical labels", () => {
      const data: SummaryData = {
        title: "Config Sync Summary",
        dryRun: true,
        total: 3,
        succeeded: 1,
        skipped: 1,
        failed: 1,
        results: [],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("✅ Would Succeed"));
      assert.ok(markdown.includes("⏭️ Would Skip"));
      assert.ok(markdown.includes("❌ Would Fail"));
      assert.ok(!markdown.includes("✅ Succeeded"));
      assert.ok(!markdown.includes("⏭️ Skipped"));
      assert.ok(!markdown.includes("❌ Failed"));
    });

    test("repo detail statuses show hypothetical wording", () => {
      const results: RepoResult[] = [
        {
          repoName: "org/repo-a",
          status: "succeeded",
          message: "PR created",
          prUrl: "https://github.com/org/repo-a/pull/42",
          mergeOutcome: "manual",
        },
        {
          repoName: "org/repo-b",
          status: "succeeded",
          message: "Auto-merge enabled",
          prUrl: "https://github.com/org/repo-b/pull/15",
          mergeOutcome: "auto",
        },
        {
          repoName: "org/repo-c",
          status: "succeeded",
          message: "PR merged",
          prUrl: "https://github.com/org/repo-c/pull/99",
          mergeOutcome: "force",
        },
        {
          repoName: "org/repo-d",
          status: "succeeded",
          message: "Pushed to main",
          mergeOutcome: "direct",
        },
        {
          repoName: "org/repo-e",
          status: "skipped",
          message: "No changes",
        },
        {
          repoName: "org/repo-f",
          status: "failed",
          message: "Clone failed",
        },
      ];
      const data: SummaryData = {
        title: "Config Sync Summary",
        dryRun: true,
        total: 6,
        succeeded: 4,
        skipped: 1,
        failed: 1,
        results,
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("✅ Would Open"));
      assert.ok(markdown.includes("✅ Would Auto-merge"));
      assert.ok(markdown.includes("✅ Would Merge"));
      assert.ok(markdown.includes("✅ Would Push"));
      assert.ok(markdown.includes("⏭️ Would Skip"));
      assert.ok(markdown.includes("❌ Would Fail"));
    });

    test("dryRun false produces normal output", () => {
      const data: SummaryData = {
        title: "Config Sync Summary",
        dryRun: false,
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("## Config Sync Summary"));
      assert.ok(!markdown.includes("(Dry Run)"));
      assert.ok(!markdown.includes("[!WARNING]"));
      assert.ok(markdown.includes("✅ Succeeded"));
    });

    test("dryRun undefined produces normal output", () => {
      const data: SummaryData = {
        title: "Config Sync Summary",
        total: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        results: [],
      };

      const markdown = formatSummary(data);

      assert.ok(markdown.includes("## Config Sync Summary"));
      assert.ok(!markdown.includes("(Dry Run)"));
      assert.ok(!markdown.includes("[!WARNING]"));
      assert.ok(markdown.includes("✅ Succeeded"));
    });
  });

  describe("plan details rendering", () => {
    describe("ruleset plan details", () => {
      test("renders nested details with ruleset table for updates", () => {
        const result: RepoResult = {
          repoName: "org/repo-a",
          status: "succeeded",
          message: "[DRY RUN] 2 to update",
          rulesetPlanDetails: [
            {
              name: "pr-rules",
              action: "update",
              propertyChanges: { added: 1, changed: 1, removed: 0 },
            },
            {
              name: "push-protection",
              action: "update",
              propertyChanges: { added: 2, changed: 0, removed: 0 },
            },
          ],
        };
        const data: SummaryData = {
          title: "Repository Settings Summary",
          dryRun: true,
          total: 1,
          succeeded: 1,
          skipped: 0,
          failed: 0,
          results: [result],
        };

        const markdown = formatSummary(data);

        // Nested details block
        assert.ok(markdown.includes("<summary>org/repo-a"));
        assert.ok(markdown.includes("Rulesets:"));
        assert.ok(markdown.includes("2 to update"));
        // Table headers
        assert.ok(markdown.includes("| Ruleset |"));
        assert.ok(markdown.includes("| Action |"));
        assert.ok(markdown.includes("| Properties |"));
        // Table rows
        assert.ok(markdown.includes("pr-rules"));
        assert.ok(markdown.includes("~ Update"));
        assert.ok(markdown.includes("+1 ~1 -0"));
        assert.ok(markdown.includes("push-protection"));
        assert.ok(markdown.includes("+2 ~0 -0"));
      });

      test("renders create action with property count", () => {
        const result: RepoResult = {
          repoName: "org/repo",
          status: "succeeded",
          message: "[DRY RUN] 1 to create",
          rulesetPlanDetails: [
            {
              name: "new-rules",
              action: "create",
              propertyCount: 5,
            },
          ],
        };
        const data: SummaryData = {
          title: "Repository Settings Summary",
          dryRun: true,
          total: 1,
          succeeded: 1,
          skipped: 0,
          failed: 0,
          results: [result],
        };

        const markdown = formatSummary(data);

        assert.ok(markdown.includes("+ Create"));
        assert.ok(markdown.includes("5 properties"));
        assert.ok(markdown.includes("1 to create"));
      });

      test("renders delete action with dash for properties", () => {
        const result: RepoResult = {
          repoName: "org/repo",
          status: "succeeded",
          message: "[DRY RUN] 1 to delete",
          rulesetPlanDetails: [{ name: "old-rules", action: "delete" }],
        };
        const data: SummaryData = {
          title: "Repository Settings Summary",
          dryRun: true,
          total: 1,
          succeeded: 1,
          skipped: 0,
          failed: 0,
          results: [result],
        };

        const markdown = formatSummary(data);

        assert.ok(markdown.includes("- Delete"));
        assert.ok(markdown.includes("old-rules"));
      });

      test("renders mixed actions in summary line", () => {
        const result: RepoResult = {
          repoName: "org/repo",
          status: "succeeded",
          message: "[DRY RUN] 1 to create, 1 to update, 1 to delete",
          rulesetPlanDetails: [
            { name: "new-one", action: "create", propertyCount: 3 },
            {
              name: "existing",
              action: "update",
              propertyChanges: { added: 0, changed: 1, removed: 0 },
            },
            { name: "old-one", action: "delete" },
          ],
        };
        const data: SummaryData = {
          title: "Repository Settings Summary",
          dryRun: true,
          total: 1,
          succeeded: 1,
          skipped: 0,
          failed: 0,
          results: [result],
        };

        const markdown = formatSummary(data);

        assert.ok(markdown.includes("1 to create"));
        assert.ok(markdown.includes("1 to update"));
        assert.ok(markdown.includes("1 to delete"));
      });
    });

    describe("repo settings plan details", () => {
      test("renders nested details with settings table", () => {
        const result: RepoResult = {
          repoName: "org/repo",
          status: "succeeded",
          message: "[DRY RUN] 1 to add, 1 to change",
          repoSettingsPlanDetails: [
            { property: "allowAutoMerge", action: "add" },
            { property: "hasWiki", action: "change" },
          ],
        };
        const data: SummaryData = {
          title: "Repository Settings Summary",
          dryRun: true,
          total: 1,
          succeeded: 1,
          skipped: 0,
          failed: 0,
          results: [result],
        };

        const markdown = formatSummary(data);

        assert.ok(markdown.includes("Repo Settings:"));
        assert.ok(markdown.includes("1 to add"));
        assert.ok(markdown.includes("1 to change"));
        assert.ok(markdown.includes("| Setting |"));
        assert.ok(markdown.includes("| Action |"));
        assert.ok(markdown.includes("allowAutoMerge"));
        assert.ok(markdown.includes("+ Add"));
        assert.ok(markdown.includes("hasWiki"));
        assert.ok(markdown.includes("~ Change"));
      });
    });

    describe("both plan details on same result", () => {
      test("renders both ruleset and settings nested details", () => {
        const result: RepoResult = {
          repoName: "org/repo",
          status: "succeeded",
          message: "Done",
          rulesetPlanDetails: [
            {
              name: "pr-rules",
              action: "update",
              propertyChanges: { added: 0, changed: 1, removed: 0 },
            },
          ],
          repoSettingsPlanDetails: [{ property: "hasWiki", action: "change" }],
        };
        const data: SummaryData = {
          title: "Repository Settings Summary",
          dryRun: true,
          total: 1,
          succeeded: 1,
          skipped: 0,
          failed: 0,
          results: [result],
        };

        const markdown = formatSummary(data);

        assert.ok(markdown.includes("Rulesets:"));
        assert.ok(markdown.includes("Repo Settings:"));
        assert.ok(markdown.includes("pr-rules"));
        assert.ok(markdown.includes("hasWiki"));
      });
    });

    describe("backwards compatibility", () => {
      test("no plan details produces no nested details blocks", () => {
        const result: RepoResult = {
          repoName: "org/repo",
          status: "succeeded",
          message: "Done",
        };
        const data: SummaryData = {
          title: "Config Sync Summary",
          total: 1,
          succeeded: 1,
          skipped: 0,
          failed: 0,
          results: [result],
        };

        const markdown = formatSummary(data);

        // Should have outer details but no nested ones for plan data
        assert.ok(markdown.includes("<summary>Repository Details</summary>"));
        assert.ok(!markdown.includes("Rulesets:"));
        assert.ok(!markdown.includes("Repo Settings:"));
      });

      test("empty plan details arrays produce no nested details", () => {
        const result: RepoResult = {
          repoName: "org/repo",
          status: "succeeded",
          message: "Done",
          rulesetPlanDetails: [],
          repoSettingsPlanDetails: [],
        };
        const data: SummaryData = {
          title: "Repository Settings Summary",
          total: 1,
          succeeded: 1,
          skipped: 0,
          failed: 0,
          results: [result],
        };

        const markdown = formatSummary(data);

        assert.ok(!markdown.includes("Rulesets:"));
        assert.ok(!markdown.includes("Repo Settings:"));
      });
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
      title: "Config Sync Summary",
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
      title: "Config Sync Summary",
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
      title: "Config Sync Summary",
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
      title: "Config Sync Summary",
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
      title: "Config Sync Summary",
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
