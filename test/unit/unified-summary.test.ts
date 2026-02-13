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

describe("formatUnifiedSummaryMarkdown", () => {
  test("returns empty string when no changes at all", () => {
    const markdown = formatUnifiedSummaryMarkdown(
      emptyLifecycle(),
      emptySync(),
      false
    );
    assert.equal(markdown, "");
  });

  test("returns empty string when all repos existed and no file changes", () => {
    const lifecycle: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "existed" }],
      totals: { created: 0, forked: 0, migrated: 0, existed: 1 },
    };
    const markdown = formatUnifiedSummaryMarkdown(
      lifecycle,
      emptySync(),
      false
    );
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
    const markdown = formatUnifiedSummaryMarkdown(
      lifecycle,
      emptySync(),
      false
    );

    assert.ok(markdown.includes("## xfg Sync Summary"));
    assert.ok(markdown.includes("```diff"));
    assert.ok(markdown.includes("@@ org/new-repo @@"));
    assert.ok(markdown.includes("+ CREATE"));
    assert.ok(markdown.includes("+   visibility: private"));
    assert.ok(markdown.includes("**Plan: 1 repo (1 to create)**"));
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
    const markdown = formatUnifiedSummaryMarkdown(
      emptyLifecycle(),
      sync,
      false
    );

    assert.ok(markdown.includes("@@ org/repo @@"));
    assert.ok(markdown.includes("+ .github/ci.yml"));
    assert.ok(markdown.includes("! README.md"));
    assert.ok(
      markdown.includes("**Plan: 2 files (1 to create, 1 to update)**")
    );
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

    const markdown = formatUnifiedSummaryMarkdown(lifecycle, sync, false);

    // Should be one section for the repo
    const headerMatches = markdown.match(/@@ org\/new-repo @@/g);
    assert.equal(headerMatches?.length, 1, "should have one header per repo");
    assert.ok(markdown.includes("+ CREATE"));
    assert.ok(markdown.includes("+   visibility: private"));
    assert.ok(markdown.includes("+ .github/ci.yml"));
    assert.ok(
      markdown.includes("**Plan: 1 repo (1 to create), 1 file (1 to create)**")
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

    const markdown = formatUnifiedSummaryMarkdown(lifecycle, sync, false);

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

    const markdown = formatUnifiedSummaryMarkdown(lifecycle, sync, false);

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

    const markdown = formatUnifiedSummaryMarkdown(lifecycle, sync, false);

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

    const markdown = formatUnifiedSummaryMarkdown(lifecycle, sync, false);

    assert.ok(markdown.includes("@@ org/repo @@"));
    assert.ok(markdown.includes("+ .github/ci.yml"));
    assert.ok(!markdown.includes("CREATE"), "should not show lifecycle action");
  });

  test("renders dry run warning", () => {
    const lifecycle: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const markdown = formatUnifiedSummaryMarkdown(lifecycle, emptySync(), true);

    assert.ok(markdown.includes("(Dry Run)"));
    assert.ok(markdown.includes("[!WARNING]"));
    assert.ok(markdown.includes("no changes were applied"));
  });

  test("no dry run warning when dryRun=false", () => {
    const lifecycle: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const markdown = formatUnifiedSummaryMarkdown(
      lifecycle,
      emptySync(),
      false
    );

    assert.ok(!markdown.includes("[!WARNING]"));
    assert.ok(!markdown.includes("Dry Run"));
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

    const markdown = formatUnifiedSummaryMarkdown(
      emptyLifecycle(),
      sync,
      false
    );

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

    const markdown = formatUnifiedSummaryMarkdown(lifecycle, sync, false);

    const indexA = markdown.indexOf("org/repo-a");
    const indexB = markdown.indexOf("org/repo-b");
    assert.ok(indexA < indexB, "repo-a should appear before repo-b");
    assert.ok(markdown.includes("+ CREATE"));
    assert.ok(markdown.includes("+ file-a.txt"));
    assert.ok(markdown.includes("! file-b.txt"));
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

    writeUnifiedSummary(lifecycle, emptySync(), false);

    assert.ok(existsSync(tempFile));
    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.includes("xfg Sync Summary"));
  });

  test("no-ops when env var not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    writeUnifiedSummary(emptyLifecycle(), emptySync(), false);
    assert.ok(!existsSync(tempFile));
  });

  test("no-ops when no changes", () => {
    process.env.GITHUB_STEP_SUMMARY = tempFile;
    writeUnifiedSummary(emptyLifecycle(), emptySync(), false);
    assert.ok(!existsSync(tempFile));
  });
});
