import { describe, test } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  escapeShellArg,
  formatPRBody,
  formatPRTitle,
  createPR,
  mergePR,
  FileAction,
} from "../../src/git/pr-creator.js";
import type { GitHubRepoInfo } from "../../src/shared/repo-detector.js";

// Helper to create a mock repo info for tests
function createMockRepoInfo(
  overrides: Partial<GitHubRepoInfo> = {}
): GitHubRepoInfo {
  return {
    type: "github",
    gitUrl: "git@github.com:test-org/test-repo.git",
    owner: "test-org",
    repo: "test-repo",
    host: "github.com",
    ...overrides,
  };
}

describe("escapeShellArg", () => {
  test("wraps simple strings in single quotes", () => {
    assert.strictEqual(escapeShellArg("hello"), "'hello'");
  });

  test("escapes embedded single quotes", () => {
    // Input: it's a test
    // Expected: 'it'\''s a test'
    assert.strictEqual(escapeShellArg("it's a test"), "'it'\\''s a test'");
  });

  test("handles empty strings", () => {
    assert.strictEqual(escapeShellArg(""), "''");
  });

  test("handles strings with spaces", () => {
    assert.strictEqual(escapeShellArg("hello world"), "'hello world'");
  });

  test("handles strings with newlines", () => {
    assert.strictEqual(escapeShellArg("hello\nworld"), "'hello\nworld'");
  });

  test("handles strings with shell metacharacters: | & ; $ ` \\", () => {
    // These should be safely wrapped in single quotes
    assert.strictEqual(escapeShellArg("cmd | other"), "'cmd | other'");
    assert.strictEqual(escapeShellArg("cmd && other"), "'cmd && other'");
    assert.strictEqual(escapeShellArg("cmd; other"), "'cmd; other'");
    assert.strictEqual(escapeShellArg("$HOME"), "'$HOME'");
    assert.strictEqual(escapeShellArg("`whoami`"), "'`whoami`'");
    assert.strictEqual(escapeShellArg("path\\to\\file"), "'path\\to\\file'");
  });

  test("handles strings with double quotes", () => {
    assert.strictEqual(escapeShellArg('say "hello"'), "'say \"hello\"'");
  });

  test("handles strings with multiple single quotes", () => {
    // Input: it's Alice's book
    // Expected: 'it'\''s Alice'\''s book'
    assert.strictEqual(
      escapeShellArg("it's Alice's book"),
      "'it'\\''s Alice'\\''s book'"
    );
  });

  test("handles command injection attempt via backticks", () => {
    const malicious = "Fix bug `whoami`";
    const escaped = escapeShellArg(malicious);
    // The backticks are safely contained in single quotes
    assert.strictEqual(escaped, "'Fix bug `whoami`'");
  });

  test("handles command injection attempt via $()", () => {
    const malicious = "Update $(cat /etc/passwd)";
    const escaped = escapeShellArg(malicious);
    // The $() is safely contained in single quotes
    assert.strictEqual(escaped, "'Update $(cat /etc/passwd)'");
  });

  test("handles git URL with embedded malicious content", () => {
    const malicious = 'https://github.com/org/repo.git"; rm -rf /';
    const escaped = escapeShellArg(malicious);
    // The entire string is safely quoted
    assert.strictEqual(
      escaped,
      "'https://github.com/org/repo.git\"; rm -rf /'"
    );
  });
});

