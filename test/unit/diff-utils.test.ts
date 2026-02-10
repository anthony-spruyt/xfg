import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  getFileStatus,
  generateDiff,
  createDiffStats,
  incrementDiffStats,
  formatStatusBadge,
  formatDiffLine,
} from "../../src/sync/diff-utils.js";

describe("getFileStatus", () => {
  test("returns NEW when file does not exist", () => {
    assert.equal(getFileStatus(false, true), "NEW");
    assert.equal(getFileStatus(false, false), "NEW");
  });

  test("returns MODIFIED when file exists and changed", () => {
    assert.equal(getFileStatus(true, true), "MODIFIED");
  });

  test("returns UNCHANGED when file exists and not changed", () => {
    assert.equal(getFileStatus(true, false), "UNCHANGED");
  });
});

describe("formatStatusBadge", () => {
  test("returns badge with correct text for NEW status", () => {
    const badge = formatStatusBadge("NEW");
    assert.ok(
      badge.includes("[NEW]"),
      "Badge should contain [NEW] in brackets"
    );
  });

  test("returns badge with correct text for MODIFIED status", () => {
    const badge = formatStatusBadge("MODIFIED");
    assert.ok(
      badge.includes("[MODIFIED]"),
      "Badge should contain [MODIFIED] in brackets"
    );
  });

  test("returns badge with correct text for UNCHANGED status", () => {
    const badge = formatStatusBadge("UNCHANGED");
    assert.ok(
      badge.includes("[UNCHANGED]"),
      "Badge should contain [UNCHANGED] in brackets"
    );
  });

  test("returns badge with correct text for DELETED status", () => {
    const badge = formatStatusBadge("DELETED");
    assert.ok(
      badge.includes("[DELETED]"),
      "Badge should contain [DELETED] in brackets"
    );
  });
});

describe("formatDiffLine", () => {
  test("formats addition lines", () => {
    const result = formatDiffLine("+added line");
    assert.ok(result.includes("+added line"), "Result should contain the line");
  });

  test("formats deletion lines", () => {
    const result = formatDiffLine("-deleted line");
    assert.ok(
      result.includes("-deleted line"),
      "Result should contain the line"
    );
  });

  test("formats hunk headers", () => {
    const result = formatDiffLine("@@ -1,3 +1,4 @@");
    assert.ok(
      result.includes("@@ -1,3 +1,4 @@"),
      "Result should contain hunk header"
    );
  });

  test("returns context lines unchanged", () => {
    const result = formatDiffLine(" context line");
    assert.ok(
      result.includes(" context line"),
      "Result should contain context line"
    );
  });
});

describe("generateDiff", () => {
  test("shows all lines as additions for new files", () => {
    const result = generateDiff(null, "line1\nline2\n", "test.txt");
    assert.ok(result.length > 0);
    // All lines should be additions (contain +)
    const ansiRegex = new RegExp(
      String.fromCharCode(0x1b) + "\\[[0-9;]*m",
      "g"
    );
    const rawLines = result.map((line) => line.replace(ansiRegex, ""));
    assert.ok(rawLines.some((line) => line.startsWith("+")));
  });

  test("returns empty array when content is identical", () => {
    const content = "same content\n";
    const result = generateDiff(content, content, "test.txt");
    assert.equal(result.length, 0);
  });

  test("shows additions and deletions for modified files", () => {
    const oldContent = "line1\nline2\nline3\n";
    const newContent = "line1\nmodified\nline3\n";
    const result = generateDiff(oldContent, newContent, "test.txt");

    // Should have some output
    assert.ok(result.length > 0);

    // Strip ANSI codes for checking
    const ansiRegex = new RegExp(
      String.fromCharCode(0x1b) + "\\[[0-9;]*m",
      "g"
    );
    const rawLines = result.map((line) => line.replace(ansiRegex, ""));

    // Should have hunk header
    assert.ok(rawLines.some((line) => line.startsWith("@@")));
    // Should have deletion
    assert.ok(rawLines.some((line) => line.startsWith("-")));
    // Should have addition
    assert.ok(rawLines.some((line) => line.startsWith("+")));
  });

  test("handles empty old content", () => {
    const result = generateDiff("", "new content\n", "test.txt");
    assert.ok(result.length > 0);
  });

  test("handles empty new content", () => {
    const result = generateDiff("old content\n", "", "test.txt");
    assert.ok(result.length > 0);
  });

  test("handles multiline changes", () => {
    const oldContent = "a\nb\nc\nd\ne\n";
    const newContent = "a\nx\ny\nd\ne\n";
    const result = generateDiff(oldContent, newContent, "test.txt");
    assert.ok(result.length > 0);
  });
});

