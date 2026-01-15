import { test, describe, beforeEach, afterEach, mock } from "node:test";
import { strict as assert } from "node:assert";
import { Logger } from "./logger.js";

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

    test("increments succeeded counter", () => {
      logger.setTotal(3);
      logger.success(1, "repo1", "done");
      logger.success(2, "repo2", "done");

      assert.equal(logger.hasFailures(), false);
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

    test("increments failed counter", () => {
      logger.setTotal(3);
      logger.error(1, "repo1", "error");

      assert.equal(logger.hasFailures(), true);
    });
  });

  describe("hasFailures", () => {
    test("returns false when no failures", () => {
      logger.setTotal(3);
      logger.success(1, "repo1", "done");
      logger.skip(2, "repo2", "no changes");
      logger.success(3, "repo3", "done");

      assert.equal(logger.hasFailures(), false);
    });

    test("returns true after single failure", () => {
      logger.setTotal(3);
      logger.success(1, "repo1", "done");
      logger.error(2, "repo2", "failed");
      logger.success(3, "repo3", "done");

      assert.equal(logger.hasFailures(), true);
    });

    test("returns true after multiple failures", () => {
      logger.setTotal(3);
      logger.error(1, "repo1", "failed");
      logger.error(2, "repo2", "failed");
      logger.error(3, "repo3", "failed");

      assert.equal(logger.hasFailures(), true);
    });

    test("returns false initially", () => {
      assert.equal(logger.hasFailures(), false);
    });
  });

  describe("summary", () => {
    test("logs summary with all counts", () => {
      logger.setTotal(5);
      logger.success(1, "repo1", "done");
      logger.success(2, "repo2", "done");
      logger.skip(3, "repo3", "no changes");
      logger.error(4, "repo4", "failed");
      logger.error(5, "repo5", "failed");

      logger.summary();

      const output = consoleLogs.join("\n");
      assert.ok(output.includes("Summary"));
      assert.ok(output.includes("Total:"));
      assert.ok(output.includes("5"));
      assert.ok(output.includes("Succeeded:"));
      assert.ok(output.includes("2"));
      assert.ok(output.includes("Skipped:"));
      assert.ok(output.includes("1"));
      assert.ok(output.includes("Failed:"));
    });
  });

  describe("state isolation", () => {
    test("new Logger instance has fresh state", () => {
      const logger1 = new Logger();
      logger1.setTotal(5);
      logger1.error(1, "repo", "failed");

      const logger2 = new Logger();
      assert.equal(logger2.hasFailures(), false);
    });
  });
});
