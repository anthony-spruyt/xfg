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
    writeGitHubStepSummary(() => "# Hello", undefined);
  });

  test("appends markdown to file", () => {
    writeFileSync(tmpFile, "existing content");

    writeGitHubStepSummary(() => "## Summary", tmpFile);

    const content = readFileSync(tmpFile, "utf-8");
    assert.ok(content.includes("existing content"));
    assert.ok(content.includes("## Summary"));
  });

  test("creates file if it does not exist", () => {
    writeGitHubStepSummary(() => "# New Summary", tmpFile);

    assert.ok(existsSync(tmpFile));
    const content = readFileSync(tmpFile, "utf-8");
    assert.ok(content.includes("# New Summary"));
  });

  test("passes the bytes left in this step's summary file to render", () => {
    writeFileSync(tmpFile, "abc");
    let maxBytes = 0;

    writeGitHubStepSummary((max) => {
      maxBytes = max;
      return "x";
    }, tmpFile);

    assert.equal(maxBytes, STEP_SUMMARY_MAX_BYTES - 5);
  });

  test("writes nothing when the markdown does not fit", () => {
    writeFileSync(tmpFile, "e".repeat(STEP_SUMMARY_MAX_BYTES - 10));

    writeGitHubStepSummary(() => "x".repeat(2000), tmpFile);

    assert.equal(statSync(tmpFile).size, STEP_SUMMARY_MAX_BYTES - 10);
  });

  test("writes nothing when render returns an empty string", () => {
    writeGitHubStepSummary(() => "", tmpFile);

    assert.equal(readFileSync(tmpFile, "utf-8"), "");
  });

  test("wraps content with newlines", () => {
    writeGitHubStepSummary(() => "content", tmpFile);

    const content = readFileSync(tmpFile, "utf-8");
    assert.equal(content, "\ncontent\n");
  });

  test("logs instead of throwing when the path is unusable", () => {
    const debugMessages: string[] = [];
    const log = { debug: (msg: string) => debugMessages.push(msg) };

    writeGitHubStepSummary(() => "# Test", join(tmpDir, "x".repeat(300)), log);

    assert.equal(debugMessages.length, 1);
    assert.ok(debugMessages[0].includes("Failed to write GitHub step summary"));
  });

  test("logs instead of throwing when render throws", () => {
    const debugMessages: string[] = [];
    const log = { debug: (msg: string) => debugMessages.push(msg) };

    writeGitHubStepSummary(
      () => {
        throw new Error("boom");
      },
      tmpFile,
      log
    );

    assert.equal(debugMessages.length, 1);
    assert.ok(debugMessages[0].includes("boom"));
    assert.equal(readFileSync(tmpFile, "utf-8"), "");
  });
});
