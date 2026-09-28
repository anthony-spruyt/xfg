import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeGitHubStepSummary,
  summaryBytesLeft,
  STEP_SUMMARY_MAX_BYTES,
} from "../../../src/output/github-summary.js";

describe("writeGitHubStepSummary", () => {
  let tmpDir: string;
  let tmpFile: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "github-summary-test-"));
    tmpFile = join(tmpDir, "summary.md");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
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

  test("writes a short note instead of a summary GitHub would reject", () => {
    writeGitHubStepSummary("x".repeat(STEP_SUMMARY_MAX_BYTES + 1), tmpFile);

    const content = readFileSync(tmpFile, "utf-8");
    assert.ok(content.length < 1000);
    assert.ok(content.includes("too large"));
  });

  test("counts what is already in the file against the limit", () => {
    writeFileSync(tmpFile, "e".repeat(STEP_SUMMARY_MAX_BYTES - 1000));

    writeGitHubStepSummary("x".repeat(2000), tmpFile);

    const content = readFileSync(tmpFile, "utf-8");
    assert.ok(content.includes("too large"));
    assert.ok(!content.includes("xx"));
    assert.ok(Buffer.byteLength(content) <= STEP_SUMMARY_MAX_BYTES);
  });

  test("writes nothing when even the note would go over the limit", () => {
    writeFileSync(tmpFile, "e".repeat(STEP_SUMMARY_MAX_BYTES - 10));

    writeGitHubStepSummary("x".repeat(2000), tmpFile);

    assert.equal(statSync(tmpFile).size, STEP_SUMMARY_MAX_BYTES - 10);
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

  test("summaryBytesLeft leaves room for the wrapping newlines", () => {
    assert.equal(summaryBytesLeft(tmpFile), STEP_SUMMARY_MAX_BYTES - 2);
    writeFileSync(tmpFile, "abc");
    assert.equal(summaryBytesLeft(tmpFile), STEP_SUMMARY_MAX_BYTES - 5);
  });

  test("handles write errors gracefully without logger", () => {
    // Should not throw even without a logger
    writeGitHubStepSummary("# Test", "/nonexistent-dir/file.md");
  });
});
