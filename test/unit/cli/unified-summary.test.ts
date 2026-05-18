// test/unit/unified-summary.test.ts
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatUnifiedSummaryMarkdown,
  writeUnifiedSummary,
} from "../../../src/cli/unified-summary.js";
import { renderSyncLines } from "../../../src/output/sync-report.js";
import type { LifecycleReport } from "../../../src/output/lifecycle-report.js";
import type { SyncReport } from "../../../src/output/sync-report.js";
import type { SettingsReport } from "../../../src/output/settings-report.js";

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
      settings: { create: 0, update: 0 },
      rulesets: { create: 0, update: 0, delete: 0 },
      labels: { create: 0, update: 0, delete: 0 },
      variables: { create: 0, update: 0, delete: 0 },
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
    assert.ok(markdown.includes("### org/new-repo"));
    assert.ok(markdown.includes("+ CREATE"));
    assert.ok(markdown.includes("+   visibility: private"));
    assert.ok(markdown.includes("**Applied: 1 repo (1 created)**"));
  });

  test("renders lifecycle settings with description in diff", () => {
    const lifecycle: LifecycleReport = {
      actions: [
        {
          repoName: "org/new-repo",
          action: "created",
          settings: { visibility: "public", description: "My cool repo" },
        },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync: emptySync(),
      dryRun: false,
    });

    assert.ok(markdown.includes("+   visibility: public"));
    assert.ok(markdown.includes('+   description: "My cool repo"'));
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

    assert.ok(markdown.includes("### org/repo"));
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
    const headerMatches = markdown.match(/### org\/new-repo/g);
    assert.equal(headerMatches?.length, 1, "should have one header per repo");
    assert.ok(markdown.includes("+ CREATE"));
    assert.ok(markdown.includes("+   visibility: private"));
    assert.ok(markdown.includes("+ .github/ci.yml"));
    assert.ok(
      markdown.includes("**Applied: 1 repo (1 created), 1 file (1 created)**")
    );
  });

  test("inserts blank line between lifecycle and sync content", () => {
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

    // Extract lines inside the diff block
    const diffMatch = markdown.match(/```diff\n([\s\S]*?)```/);
    assert.ok(diffMatch, "should have a diff block");
    const diffContent = diffMatch![1];
    const lines = diffContent.split("\n");

    // Find the lifecycle line and the sync line
    const visibilityIdx = lines.findIndex((l) => l.includes("visibility"));
    const fileIdx = lines.findIndex((l) => l.includes(".github/ci.yml"));
    assert.ok(visibilityIdx >= 0, "should have lifecycle visibility line");
    assert.ok(fileIdx >= 0, "should have sync file line");
    // There should be a blank line between them
    assert.equal(
      lines[visibilityIdx + 1],
      "",
      "should have blank line between lifecycle and sync"
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

    assert.ok(markdown.includes("### org/my-fork"));
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

    assert.ok(markdown.includes("### org/repo"));
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
            { name: "visibility", action: "create", newValue: "private" },
          ],
          rulesets: [],
          labels: [],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 1, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes("## xfg Apply"));
    assert.ok(markdown.includes("### org/repo"));
    assert.ok(markdown.includes('+ visibility: "private"'));
    assert.ok(markdown.includes("**Applied: 1 setting (1 created)**"));
  });

  test("renders settings change with old and new values", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            {
              name: "description",
              action: "update",
              oldValue: "old desc",
              newValue: "new desc",
            },
          ],
          rulesets: [],
          labels: [],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 1 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes("### org/repo"));
    assert.ok(markdown.includes('! description: "old desc" → "new desc"'));
    assert.ok(markdown.includes("**Applied: 1 setting (1 updated)**"));
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
                target: "branch",
                enforcement: "active",
              },
            },
          ],
          labels: [],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 1, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
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
          labels: [],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 1, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
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
          labels: [],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 1 },
        labels: { create: 0, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
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
          labels: [],
          variables: [],
          error: "API rate limited",
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
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
              action: "create",
              newValue: "My repo",
            },
          ],
          rulesets: [],
          labels: [],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 1, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      lifecycle,
      sync,
      settings,
      dryRun: false,
    });

    // Single repo header
    const headerMatches = markdown.match(/### org\/repo/g);
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
      markdown.includes("1 setting (1 created)"),
      "should include setting count"
    );
  });

  test("inserts blank line between sync and settings content", () => {
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
            { name: "visibility", action: "create", newValue: "private" },
          ],
          rulesets: [],
          labels: [],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 1, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };

    const markdown = formatUnifiedSummaryMarkdown({
      sync,
      settings,
      dryRun: false,
    });

    // Extract lines inside the diff block
    const diffMatch = markdown.match(/```diff\n([\s\S]*?)```/);
    assert.ok(diffMatch, "should have a diff block");
    const diffContent = diffMatch![1];
    const lines = diffContent.split("\n");

    // Find the sync file line and the settings line
    const fileIdx = lines.findIndex((l) => l.includes(".github/ci.yml"));
    const settingIdx = lines.findIndex((l) => l.includes("visibility"));
    assert.ok(fileIdx >= 0, "should have sync file line");
    assert.ok(settingIdx >= 0, "should have settings line");
    // There should be a blank line between them
    assert.equal(
      lines[fileIdx + 1],
      "",
      "should have blank line between sync and settings"
    );
  });

  test("renders settings with dry run as xfg Plan", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [
            { name: "visibility", action: "create", newValue: "private" },
          ],
          rulesets: [],
          labels: [],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 1, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
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
              config: { target: "branch" },
            },
            { name: "old-rule", action: "delete" },
          ],
          labels: [],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 1, update: 0, delete: 1 },
        labels: { create: 0, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
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

  // =========================================================================
  // Labels tests
  // =========================================================================

  test("renders label create with config (color + description)", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "bug",
              action: "create",
              config: { color: "d73a4a", description: "Something is broken" },
            },
          ],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes("### org/repo"));
    assert.ok(markdown.includes('+ label "bug"'));
    assert.ok(markdown.includes('+   color: "d73a4a"'));
    assert.ok(markdown.includes('+   description: "Something is broken"'));
    assert.ok(markdown.includes("**Applied: 1 label (1 created)**"));
  });

  test("renders label update with newName (rename)", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "old-name",
              action: "update",
              newName: "new-name",
            },
          ],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 1, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes('! label "old-name" \u2192 "new-name"'));
    assert.ok(markdown.includes("**Applied: 1 label (1 updated)**"));
  });

  test("renders label update without newName", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "bug",
              action: "update",
            },
          ],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 1, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes('! label "bug"'));
    assert.ok(!markdown.includes("\u2192"));
  });

  test("renders label delete", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [{ name: "stale", action: "delete" }],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 0, update: 0, delete: 1 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes('- label "stale"'));
    assert.ok(markdown.includes("**Applied: 1 label (1 deleted)**"));
  });

  test("formatCombinedSummary includes labels totals", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "bug",
              action: "create",
              config: { color: "d73a4a" },
            },
            { name: "old", action: "delete" },
          ],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 1 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(
      markdown.includes("**Applied: 2 labels (1 created, 1 deleted)**")
    );
  });

  test("dry-run label summary uses 'to create' wording", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "bug",
              action: "create",
              config: { color: "d73a4a" },
            },
            { name: "old", action: "update", newName: "legacy" },
          ],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 1, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: true,
    });

    assert.ok(
      markdown.includes("**Plan: 2 labels (1 to create, 1 to update)**")
    );
  });

  test("singular 'label' when total is 1", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "bug",
              action: "create",
              config: { color: "d73a4a" },
            },
          ],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(
      markdown.includes("1 label (1 created)"),
      "should use singular 'label' not 'labels'"
    );
    assert.ok(
      !markdown.includes("1 labels"),
      "should not use plural 'labels' for count of 1"
    );
  });

  test("label create without description omits description line", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            {
              name: "feature",
              action: "create",
              config: { color: "0075ca" },
            },
          ],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    assert.ok(markdown.includes('+   color: "0075ca"'));
    assert.ok(!markdown.includes("description:"));
  });

  test("hasAnyChanges detects labels-only changes", () => {
    const settings: SettingsReport = {
      repos: [
        {
          repoName: "org/repo",
          settings: [],
          rulesets: [],
          labels: [
            { name: "bug", action: "create", config: { color: "d73a4a" } },
          ],
          variables: [],
        },
      ],
      totals: {
        settings: { create: 0, update: 0 },
        rulesets: { create: 0, update: 0, delete: 0 },
        labels: { create: 1, update: 0, delete: 0 },
        variables: { create: 0, update: 0, delete: 0 },
      },
    };
    const markdown = formatUnifiedSummaryMarkdown({
      settings,
      dryRun: false,
    });

    // Should not return empty string since there are label changes
    assert.ok(markdown.length > 0, "should detect labels as changes");
    assert.ok(markdown.includes("### org/repo"));
  });

  test("returns empty when settings has no changes", () => {
    const markdown = formatUnifiedSummaryMarkdown({
      settings: emptySettings(),
      dryRun: false,
    });
    assert.equal(markdown, "");
  });
});