describe("formatPRBody", () => {
  const repoInfo = createMockRepoInfo();

  test("includes file name in body for single file", () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = formatPRBody(files, repoInfo);
    assert.ok(result.includes("config.json"));
  });

  test('uses "Created" for create action', () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = formatPRBody(files, repoInfo);
    assert.ok(result.includes("Created"));
  });

  test('uses "Updated" for update action', () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "update" }];
    const result = formatPRBody(files, repoInfo);
    assert.ok(result.includes("Updated"));
  });

  test('uses "Deleted" for delete action', () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "delete" }];
    const result = formatPRBody(files, repoInfo);
    assert.ok(result.includes("Deleted"));
  });

  test("handles mixed create, update, and delete actions", () => {
    const files: FileAction[] = [
      { fileName: "new.json", action: "create" },
      { fileName: "existing.json", action: "update" },
      { fileName: "old.json", action: "delete" },
    ];
    const result = formatPRBody(files, repoInfo);
    assert.ok(result.includes("Created `new.json`"));
    assert.ok(result.includes("Updated `existing.json`"));
    assert.ok(result.includes("Deleted `old.json`"));
  });

  test("preserves markdown formatting", () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = formatPRBody(files, repoInfo);
    // Should contain markdown headers or formatting
    assert.ok(
      result.includes("##") || result.includes("*") || result.includes("-")
    );
  });

  test("handles multiple files", () => {
    const files: FileAction[] = [
      { fileName: "config.json", action: "create" },
      { fileName: "settings.yaml", action: "update" },
    ];
    const result = formatPRBody(files, repoInfo);
    assert.ok(result.includes("config.json"));
    assert.ok(result.includes("settings.yaml"));
    assert.ok(result.includes("Created"));
    assert.ok(result.includes("Updated"));
  });

  test("uses custom template when provided", () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const customTemplate = "## Custom\n\n${xfg:pr.fileChanges}\n\nDone.";
    const result = formatPRBody(files, repoInfo, customTemplate);
    assert.ok(result.includes("## Custom"));
    assert.ok(result.includes("Created `config.json`"));
    assert.ok(result.includes("Done."));
  });

  test("replaces ${xfg:pr.fileChanges} placeholder in custom template", () => {
    const files: FileAction[] = [
      { fileName: "a.json", action: "create" },
      { fileName: "b.yaml", action: "update" },
    ];
    const customTemplate = "Changes:\n${xfg:pr.fileChanges}";
    const result = formatPRBody(files, repoInfo, customTemplate);
    assert.ok(result.includes("Changes:"));
    assert.ok(result.includes("- Created `a.json`"));
    assert.ok(result.includes("- Updated `b.yaml`"));
  });

  test("interpolates repo variables in custom template", () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const customTemplate =
      "Sync to ${xfg:repo.fullName}\n\n${xfg:pr.fileChanges}";
    const result = formatPRBody(files, repoInfo, customTemplate);
    assert.ok(result.includes("Sync to test-org/test-repo"));
    assert.ok(result.includes("Created `config.json`"));
  });

  test("interpolates pr.fileCount in custom template", () => {
    const files: FileAction[] = [
      { fileName: "a.json", action: "create" },
      { fileName: "b.json", action: "update" },
    ];
    const customTemplate = "Changed ${xfg:pr.fileCount} files";
    const result = formatPRBody(files, repoInfo, customTemplate);
    assert.ok(result.includes("Changed 2 files"));
  });

  test("handles template without placeholders", () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const customTemplate = "Static template with no placeholder";
    const result = formatPRBody(files, repoInfo, customTemplate);
    assert.strictEqual(result, "Static template with no placeholder");
  });
});

describe("formatPRTitle", () => {
  test("single file: includes file name", () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = formatPRTitle(files);
    assert.strictEqual(result, "chore: sync config.json");
  });

  test("two files: lists both file names", () => {
    const files: FileAction[] = [
      { fileName: "config.json", action: "create" },
      { fileName: "settings.yaml", action: "update" },
    ];
    const result = formatPRTitle(files);
    assert.strictEqual(result, "chore: sync config.json, settings.yaml");
  });

  test("three files: lists all file names", () => {
    const files: FileAction[] = [
      { fileName: "a.json", action: "create" },
      { fileName: "b.json", action: "update" },
      { fileName: "c.json", action: "create" },
    ];
    const result = formatPRTitle(files);
    assert.strictEqual(result, "chore: sync a.json, b.json, c.json");
  });

  test("more than 3 files: shows count", () => {
    const files: FileAction[] = [
      { fileName: "a.json", action: "create" },
      { fileName: "b.json", action: "update" },
      { fileName: "c.json", action: "create" },
      { fileName: "d.json", action: "update" },
    ];
    const result = formatPRTitle(files);
    assert.strictEqual(result, "chore: sync 4 config files");
  });
});

