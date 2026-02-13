// test/unit/lifecycle-report.test.ts
import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildLifecycleReport,
  formatLifecycleReportCLI,
  formatLifecycleReportMarkdown,
  writeLifecycleReportSummary,
  hasLifecycleChanges,
  type LifecycleReport,
  type LifecycleReportInput,
} from "../../src/output/lifecycle-report.js";

describe("buildLifecycleReport", () => {
  test("correctly tallies created actions", () => {
    const inputs: LifecycleReportInput[] = [
      { repoName: "org/repo1", action: "created" },
      { repoName: "org/repo2", action: "created" },
    ];

    const report = buildLifecycleReport(inputs);

    assert.equal(report.totals.created, 2);
    assert.equal(report.totals.forked, 0);
    assert.equal(report.totals.migrated, 0);
    assert.equal(report.totals.existed, 0);
    assert.equal(report.actions.length, 2);
  });

  test("correctly tallies mixed actions", () => {
    const inputs: LifecycleReportInput[] = [
      { repoName: "org/repo1", action: "created" },
      {
        repoName: "org/repo2",
        action: "forked",
        upstream: "upstream/repo",
      },
      {
        repoName: "org/repo3",
        action: "migrated",
        source: "https://dev.azure.com/org/proj/_git/repo",
      },
      { repoName: "org/repo4", action: "existed" },
      { repoName: "org/repo5", action: "existed" },
    ];

    const report = buildLifecycleReport(inputs);

    assert.equal(report.totals.created, 1);
    assert.equal(report.totals.forked, 1);
    assert.equal(report.totals.migrated, 1);
    assert.equal(report.totals.existed, 2);
    assert.equal(report.actions.length, 5);
  });

  test("preserves upstream and source fields", () => {
    const inputs: LifecycleReportInput[] = [
      {
        repoName: "org/my-fork",
        action: "forked",
        upstream: "octocat/Spoon-Knife",
      },
      {
        repoName: "org/migrated",
        action: "migrated",
        source: "https://dev.azure.com/org/proj/_git/repo",
      },
    ];

    const report = buildLifecycleReport(inputs);

    assert.equal(report.actions[0].upstream, "octocat/Spoon-Knife");
    assert.equal(
      report.actions[1].source,
      "https://dev.azure.com/org/proj/_git/repo"
    );
  });

  test("preserves settings fields", () => {
    const inputs: LifecycleReportInput[] = [
      {
        repoName: "org/repo",
        action: "created",
        settings: { visibility: "private", description: "My repo" },
      },
    ];

    const report = buildLifecycleReport(inputs);

    assert.deepEqual(report.actions[0].settings, {
      visibility: "private",
      description: "My repo",
    });
  });

  test("handles empty input", () => {
    const report = buildLifecycleReport([]);

    assert.equal(report.actions.length, 0);
    assert.equal(report.totals.created, 0);
    assert.equal(report.totals.forked, 0);
    assert.equal(report.totals.migrated, 0);
    assert.equal(report.totals.existed, 0);
  });
});

describe("hasLifecycleChanges", () => {
  test("returns false when all actions are existed", () => {
    const report: LifecycleReport = {
      actions: [
        { repoName: "org/repo1", action: "existed" },
        { repoName: "org/repo2", action: "existed" },
      ],
      totals: { created: 0, forked: 0, migrated: 0, existed: 2 },
    };

    assert.equal(hasLifecycleChanges(report), false);
  });

  test("returns true when there is a created action", () => {
    const report: LifecycleReport = {
      actions: [
        { repoName: "org/repo1", action: "existed" },
        { repoName: "org/repo2", action: "created" },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 1 },
    };

    assert.equal(hasLifecycleChanges(report), true);
  });

  test("returns false for empty report", () => {
    const report: LifecycleReport = {
      actions: [],
      totals: { created: 0, forked: 0, migrated: 0, existed: 0 },
    };

    assert.equal(hasLifecycleChanges(report), false);
  });
});