describe("renderSyncLines with diffLines", () => {
  test("appends diff lines after file path for updates", () => {
    const result = renderSyncLines({
      repoName: "org/repo",
      files: [
        {
          path: "config.json",
          action: "update",
          diffLines: ["@@ -1,1 +1,1 @@", "-old", "+new"],
        },
      ],
    });

    assert.deepEqual(result, [
      "! config.json",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ]);
  });

  test("appends diff lines after file path for creates", () => {
    const result = renderSyncLines({
      repoName: "org/repo",
      files: [
        {
          path: "config.json",
          action: "create",
          diffLines: ["@@ -0,0 +1,1 @@", '+{"key": "value"}'],
        },
      ],
    });

    assert.deepEqual(result, [
      "+ config.json",
      "@@ -0,0 +1,1 @@",
      '+{"key": "value"}',
    ]);
  });

  test("does not append diff lines when absent", () => {
    const result = renderSyncLines({
      repoName: "org/repo",
      files: [{ path: "script.sh", action: "create" }],
    });

    assert.deepEqual(result, ["+ script.sh"]);
  });

  test("appends diff lines for deleted files", () => {
    const result = renderSyncLines({
      repoName: "org/repo",
      files: [
        {
          path: "old.yaml",
          action: "delete",
          diffLines: ["@@ -1,2 +0,0 @@", "-key: value", "-other: thing"],
        },
      ],
    });

    assert.deepEqual(result, [
      "- old.yaml",
      "@@ -1,2 +0,0 @@",
      "-key: value",
      "-other: thing",
    ]);
  });
});

describe("writeUnifiedSummary", () => {
  let tempFile: string;
  beforeEach(() => {
    tempFile = join(tmpdir(), `unified-summary-test-${Date.now()}.md`);
  });

  afterEach(() => {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  });

  test("writes markdown to summaryPath", () => {
    const lifecycle: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    writeUnifiedSummary({
      lifecycle,
      sync: emptySync(),
      dryRun: false,
      summaryPath: tempFile,
    });

    assert.ok(existsSync(tempFile));
    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.includes("xfg Apply"));
  });

  test("no-ops when summaryPath not set", () => {
    writeUnifiedSummary({
      lifecycle: emptyLifecycle(),
      sync: emptySync(),
      dryRun: false,
      summaryPath: undefined,
    });
    assert.ok(!existsSync(tempFile));
  });

  test("no-ops when no changes", () => {
    writeUnifiedSummary({
      lifecycle: emptyLifecycle(),
      sync: emptySync(),
      dryRun: false,
      summaryPath: tempFile,
    });
    assert.ok(!existsSync(tempFile));
  });
});