describe("loadPRTemplate (via formatPRBody)", () => {
  // Get the expected path for PR.md
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const templatePath = join(__dirname, "..", "..", "PR.md");
  const repoInfo = createMockRepoInfo();

  test("loads PR.md template when file exists", () => {
    // Verify PR.md exists in the project
    assert.ok(
      existsSync(templatePath),
      `PR.md should exist at ${templatePath}`
    );

    // formatPRBody should use content from PR.md
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = formatPRBody(files, repoInfo);

    // The actual PR.md has specific content we can verify
    // It should contain markdown formatting from the template
    assert.ok(result.length > 50, "Template should have substantial content");
  });

  test("template contains expected sections", () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = formatPRBody(files, repoInfo);

    // PR.md should have summary section and automation note
    assert.ok(
      result.includes("xfg") ||
        result.includes("Summary") ||
        result.includes("Changes"),
      "Template should have expected sections"
    );
  });

  test("fallback template structure is valid", () => {
    // The fallback template (in case PR.md is missing) has a specific structure
    // We verify by checking that formatPRBody always returns valid content
    const files: FileAction[] = [{ fileName: "test.json", action: "create" }];
    const result = formatPRBody(files, repoInfo);

    // Should have the filename
    assert.ok(result.includes("test.json"));

    // Should have the action text
    assert.ok(result.includes("Created"));

    // Should have some structure (markdown headers or bullets)
    assert.ok(
      result.includes("#") || result.includes("-") || result.includes("*"),
      "Should have markdown formatting"
    );
  });

  test("interpolates repo variables in default template", () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = formatPRBody(files, repoInfo);

    // Default PR.md uses ${xfg:repo.fullName}
    assert.ok(
      result.includes("test-org/test-repo"),
      "Should interpolate repo.fullName"
    );
  });
});

describe("skip action handling", () => {
  const repoInfo = createMockRepoInfo();

  describe("formatPRBody with skip action", () => {
    test("excludes skipped files from changes list", () => {
      const files: FileAction[] = [
        { fileName: "config.json", action: "create" },
        { fileName: "skipped.json", action: "skip" },
      ];
      const result = formatPRBody(files, repoInfo);
      assert.ok(result.includes("config.json"));
      assert.ok(!result.includes("skipped.json"));
    });

    test("handles all files skipped gracefully", () => {
      const files: FileAction[] = [
        { fileName: "skipped.json", action: "skip" },
      ];
      const result = formatPRBody(files, repoInfo);
      // Should still return valid markdown, even if empty changes
      assert.ok(typeof result === "string");
    });

    test("mixed actions: only shows created/updated files", () => {
      const files: FileAction[] = [
        { fileName: "created.json", action: "create" },
        { fileName: "updated.json", action: "update" },
        { fileName: "skipped.json", action: "skip" },
      ];
      const result = formatPRBody(files, repoInfo);
      assert.ok(result.includes("Created"));
      assert.ok(result.includes("Updated"));
      assert.ok(result.includes("created.json"));
      assert.ok(result.includes("updated.json"));
      assert.ok(!result.includes("skipped.json"));
    });
  });

  describe("formatPRTitle with skip action", () => {
    test("excludes skipped files from title - single file remaining", () => {
      const files: FileAction[] = [
        { fileName: "config.json", action: "create" },
        { fileName: "skipped.json", action: "skip" },
      ];
      const result = formatPRTitle(files);
      assert.strictEqual(result, "chore: sync config.json");
    });

    test("excludes skipped files from title - multiple files remaining", () => {
      const files: FileAction[] = [
        { fileName: "a.json", action: "create" },
        { fileName: "b.json", action: "update" },
        { fileName: "skipped.json", action: "skip" },
      ];
      const result = formatPRTitle(files);
      assert.strictEqual(result, "chore: sync a.json, b.json");
    });

    test("excludes skipped files from count", () => {
      const files: FileAction[] = [
        { fileName: "a.json", action: "create" },
        { fileName: "b.json", action: "update" },
        { fileName: "c.json", action: "create" },
        { fileName: "d.json", action: "update" },
        { fileName: "skipped1.json", action: "skip" },
        { fileName: "skipped2.json", action: "skip" },
      ];
      const result = formatPRTitle(files);
      // 4 actual changes, 2 skipped - title should show 4
      assert.strictEqual(result, "chore: sync 4 config files");
    });

    test("handles all files skipped", () => {
      const files: FileAction[] = [
        { fileName: "a.json", action: "skip" },
        { fileName: "b.json", action: "skip" },
      ];
      const result = formatPRTitle(files);
      // Edge case: no actual changes - should handle gracefully
      assert.ok(typeof result === "string");
    });
  });
});