describe("diffStats", () => {
  test("createDiffStats returns zeroed stats", () => {
    const stats = createDiffStats();
    assert.equal(stats.newCount, 0);
    assert.equal(stats.modifiedCount, 0);
    assert.equal(stats.unchangedCount, 0);
    assert.equal(stats.deletedCount, 0);
  });

  test("incrementDiffStats increments NEW count", () => {
    const stats = createDiffStats();
    incrementDiffStats(stats, "NEW");
    assert.equal(stats.newCount, 1);
    assert.equal(stats.modifiedCount, 0);
    assert.equal(stats.unchangedCount, 0);
  });

  test("incrementDiffStats increments MODIFIED count", () => {
    const stats = createDiffStats();
    incrementDiffStats(stats, "MODIFIED");
    assert.equal(stats.newCount, 0);
    assert.equal(stats.modifiedCount, 1);
    assert.equal(stats.unchangedCount, 0);
  });

  test("incrementDiffStats increments UNCHANGED count", () => {
    const stats = createDiffStats();
    incrementDiffStats(stats, "UNCHANGED");
    assert.equal(stats.newCount, 0);
    assert.equal(stats.modifiedCount, 0);
    assert.equal(stats.unchangedCount, 1);
  });

  test("incrementDiffStats increments DELETED count", () => {
    const stats = createDiffStats();
    incrementDiffStats(stats, "DELETED");
    assert.equal(stats.newCount, 0);
    assert.equal(stats.modifiedCount, 0);
    assert.equal(stats.unchangedCount, 0);
    assert.equal(stats.deletedCount, 1);
  });

  test("incrementDiffStats accumulates counts", () => {
    const stats = createDiffStats();
    incrementDiffStats(stats, "NEW");
    incrementDiffStats(stats, "NEW");
    incrementDiffStats(stats, "MODIFIED");
    incrementDiffStats(stats, "UNCHANGED");
    incrementDiffStats(stats, "UNCHANGED");
    incrementDiffStats(stats, "UNCHANGED");
    incrementDiffStats(stats, "DELETED");
    incrementDiffStats(stats, "DELETED");
    assert.equal(stats.newCount, 2);
    assert.equal(stats.modifiedCount, 1);
    assert.equal(stats.unchangedCount, 3);
    assert.equal(stats.deletedCount, 2);
  });
});

describe("generateDiff edge cases", () => {
  test("returns empty array when content is identical", () => {
    const content = "line 1\nline 2\nline 3";
    const lines = generateDiff(content, content, "test.txt");
    assert.equal(lines.length, 0);
  });

  test("handles multiple separate changes that get merged into hunks", () => {
    // Create content with changes at beginning and end (close enough to merge)
    const oldContent = "line 1\nline 2\nline 3\nline 4\nline 5";
    const newContent = "changed 1\nline 2\nline 3\nline 4\nchanged 5";

    const lines = generateDiff(oldContent, newContent, "test.txt", 1);
    // Changes should produce diff output
    assert.ok(lines.length > 0);
  });

  test("handles changes far apart creating separate hunks", () => {
    // Create content with changes far apart (won't merge)
    const oldLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const oldContent = oldLines.join("\n");

    const newLines = [...oldLines];
    newLines[0] = "changed first";
    newLines[19] = "changed last";
    const newContent = newLines.join("\n");

    const lines = generateDiff(oldContent, newContent, "test.txt", 1);
    // With only 1 line of context, should have diff output
    assert.ok(lines.length >= 1);
  });

  test("calculates correct hunk positions with changes in middle", () => {
    const oldContent = "line 1\nline 2\nline 3\nline 4\nline 5";
    const newContent = "line 1\nline 2\nchanged 3\nline 4\nline 5";

    const lines = generateDiff(oldContent, newContent, "test.txt", 1);
    assert.ok(lines.length > 0);
    // Should have both deletions and insertions in output
    const hasDelete = lines.some((l) => l.includes("-line 3"));
    const hasInsert = lines.some((l) => l.includes("+changed 3"));
    assert.ok(hasDelete, "Should have deletion line");
    assert.ok(hasInsert, "Should have insertion line");
  });
});
