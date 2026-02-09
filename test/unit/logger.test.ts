import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { Logger } from "../../src/shared/logger.js";

describe("Logger", () => {
  let logger: Logger;
  let consoleLogs: string[];
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    logger = new Logger();
    consoleLogs = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  describe("setTotal", () => {
    test("sets total count for progress display", () => {
      logger.setTotal(5);
      logger.progress(1, "repo", "message");

      assert.ok(consoleLogs[0].includes("[1/5]"));
    });
  });

  describe("progress", () => {
    test("logs progress with current/total and repo name", () => {
      logger.setTotal(10);
      logger.progress(3, "org/repo", "Processing...");

      assert.ok(consoleLogs[0].includes("[3/10]"));
      assert.ok(consoleLogs[0].includes("org/repo"));
      assert.ok(consoleLogs[0].includes("Processing..."));
    });
  });

  describe("info", () => {
    test("logs indented info message", () => {
      logger.info("Some info");

      assert.ok(consoleLogs[0].includes("Some info"));
    });
  });

  describe("success", () => {
    test("logs success message with checkmark", () => {
      logger.setTotal(5);
      logger.success(2, "org/repo", "PR created");

      assert.ok(consoleLogs[0].includes("[2/5]"));
      assert.ok(consoleLogs[0].includes("org/repo"));
      assert.ok(consoleLogs[0].includes("PR created"));
    });
  });

  describe("skip", () => {
    test("logs skip message with reason", () => {
      logger.setTotal(5);
      logger.skip(3, "org/repo", "No changes");

      assert.ok(consoleLogs[0].includes("[3/5]"));
      assert.ok(consoleLogs[0].includes("org/repo"));
      assert.ok(consoleLogs[0].includes("Skipped"));
      assert.ok(consoleLogs[0].includes("No changes"));
    });
  });

  describe("error", () => {
    test("logs error message", () => {
      logger.setTotal(5);
      logger.error(4, "org/repo", "Clone failed");

      assert.ok(consoleLogs[0].includes("[4/5]"));
      assert.ok(consoleLogs[0].includes("org/repo"));
      assert.ok(consoleLogs[0].includes("Clone failed"));
    });
  });

  describe("fileDiff", () => {
    test("logs file name with status badge for NEW file", () => {
      logger.fileDiff("config.json", "NEW", ["+line1", "+line2"]);

      const output = consoleLogs.join("\n");
      assert.ok(output.includes("config.json"));
      assert.ok(output.includes("+line1"));
      assert.ok(output.includes("+line2"));
    });

    test("logs file name with status badge for MODIFIED file", () => {
      logger.fileDiff("config.json", "MODIFIED", ["-old", "+new"]);

      const output = consoleLogs.join("\n");
      assert.ok(output.includes("config.json"));
      assert.ok(output.includes("-old"));
      assert.ok(output.includes("+new"));
    });

    test("logs file name without diff lines for UNCHANGED file", () => {
      logger.fileDiff("config.json", "UNCHANGED", []);

      const output = consoleLogs.join("\n");
      assert.ok(output.includes("config.json"));
      // Should only have one log entry (the file name line)
      assert.equal(consoleLogs.length, 1);
    });

    test("does not show diff lines for UNCHANGED even if provided", () => {
      logger.fileDiff("config.json", "UNCHANGED", ["should", "not", "show"]);

      // UNCHANGED files should not show diff lines
      const output = consoleLogs.join("\n");
      assert.ok(!output.includes("should"));
    });

    test("handles empty diff lines for NEW file", () => {
      logger.fileDiff("empty.json", "NEW", []);

      const output = consoleLogs.join("\n");
      assert.ok(output.includes("empty.json"));
      assert.equal(consoleLogs.length, 1);
    });
  });

  describe("diffSummary", () => {
    test("logs summary with all counts", () => {
      logger.diffSummary(2, 3, 1);

      const output = consoleLogs.join("\n");
      assert.ok(output.includes("Summary"));
      assert.ok(output.includes("2 new"));
      assert.ok(output.includes("3 modified"));
      assert.ok(output.includes("1 unchanged"));
    });

    test("logs summary with only new files", () => {
      logger.diffSummary(5, 0, 0);

      const output = consoleLogs.join("\n");
      assert.ok(output.includes("5 new"));
      assert.ok(!output.includes("modified"));
      assert.ok(!output.includes("unchanged"));
    });

    test("logs summary with only modified files", () => {
      logger.diffSummary(0, 3, 0);

      const output = consoleLogs.join("\n");
      assert.ok(!output.includes("new"));
      assert.ok(output.includes("3 modified"));
      assert.ok(!output.includes("unchanged"));
    });

    test("logs summary with only unchanged files", () => {
      logger.diffSummary(0, 0, 4);

      const output = consoleLogs.join("\n");
      assert.ok(!output.includes("new"));
      assert.ok(!output.includes("modified"));
      assert.ok(output.includes("4 unchanged"));
    });

    test("logs nothing when all counts are zero", () => {
      logger.diffSummary(0, 0, 0);

      // Should not output anything
      assert.equal(consoleLogs.length, 0);
    });

    test("logs summary with deleted files", () => {
      logger.diffSummary(1, 2, 1, 3);

      const output = consoleLogs.join("\n");
      assert.ok(output.includes("Summary"));
      assert.ok(output.includes("1 new"));
      assert.ok(output.includes("2 modified"));
      assert.ok(output.includes("3 deleted"));
      assert.ok(output.includes("1 unchanged"));
    });

    test("logs summary with only deleted files", () => {
      logger.diffSummary(0, 0, 0, 2);

      const output = consoleLogs.join("\n");
      assert.ok(!output.includes("new"));
      assert.ok(!output.includes("modified"));
      assert.ok(output.includes("2 deleted"));
      assert.ok(!output.includes("unchanged"));
    });
  });
});