describe("formatLifecycleReportCLI", () => {
  test("returns empty array when all actions are existed", () => {
    const report: LifecycleReport = {
      actions: [
        { repoName: "org/repo1", action: "existed" },
        { repoName: "org/repo2", action: "existed" },
      ],
      totals: { created: 0, forked: 0, migrated: 0, existed: 2 },
    };

    const lines = formatLifecycleReportCLI(report);

    assert.equal(lines.length, 0);
  });

  test("renders created action with green color", () => {
    const report: LifecycleReport = {
      actions: [{ repoName: "org/new-repo", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const lines = formatLifecycleReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("CREATE"), "should include CREATE label");
    assert.ok(output.includes("org/new-repo"), "should include repo name");
    assert.ok(output.includes("Plan:"), "should include summary");
    assert.ok(output.includes("1 repo"), "should include repo count");
    assert.ok(output.includes("1 to create"), "should include create count");
  });

  test("renders forked action with upstream", () => {
    const report: LifecycleReport = {
      actions: [
        {
          repoName: "org/my-fork",
          action: "forked",
          upstream: "octocat/Spoon-Knife",
        },
      ],
      totals: { created: 0, forked: 1, migrated: 0, existed: 0 },
    };

    const lines = formatLifecycleReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("FORK"), "should include FORK label");
    assert.ok(
      output.includes("octocat/Spoon-Knife"),
      "should include upstream"
    );
    assert.ok(output.includes("org/my-fork"), "should include target repo");
    assert.ok(output.includes("->"), "should include arrow");
  });

  test("renders migrated action with source", () => {
    const report: LifecycleReport = {
      actions: [
        {
          repoName: "org/migrated-repo",
          action: "migrated",
          source: "https://dev.azure.com/org/proj/_git/repo",
        },
      ],
      totals: { created: 0, forked: 0, migrated: 1, existed: 0 },
    };

    const lines = formatLifecycleReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("MIGRATE"), "should include MIGRATE label");
    assert.ok(
      output.includes("https://dev.azure.com/org/proj/_git/repo"),
      "should include source"
    );
    assert.ok(
      output.includes("org/migrated-repo"),
      "should include target repo"
    );
  });

  test("skips existed actions in output", () => {
    const report: LifecycleReport = {
      actions: [
        { repoName: "org/new-repo", action: "created" },
        { repoName: "org/existing-repo", action: "existed" },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 1 },
    };

    const lines = formatLifecycleReportCLI(report);
    const output = lines.join("\n");

    assert.ok(
      !output.includes("org/existing-repo"),
      "should not include existed repo"
    );
    assert.ok(!output.includes("existed"), "should not include existed marker");
    assert.ok(output.includes("org/new-repo"), "should include created repo");
  });

  test("renders settings details for non-existed actions", () => {
    const report: LifecycleReport = {
      actions: [
        {
          repoName: "org/new-repo",
          action: "created",
          settings: { visibility: "private", description: "My new repo" },
        },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const lines = formatLifecycleReportCLI(report);
    const output = lines.join("\n");

    assert.ok(
      output.includes("visibility: private"),
      "should include visibility"
    );
    assert.ok(
      output.includes('description: "My new repo"'),
      "should include description"
    );
  });

  test("renders plural repos in summary (only counts changes)", () => {
    const report: LifecycleReport = {
      actions: [
        { repoName: "org/repo1", action: "created" },
        { repoName: "org/repo2", action: "created" },
        { repoName: "org/repo3", action: "existed" },
      ],
      totals: { created: 2, forked: 0, migrated: 0, existed: 1 },
    };

    const lines = formatLifecycleReportCLI(report);
    const output = lines.join("\n");

    assert.ok(output.includes("2 repos"), "should count only changes");
    assert.ok(output.includes("2 to create"), "should show create count");
    assert.ok(!output.includes("existing"), "should not show existing count");
  });
});

describe("formatLifecycleReportMarkdown", () => {
  test("returns empty string when all actions are existed", () => {
    const report: LifecycleReport = {
      actions: [{ repoName: "org/repo1", action: "existed" }],
      totals: { created: 0, forked: 0, migrated: 0, existed: 1 },
    };

    const markdown = formatLifecycleReportMarkdown(report, false);

    assert.equal(markdown, "");
  });

  test("includes dry run warning when dryRun=true", () => {
    const report: LifecycleReport = {
      actions: [{ repoName: "org/repo1", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const markdown = formatLifecycleReportMarkdown(report, true);

    assert.ok(
      markdown.includes("(Dry Run)"),
      "should include dry run in title"
    );
    assert.ok(
      markdown.includes("[!WARNING]"),
      "should include warning callout"
    );
    assert.ok(
      markdown.includes("no changes were applied"),
      "should explain dry run"
    );
  });

  test("no dry run warning when dryRun=false", () => {
    const report: LifecycleReport = {
      actions: [{ repoName: "org/repo1", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const markdown = formatLifecycleReportMarkdown(report, false);

    assert.ok(!markdown.includes("[!WARNING]"), "should not include warning");
    assert.ok(!markdown.includes("Dry Run"), "should not mention dry run");
  });

  test("wraps output in HTML pre block with colored spans", () => {
    const report: LifecycleReport = {
      actions: [
        { repoName: "org/new-repo", action: "created" },
        {
          repoName: "org/my-fork",
          action: "forked",
          upstream: "octocat/Spoon-Knife",
        },
      ],
      totals: { created: 1, forked: 1, migrated: 0, existed: 0 },
    };

    const markdown = formatLifecycleReportMarkdown(report, false);

    assert.ok(markdown.includes("<pre>"), "should have HTML pre block");
    assert.ok(
      markdown.includes("+ CREATE org/new-repo"),
      "should include created repo"
    );
    assert.ok(
      markdown.includes("+ FORK octocat/Spoon-Knife -&gt; org/my-fork"),
      "should include forked repo with HTML entity arrow"
    );
  });

  test("includes title as h2", () => {
    const report: LifecycleReport = {
      actions: [{ repoName: "org/repo1", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const markdown = formatLifecycleReportMarkdown(report, false);

    assert.ok(
      markdown.includes("## Lifecycle Summary"),
      "should include h2 title"
    );
  });

  test("includes plan summary as bold text", () => {
    const report: LifecycleReport = {
      actions: [{ repoName: "org/repo1", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const markdown = formatLifecycleReportMarkdown(report, false);

    assert.ok(markdown.includes("**Plan:"), "should have bold plan summary");
    assert.ok(markdown.includes("1 repo"), "should include count");
    assert.ok(markdown.includes("1 to create"), "should include breakdown");
  });

  test("renders migrate action with source", () => {
    const report: LifecycleReport = {
      actions: [
        {
          repoName: "org/migrated",
          action: "migrated",
          source: "https://dev.azure.com/org/proj/_git/repo",
        },
      ],
      totals: { created: 0, forked: 0, migrated: 1, existed: 0 },
    };

    const markdown = formatLifecycleReportMarkdown(report, false);

    assert.ok(
      markdown.includes(
        "+ MIGRATE https://dev.azure.com/org/proj/_git/repo -&gt; org/migrated"
      ),
      "should include migrate line with source and target (HTML entity arrow)"
    );
  });

  test("skips existed actions in diff block", () => {
    const report: LifecycleReport = {
      actions: [
        { repoName: "org/new-repo", action: "created" },
        { repoName: "org/existing", action: "existed" },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 1 },
    };

    const markdown = formatLifecycleReportMarkdown(report, false);

    assert.ok(
      !markdown.includes("org/existing"),
      "should not include existed entry"
    );
    assert.ok(
      markdown.includes("+ CREATE org/new-repo"),
      "should include created entry"
    );
  });

  test("includes settings details in diff block", () => {
    const report: LifecycleReport = {
      actions: [
        {
          repoName: "org/new-repo",
          action: "created",
          settings: { visibility: "private", description: "Test repo" },
        },
      ],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    const markdown = formatLifecycleReportMarkdown(report, false);

    assert.ok(
      markdown.includes("    visibility: private"),
      "should include visibility"
    );
    assert.ok(
      markdown.includes('    description: "Test repo"'),
      "should include description"
    );
  });

  test("renders comprehensive mixed scenario", () => {
    const report: LifecycleReport = {
      actions: [
        {
          repoName: "org/new-repo",
          action: "created",
          settings: { visibility: "private" },
        },
        {
          repoName: "org/my-fork",
          action: "forked",
          upstream: "octocat/Spoon-Knife",
        },
        { repoName: "org/existing", action: "existed" },
        {
          repoName: "org/migrated",
          action: "migrated",
          source: "https://dev.azure.com/org/proj/_git/repo",
        },
      ],
      totals: { created: 1, forked: 1, migrated: 1, existed: 1 },
    };

    const markdown = formatLifecycleReportMarkdown(report, true);

    assert.ok(markdown.includes("## Lifecycle Summary (Dry Run)"));
    assert.ok(markdown.includes("[!WARNING]"));
    assert.ok(markdown.includes("<pre>"));
    assert.ok(markdown.includes("+ CREATE org/new-repo"));
    assert.ok(markdown.includes("    visibility: private"));
    assert.ok(
      markdown.includes("+ FORK octocat/Spoon-Knife -&gt; org/my-fork")
    );
    assert.ok(
      !markdown.includes("org/existing"),
      "should not include existed entry"
    );
    assert.ok(
      markdown.includes(
        "+ MIGRATE https://dev.azure.com/org/proj/_git/repo -&gt; org/migrated"
      )
    );
    assert.ok(markdown.includes("**Plan: 3 repos"));
  });
});

describe("writeLifecycleReportSummary", () => {
  let tempFile: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempFile = join(tmpdir(), `lifecycle-report-test-${Date.now()}.md`);
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
    const report: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    writeLifecycleReportSummary(report, false);

    assert.ok(existsSync(tempFile));
    const content = readFileSync(tempFile, "utf-8");
    assert.ok(content.includes("Lifecycle Summary"));
  });

  test("no-ops when env var not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    const report: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "created" }],
      totals: { created: 1, forked: 0, migrated: 0, existed: 0 },
    };

    writeLifecycleReportSummary(report, false);

    assert.ok(!existsSync(tempFile));
  });

  test("no-ops when all actions are existed (no changes)", () => {
    process.env.GITHUB_STEP_SUMMARY = tempFile;
    const report: LifecycleReport = {
      actions: [{ repoName: "org/repo", action: "existed" }],
      totals: { created: 0, forked: 0, migrated: 0, existed: 1 },
    };

    writeLifecycleReportSummary(report, false);

    assert.ok(!existsSync(tempFile), "should not create file when all existed");
  });
});
