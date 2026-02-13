// test/unit/unified-summary.test.ts
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatUnifiedSummaryMarkdown,
  writeUnifiedSummary,
} from "../../src/output/unified-summary.js";
import type { LifecycleReport } from "../../src/output/lifecycle-report.js";
import type { SyncReport } from "../../src/output/sync-report.js";
import type { SettingsReport } from "../../src/output/settings-report.js";

function emptyLifecycle(): LifecycleReport {
  return {
    actions: [],
    totals: { created: 0, forked: 0, migrated: 0, existed: 0 },
  };
}

function emptySync(): SyncReport {
  return {
    repos: [],
    totals: { files: { create: 0, update: 0, delete: 0 } },
  };
}

function emptySettings(): SettingsReport {
  return {
    repos: [],
    totals: {
      settings: { add: 0, change: 0 },
      rulesets: { create: 0, update: 0, delete: 0 },
    },
  };
}

describe("formatUnifiedSummaryMarkdown", () => {
  test("returns empty string when no changes at all", () => {
    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle: emptyLifecycle(),
      sync: emptySync(),
      dryRun: false,
    });
    assert.equal(markdown, "");
  });

  test("returns empty string when all repos existed and no file changes", () => {
    const lifecycle: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "existed" }],
      totals: { created: 0, forked: 0, migrated: 0, existed: 1 },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync: emptySync(),
      dryRun: false,
    });
    assert.equal(markdown, "");
  });

  test("renders lifecycle-only changes (no file sync)", () => {
    const lifecycle: LifecycleReport = {
      actions: [
        {
          repoName: "org/new-repo",
          action: "created",
          settings: { visibility: "private" },
        },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync: emptySync(),
      dryRun: false,
    });

    assert.ok(markdown.includes("## xfg Apply"));
    assert.ok(markdown.includes("```diff"));
    assert.ok(markdown.includes("@@ org/new-repo @@"));
    assert.ok(markdown.includes("+ CREATE"));
    assert.ok(markdown.includes("+   visibility: private"));
    assert.ok(markdown.includes("**Applied: 1 repo (1 created)**"));
  });

  test("renders sync-only changes (no lifecycle)", () => {
    const sync: SyncReport = {
      repos: [
        {
          repoName: "org/repo",
          files: [
            { path: ".github/ci.yml", action: "create" },
            { path: "README.md", action: "update" },
          ],
        },
      ],
      totals: { files: { create: 1, update: 1, delete: 0 } },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle: emptyLifecycle(),
      sync,
      dryRun: false,
    });

    assert.ok(markdown.includes("@@ org/repo @@"));
    assert.ok(markdown.includes("+ .github/ci.yml"));
    assert.ok(markdown.includes("! README.md"));
    assert.ok(markdown.includes("**Applied: 2 files (1 created, 1 updated)**"));
  });

  test("renders combined lifecycle + sync for same repo", () => {
    const lifecycle: LifecycleReport = {
      actions: [
        {
          repoName: "org/new-repo",
          action: "created",
          settings: { visibility: "private" },
        },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };
    const sync: SyncReport = {
      repos: [
        {
          repoName: "org/new-repo",
          files: [{ path: ".github/ci.yml", action: "create" }],
        },
      ],
      totals: { files: { create: 1, update: 0, delete: 0 } },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync,
      dryRun: false,
    });

    // Should be one section for the repo
    const headerMatches = markdown.match(/@@ org\/new-repo @@/g);
    assert.equal(headerMatches?.length, 1, "should have one header per repo");
    assert.ok(markdown.includes("+ CREATE"));
    assert.ok(markdown.includes("+   visibility: private"));
    assert.ok(markdown.includes("+ .github/ci.yml"));
    assert.ok(
      markdown.includes("**Applied: 1 repo (1 created), 1 file (1 created)**")
    );
  });

  test("renders fork with file changes", () => {
    const lifecycle: LifecycleReport = {
      actions: [
        {
          repoName: "org/my-fork",
          action: "forked",
          upstream: "octocat/Spoon-Knife",
        },
      ],
      totals: { created: 0, forked: 1, migrated: 0, existed: 0 },
    };
    const sync: SyncReport = {
      repos: [
        {
          repoName: "org/my-fork",
          files: [{ path: ".github/ci.yml", action: "create" }],
        },
      ],
      totals: { files: { create: 1, update: 0, delete: 0 } },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync,
      dryRun: false,
    });

    assert.ok(markdown.includes("@@ org/my-fork @@"));
    assert.ok(markdown.includes("+ FORK octocat/Spoon-Knife -> org/my-fork"));
    assert.ok(markdown.includes("+ .github/ci.yml"));
  });

  test("renders migrate with file changes", () => {
    const lifecycle: LifecycleReport = {
      actions: [
        {
          repoName: "org/migrated",
          action: "migrated",
          source: "https://dev.azure.com/org/proj/_git/repo",
        },
      ],
      totals: { created: 0, forked: 0, migrated: 1, existed: 0 },
    };
    const sync: SyncReport = {
      repos: [
        {
          repoName: "org/migrated",
          files: [{ path: "README.md", action: "update" }],
        },
      ],
      totals: { files: { create: 0, update: 1, delete: 0 } },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync,
      dryRun: false,
    });

    assert.ok(markdown.includes("+ MIGRATE"));
    assert.ok(markdown.includes("! README.md"));
  });

  test("skips existed repos with no file changes", () => {
    const lifecycle: LifecycleReport = {
      actions: [
        { repoName: "org/new-repo", action: "created" },
        { repoName: "org/existing", action: "existed" },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 1 },
    };
    const sync: SyncReport = {
      repos: [
        { repoName: "org/new-repo", files: [] },
        { repoName: "org/existing", files: [] },
      ],
      totals: { files: { create: 0, update: 0, delete: 0 } },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync,
      dryRun: false,
    });

    assert.ok(markdown.includes("org/new-repo"));
    assert.ok(
      !markdown.includes("org/existing"),
      "should not show existed repo with no changes"
    );
  });

  test("shows existed repo if it has file changes", () => {
    const lifecycle: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "existed" }],
      totals: { created: 0, forked: 0, migrated: 0, existed: 1 },
    };
    const sync: SyncReport = {
      repos: [
        {
          repoName: "org/repo",
          files: [{ path: ".github/ci.yml", action: "create" }],
        },
      ],
      totals: { files: { create: 1, update: 0, delete: 0 } },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync,
      dryRun: false,
    });

    assert.ok(markdown.includes("@@ org/repo @@"));
    assert.ok(markdown.includes("+ .github/ci.yml"));
    assert.ok(!markdown.includes("CREATE"), "should not show lifecycle action");
  });

  test("renders dry run with xfg Plan title", () => {
    const lifecycle: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync: emptySync(),
      dryRun: true,
    });

    assert.ok(markdown.includes("## xfg Plan"));
    assert.ok(!markdown.includes("## xfg Apply"));
    assert.ok(markdown.includes("[!WARNING]"));
    assert.ok(markdown.includes("no changes were applied"));
  });

  test("renders xfg Apply title when dryRun=false", () => {
    const lifecycle: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync: emptySync(),
      dryRun: false,
    });

    assert.ok(markdown.includes("## xfg Apply"));
    assert.ok(!markdown.includes("## xfg Plan"));
    assert.ok(!markdown.includes("[!WARNING]"));
  });

  test("renders error from sync report", () => {
    const sync: SyncReport = {
      repos: [
        {
          repoName: "org/failed-repo",
          files: [],
          error: "Connection refused",
        },
      ],
      totals: { files: { create: 0, update: 0, delete: 0 } },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle: emptyLifecycle(),
      sync,
      dryRun: false,
    });

    assert.ok(markdown.includes("org/failed-repo"));
    assert.ok(markdown.includes("Error: Connection refused"));
  });

  test("renders multiple repos in order", () => {
    const lifecycle: LifecycleReport = {
      actions: [
        { repoName: "org/repo-a", action: "created" },
        { repoName: "org/repo-b", action: "existed" },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 1 },
    };
    const sync: SyncReport = {
      repos: [
        {
          repoName: "org/repo-a",
          files: [{ path: "file-a.txt", action: "create" }],
        },
        {
          repoName: "org/repo-b",
          files: [{ path: "file-b.txt", action: "update" }],
        },
      ],
      totals: { files: { create: 1, update: 1, delete: 0 } },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync,
      dryRun: false,
    });

    const indexA = markdown.indexOf("org/repo-a");
    const indexB = markdown.indexOf("org/repo-b");
    assert.ok(indexA < indexB, "repo-a should appear before repo-b");
    assert.ok(markdown.includes("+ CREATE"));
    assert.ok(markdown.includes("+ file-a.txt"));
    assert.ok(markdown.includes("! file-b.txt"));
  });

  // =========================================================================
  // Settings-only tests
  // =========================================================================

  test("renders settings-only changes (add setting)", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            { name: "visibility", action: "add", newValue: "private" },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 1, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes("## xfg Apply"));
    assert.ok(markdown.includes("@@ org/repo @@"));
    assert.ok(markdown.includes('+ visibility: "private"'));
    assert.ok(markdown.includes("**Applied: 1 setting (1 added)**"));
  });

  test("renders settings change with old and new values", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "description",
              action: "change",
              oldValue: "old desc",
              newValue: "new desc",
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 0, change: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes("@@ org/repo @@"));
    assert.ok(markdown.includes('! description: "old desc" → "new desc"'));
    assert.ok(markdown.includes("**Applied: 1 setting (1 changed)**"));
  });

  test("renders ruleset create in settings", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [
            {
              name: "branch-protection",
              action: "create",
              config: {
                name: "branch-protection",
                target: "branch",
                enforcement: "active",
              },
            },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 1, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes('+ ruleset "branch-protection"'));
    assert.ok(markdown.includes("**Applied: 1 ruleset (1 created)**"));
  });

  test("renders ruleset update with property diffs", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [
            {
              name: "my-ruleset",
              action: "update",
              propertyDiffs: [
                {
                  path: ["enforcement"],
                  action: "change",
                  oldValue: "disabled",
                  newValue: "active",
                },
              ],
            },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 1, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes('! ruleset "my-ruleset"'));
    assert.ok(markdown.includes('!   enforcement: "disabled" → "active"'));
  });

  test("renders ruleset delete", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [{ name: "old-ruleset", action: "delete" }],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 1 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes('- ruleset "old-ruleset"'));
    assert.ok(markdown.includes("**Applied: 1 ruleset (1 deleted)**"));
  });

  test("renders settings error", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/broken",
          settings: [],
          rulesets: [],
          error: "API rate limited",
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes("org/broken"));
    assert.ok(markdown.includes("Error: API rate limited"));
  });

  // =========================================================================
  // Combined lifecycle + sync + settings tests
  // =========================================================================

  test("renders all three report types for same repo", () => {
    const lifecycle: LifecycleReport = {
      actions: [
        {
          repoName: "org/repo",
          action: "created",
          settings: { visibility: "private" },
        },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };
    const sync: SyncReport = {
      repos: [
        {
          repoName: "org/repo",
          files: [{ path: ".github/ci.yml", action: "create" }],
        },
      ],
      totals: { files: { create: 1, update: 0, delete: 0 } },
    };
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "description",
              action: "add",
              newValue: "My repo",
            },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 1, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync,
      settings,
      dryRun: false,
    });

    // Single repo header
    const headerMatches = markdown.match(/@@ org\/repo @@/g);
    assert.equal(headerMatches?.length, 1);

    // All sections present
    assert.ok(markdown.includes("+ CREATE"));
    assert.ok(markdown.includes("+ .github/ci.yml"));
    assert.ok(markdown.includes('+ description: "My repo"'));

    // Combined summary
    assert.ok(
      markdown.includes("1 repo (1 created)"),
      "should include repo count"
    );
    assert.ok(
      markdown.includes("1 file (1 created)"),
      "should include file count"
    );
    assert.ok(
      markdown.includes("1 setting (1 added)"),
      "should include setting count"
    );
  });

  test("renders settings with dry run as xfg Plan", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            { name: "visibility", action: "add", newValue: "private" },
          ],
          rulesets: [],
        },
      ],
      totals: {
        settings: { add: 1, change: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: true,
    });

    assert.ok(markdown.includes("## xfg Plan"));
    assert.ok(markdown.includes("[!WARNING]"));
  });

  test("works with only settings (no lifecycle or sync)", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [
            {
              name: "protect-main",
              action: "create",
              config: { name: "protect-main", target: "branch" },
            },
            { name: "old-rule", action: "delete" },
          ],
        },
      ],
      totals: {
        settings: { add: 0, change: 0 },
        rulesets: { create: 1, update: 0, delete: 1 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes("## xfg Apply"));
    assert.ok(markdown.includes('+ ruleset "protect-main"'));
    assert.ok(markdown.includes('- ruleset "old-rule"'));
    assert.ok(
      markdown.includes("**Applied: 2 rulesets (1 created, 1 deleted)**")
    );
  });

  test("returns empty when settings has no changes", () => {
    const markdown = formatUnifiedSummaryMarkdown({
      settings: emptySettings(),
      dryRun: false,
    });
    assert.equal(markdown, "");
  });
});

describe("writeUnifiedSummary", () => {
  let tempFile: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempFile = join(tmpdir(), `unified-summary-test-${Date.now()}.md`);
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
    const lifecycle: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    writeUnifiedSummary({
      lifecycle,
      sync: emptySync(),
      dryRun: false,
    });

    assert.ok(existsSync(tempFile));
    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.includes("xfg Apply"));
  });

  test("no-ops when env var not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    writeUnifiedSummary({
      lifecycle: emptyLifecycle(),
      sync: emptySync(),
      dryRun: false,
    });
    assert.ok(!existsSync(tempFile));
  });

  test("no-ops when no changes", () => {
    process.env.GITHUB_STEP_SUMMARY = tempFile;
    writeUnifiedSummary({
      lifecycle: emptyLifecycle(),
      sync: emptySync(),
      dryRun: false,
    });
    assert.ok(!existsSync(tempFile));
  });
});
