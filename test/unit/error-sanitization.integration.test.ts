import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { ShellCommandExecutor } from "../../src/shared/command-executor.js";
import { withRetry } from "../../src/shared/retry-utils.js";
import { logger } from "../../src/shared/logger.js";

/**
 * Integration tests verifying credentials don't leak through error paths.
 * These tests use hardcoded strings (no user input) for testing credential
 * sanitization in error output paths.
 */
describe("error sanitization integration", () => {
  test("command executor sanitizes embedded credentials in stderr", async () => {
    const executor = new ShellCommandExecutor();

    // Simulate a git-like error that contains embedded credentials
    const errorMessage =
      "fatal: repository 'https://x-access-token:ghp_SUPERSECRET123@github.com/nonexistent/repo.git/' not found";

    try {
      await executor.exec(
        `node -e "console.error('${errorMessage.replace(/'/g, "\\'")}'); process.exit(128)"`,
        "."
      );
      assert.fail("Should have thrown");
    } catch (error) {
      // The error message and stderr should be sanitized
      const message = (error as Error).message;
      const stderr = (error as { stderr?: string }).stderr ?? "";

      assert.ok(
        !message.includes("SUPERSECRET123"),
        "Token must not appear in error message"
      );
      assert.ok(
        !stderr.includes("SUPERSECRET123"),
        "Token must not appear in stderr"
      );
      // Verify sanitization occurred
      assert.ok(message.includes("***"), "Token should be replaced with ***");
    }
  });

  test("retry logging does not leak credentials", async () => {
    const logs: string[] = [];
    const originalInfo = logger.info;
    logger.info = (msg: string) => logs.push(msg);

    try {
      await withRetry(
        async () => {
          throw new Error(
            "Cloning https://oauth2:glpat-SECRET@gitlab.com failed"
          );
        },
        { retries: 1 }
      );
    } catch {
      // Expected to fail
    } finally {
      logger.info = originalInfo;
    }

    const allLogs = logs.join("\n");
    assert.ok(
      !allLogs.includes("glpat-SECRET"),
      "GitLab token must be sanitized"
    );
    assert.ok(!allLogs.includes("SECRET"), "No secrets in logs");
  });
});