describe("createPR", () => {
  const repoInfo = createMockRepoInfo();

  test("uses provided executor when not in dry-run", async () => {
    const mockExecutor = {
      async exec(): Promise<string> {
        return "https://github.com/owner/repo/pull/123";
      },
    };

    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = await createPR({
      repoInfo,
      branchName: "chore/sync-config",
      baseBranch: "main",
      files,
      workDir: "/tmp/test",
      dryRun: false,
      executor: mockExecutor,
    });

    assert.equal(result.success, true);
    assert.ok(result.url?.includes("pull/123"));
  });

  test("returns dry-run message when dryRun is true", async () => {
    const files: FileAction[] = [{ fileName: "config.json", action: "create" }];
    const result = await createPR({
      repoInfo,
      branchName: "chore/sync-config",
      baseBranch: "main",
      files,
      workDir: "/tmp/test",
      dryRun: true,
    });

    assert.equal(result.success, true);
    assert.ok(result.message.includes("[DRY RUN]"));
    assert.ok(result.message.includes("Would create PR"));
    assert.ok(result.message.includes("chore: sync config.json"));
  });

  test("dry-run message includes PR title with multiple files", async () => {
    const files: FileAction[] = [
      { fileName: "a.json", action: "create" },
      { fileName: "b.json", action: "update" },
    ];
    const result = await createPR({
      repoInfo,
      branchName: "chore/sync-config",
      baseBranch: "main",
      files,
      workDir: "/tmp/test",
      dryRun: true,
    });

    assert.equal(result.success, true);
    assert.ok(result.message.includes("a.json, b.json"));
  });
});

describe("mergePR", () => {
  const repoInfo = createMockRepoInfo();

  test("uses provided executor when not in dry-run", async () => {
    const mockExecutor = {
      async exec(): Promise<string> {
        return "";
      },
    };

    const result = await mergePR({
      repoInfo,
      prUrl: "https://github.com/test-org/test-repo/pull/1",
      mergeConfig: {
        mode: "force",
        strategy: "squash",
        deleteBranch: true,
      },
      workDir: "/tmp/test",
      dryRun: false,
      executor: mockExecutor,
    });

    assert.equal(result.success, true);
  });

  test("returns dry-run message for force mode", async () => {
    const result = await mergePR({
      repoInfo,
      prUrl: "https://github.com/test-org/test-repo/pull/1",
      mergeConfig: {
        mode: "force",
        strategy: "squash",
        deleteBranch: true,
      },
      workDir: "/tmp/test",
      dryRun: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.merged, false);
    assert.ok(result.message.includes("[DRY RUN]"));
    assert.ok(result.message.includes("force merge"));
  });

  test("returns dry-run message for auto mode", async () => {
    const result = await mergePR({
      repoInfo,
      prUrl: "https://github.com/test-org/test-repo/pull/1",
      mergeConfig: {
        mode: "auto",
        strategy: "squash",
        deleteBranch: true,
      },
      workDir: "/tmp/test",
      dryRun: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.merged, false);
    assert.ok(result.message.includes("[DRY RUN]"));
    assert.ok(result.message.includes("enable auto-merge"));
  });

  test("returns dry-run message for manual mode", async () => {
    const result = await mergePR({
      repoInfo,
      prUrl: "https://github.com/test-org/test-repo/pull/1",
      mergeConfig: {
        mode: "manual",
        strategy: "squash",
        deleteBranch: true,
      },
      workDir: "/tmp/test",
      dryRun: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.merged, false);
    assert.ok(result.message.includes("[DRY RUN]"));
    assert.ok(result.message.includes("manual review"));
  });
});
