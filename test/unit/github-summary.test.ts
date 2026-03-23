import { test, describe, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeGitHubStepSummary } from "../../src/output/github-summary.js";

describe("writeGitHubStepSummary", () => {
  const tmpFile = join(tmpdir(), `github-summary-test-${Date.now()}.md`);

  afterEach(() => {
    if (existsSync(tmpFile)) {
      unlinkSync(tmpFile);
    }
  });

  test("no-op when summaryPath is undefined", () => {
    writeGitHubStepSummary("# Hello", undefined);
    // Should not throw and no file created
  });

  test("appends markdown to file", () => {
    writeFileSync(tmpFile, "existing content");

    writeGitHubStepSummary("## Summary", tmpFile);

    const content = readFileSync(tmpFile, "utf-8");
    assert.ok(content.includes("existing content"));
    assert.ok(content.includes("## Summary"));
  });

  test("creates file if it does not exist", () => {
    writeGitHubStepSummary("# New Summary", tmpFile);

    assert.ok(existsSync(tmpFile));
    const content = readFileSync(tmpFile, "utf-8");
    assert.ok(content.includes("# New Summary"));
  });

  test("wraps content with newlines", () => {
    writeGitHubStepSummary("content", tmpFile);

    const content = readFileSync(tmpFile, "utf-8");
    assert.equal(content, "\ncontent\n");
  });

  test("handles write errors gracefully with logger", () => {
    const debugMessages: string[] = [];
    const log = { debug: (msg: string) => debugMessages.push(msg) };

    // Use a path that will fail (directory path)
    writeGitHubStepSummary("# Test", "/nonexistent-dir/file.md", log);

    assert.equal(debugMessages.length, 1);
    assert.ok(debugMessages[0].includes("Failed to write GitHub step summary"));
  });

  test("handles write errors gracefully without logger", () => {
    // Should not throw even without a logger
    writeGitHubStepSummary("# Test", "/nonexistent-dir/file.md");
  });
});
