# Error Message Sanitization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent sensitive credentials (tokens, passwords) from leaking in error messages and logs.

**Architecture:** Add a centralized `sanitizeCredentials()` utility that strips credential patterns from error messages and stderr. Apply this utility at the logging boundary (retry-utils, command-executor) so all downstream code benefits automatically.

**Tech Stack:** TypeScript, Node.js test runner

---

## Background

Security review identified that error messages could potentially leak embedded credentials:

- Git URLs with format `https://x-access-token:TOKEN@host/...`
- Azure DevOps PATs in credential helper output
- GitLab tokens in similar contexts

While GitHub Actions auto-masks known secrets, dynamically generated tokens (like GitHub App installation tokens) or error messages containing URLs may not be masked.

---

### Task 1: Create Credential Sanitization Utility

**Files:**

- Create: `src/sanitize-utils.ts`
- Test: `test/unit/sanitize-utils.test.ts`

**Step 1: Write the failing tests**

Create `test/unit/sanitize-utils.test.ts`:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { sanitizeCredentials } from "../../src/sanitize-utils.js";

describe("sanitizeCredentials", () => {
  test("sanitizes x-access-token in URLs", () => {
    const input =
      "fatal: unable to access 'https://x-access-token:ghp_abc123@github.com/owner/repo/': The requested URL returned error: 401";
    const result = sanitizeCredentials(input);
    assert.equal(
      result,
      "fatal: unable to access 'https://x-access-token:***@github.com/owner/repo/': The requested URL returned error: 401"
    );
  });

  test("sanitizes oauth2 tokens in GitLab URLs", () => {
    const input =
      "Cloning into '.'... fatal: Authentication failed for 'https://oauth2:glpat-xxxx@gitlab.com/owner/repo.git/'";
    const result = sanitizeCredentials(input);
    assert.equal(
      result,
      "Cloning into '.'... fatal: Authentication failed for 'https://oauth2:***@gitlab.com/owner/repo.git/'"
    );
  });

  test("sanitizes pat username in Azure DevOps URLs", () => {
    const input =
      "error: could not lock config file https://pat:ado-token-here@dev.azure.com/org/project/_git/repo";
    const result = sanitizeCredentials(input);
    assert.equal(
      result,
      "error: could not lock config file https://pat:***@dev.azure.com/org/project/_git/repo"
    );
  });

  test("sanitizes multiple credentials in same message", () => {
    const input =
      "Tried https://x-access-token:abc@host1.com and https://oauth2:def@host2.com";
    const result = sanitizeCredentials(input);
    assert.equal(
      result,
      "Tried https://x-access-token:***@host1.com and https://oauth2:***@host2.com"
    );
  });

  test("preserves messages without credentials", () => {
    const input = "fatal: repository 'https://github.com/owner/repo' not found";
    const result = sanitizeCredentials(input);
    assert.equal(result, input);
  });

  test("handles empty string", () => {
    assert.equal(sanitizeCredentials(""), "");
  });

  test("handles undefined/null gracefully", () => {
    assert.equal(sanitizeCredentials(undefined as unknown as string), "");
    assert.equal(sanitizeCredentials(null as unknown as string), "");
  });

  test("sanitizes Bearer tokens in headers", () => {
    const input = "Authorization: Bearer ghp_abc123xyz";
    const result = sanitizeCredentials(input);
    assert.equal(result, "Authorization: Bearer ***");
  });

  test("sanitizes Basic auth headers", () => {
    const input = "Authorization: Basic dXNlcjpwYXNz";
    const result = sanitizeCredentials(input);
    assert.equal(result, "Authorization: Basic ***");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "sanitizeCredentials"`
Expected: FAIL with "Cannot find module" or similar

**Step 3: Write minimal implementation**

Create `src/sanitize-utils.ts`:

```typescript
/**
 * Sanitizes credentials from error messages and logs.
 * Replaces sensitive tokens/passwords with '***' to prevent leakage.
 *
 * @param message The message that may contain credentials
 * @returns The sanitized message with credentials replaced by '***'
 */
export function sanitizeCredentials(
  message: string | undefined | null
): string {
  if (!message) {
    return "";
  }

  let result = message;

  // Handle URL credentials (most common case)
  // Replace password portion in https://user:password@host patterns
  result = result.replace(/(https:\/\/[^:]+:)([^@]+)(@)/g, "$1***$3");

  // Handle Authorization headers
  result = result.replace(/(Authorization:\s*Bearer\s+)(\S+)/gi, "$1***");
  result = result.replace(/(Authorization:\s*Basic\s+)(\S+)/gi, "$1***");

  return result;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern "sanitizeCredentials"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sanitize-utils.ts test/unit/sanitize-utils.test.ts
git commit -m "feat: add credential sanitization utility for error messages"
```

---

### Task 2: Integrate Sanitization into Retry Logging

**Files:**

- Modify: `src/retry-utils.ts:1-10` (imports)
- Modify: `src/retry-utils.ts:156-162` (onFailedAttempt)
- Test: `test/unit/retry-utils.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/retry-utils.test.ts` in the `withRetry` describe block:

```typescript
test("sanitizes credentials in retry log messages", async () => {
  const logs: string[] = [];
  const originalInfo = logger.info;
  logger.info = (msg: string) => logs.push(msg);

  let attempts = 0;
  try {
    await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error(
            "fatal: Authentication failed for 'https://x-access-token:secret123@github.com/repo'"
          );
        }
        return "success";
      },
      { retries: 3 }
    );
  } finally {
    logger.info = originalInfo;
  }

  // Verify credentials were sanitized in log output
  assert.equal(logs.length, 2); // 2 failed attempts before success
  for (const log of logs) {
    assert.ok(!log.includes("secret123"), "Token should be sanitized");
    assert.ok(log.includes("***"), "Token should be replaced with ***");
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "sanitizes credentials in retry"`
Expected: FAIL - log contains "secret123"

**Step 3: Modify retry-utils.ts**

Update imports at top of `src/retry-utils.ts`:

```typescript
import pRetry, { AbortError } from "p-retry";
import { logger } from "./logger.js";
import { sanitizeCredentials } from "./sanitize-utils.js";
```

Update onFailedAttempt callback (~line 156-162):

```typescript
      onFailedAttempt: (context) => {
        // Only log if this isn't the last attempt
        if (context.retriesLeft > 0) {
          const msg = sanitizeCredentials(context.error.message) || "Unknown error";
          logger.info(
            `Attempt ${context.attemptNumber}/${retries + 1} failed: ${msg}. Retrying...`
          );
          options?.onRetry?.(context.error, context.attemptNumber);
        }
      },
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "sanitizes credentials in retry"`
Expected: PASS

**Step 5: Run full retry-utils test suite**

Run: `npm test -- --test-name-pattern "retry"`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/retry-utils.ts test/unit/retry-utils.test.ts
git commit -m "feat: sanitize credentials in retry failure logs"
```

---

### Task 3: Integrate Sanitization into Command Executor

**Files:**

- Modify: `src/command-executor.ts:1-5` (imports)
- Modify: `src/command-executor.ts:39-42` (error handling)
- Test: `test/unit/command-executor.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/command-executor.test.ts`:

```typescript
describe("credential sanitization", () => {
  test("sanitizes credentials in error messages", async () => {
    const executor = new ShellCommandExecutor();

    try {
      // Use a simple failing command that outputs to stderr
      // Note: This tests the sanitization of stderr content
      await executor.exec(
        "node -e \"console.error('fatal: https://x-access-token:secret@github.com'); process.exit(1)\"",
        "."
      );
      assert.fail("Should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      assert.ok(
        !message.includes("secret"),
        "Token should be sanitized from error"
      );
      assert.ok(message.includes("***"), "Token should be replaced with ***");
    }
  });

  test("sanitizes credentials in stderr", async () => {
    const executor = new ShellCommandExecutor();

    try {
      await executor.exec(
        "node -e \"console.error('https://oauth2:glpat-xyz@gitlab.com'); process.exit(1)\"",
        "."
      );
      assert.fail("Should have thrown");
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? "";
      assert.ok(
        !stderr.includes("glpat-xyz"),
        "Token should be sanitized from stderr"
      );
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "credential sanitization"`
Expected: FAIL - error contains "secret"

**Step 3: Modify command-executor.ts**

Update imports at top of `src/command-executor.ts`:

```typescript
import { execSync } from "node:child_process";
import { sanitizeCredentials } from "./sanitize-utils.js";
```

Update error handling (~line 30-43):

```typescript
    } catch (error) {
      // Ensure stderr is always a string for consistent error handling
      const execError = error as {
        stderr?: Buffer | string;
        message?: string;
      };
      if (execError.stderr && typeof execError.stderr !== "string") {
        execError.stderr = execError.stderr.toString();
      }
      // Sanitize credentials from stderr before including in error
      if (execError.stderr) {
        execError.stderr = sanitizeCredentials(execError.stderr);
      }
      // Include sanitized stderr in error message for better debugging
      if (execError.stderr && execError.message) {
        execError.message = sanitizeCredentials(execError.message) + "\n" + execError.stderr;
      } else if (execError.message) {
        execError.message = sanitizeCredentials(execError.message);
      }
      throw error;
    }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern "credential sanitization"`
Expected: PASS

**Step 5: Run full command-executor test suite**

Run: `npm test -- --test-name-pattern "command"`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/command-executor.ts test/unit/command-executor.test.ts
git commit -m "feat: sanitize credentials in command executor error output"
```

---

### Task 4: Sanitize PR Strategy Error Logs

**Files:**

- Modify: `src/strategies/github-pr-strategy.ts:3` (imports)
- Modify: `src/strategies/github-pr-strategy.ts:89` (stderr logging)
- Modify: `src/strategies/gitlab-pr-strategy.ts` (similar changes)
- Modify: `src/strategies/azure-pr-strategy.ts` (similar changes)

**Step 1: Update github-pr-strategy.ts**

Add import at top:

```typescript
import { sanitizeCredentials } from "../sanitize-utils.js";
```

Update line 89:

```typescript
logger.info(
  `Debug: GitHub PR check failed - ${sanitizeCredentials(stderr).trim()}`
);
```

**Step 2: Update gitlab-pr-strategy.ts**

Add import at top:

```typescript
import { sanitizeCredentials } from "../sanitize-utils.js";
```

Update line 120:

```typescript
logger.info(
  `Debug: GitLab MR check failed - ${sanitizeCredentials(stderr).trim()}`
);
```

**Step 3: Update azure-pr-strategy.ts**

Add import at top:

```typescript
import { sanitizeCredentials } from "../sanitize-utils.js";
```

Update line 56:

```typescript
logger.info(
  `Debug: Azure PR check failed - ${sanitizeCredentials(stderr).trim()}`
);
```

**Step 4: Run lint to verify no issues**

Run: `./lint.sh`
Expected: PASS

**Step 5: Run unit tests**

Run: `npm test`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/strategies/github-pr-strategy.ts src/strategies/gitlab-pr-strategy.ts src/strategies/azure-pr-strategy.ts
git commit -m "feat: sanitize credentials in PR strategy error logs"
```

---

### Task 5: Add Integration Test for Sanitization

**Files:**

- Create: `test/unit/error-sanitization.integration.test.ts`

**Step 1: Write integration test**

Create `test/unit/error-sanitization.integration.test.ts`:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { ShellCommandExecutor } from "../../src/command-executor.js";
import { withRetry } from "../../src/retry-utils.js";
import { logger } from "../../src/logger.js";

/**
 * Integration tests verifying credentials don't leak through error paths.
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
      const errorStr = JSON.stringify(error);
      assert.ok(
        !errorStr.includes("SUPERSECRET123"),
        "Token must not appear anywhere in error object"
      );
      assert.ok(
        !errorStr.includes("ghp_"),
        "Token prefix must not appear in error object"
      );
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
```

**Step 2: Run the integration test**

Run: `npm test -- --test-name-pattern "error sanitization integration"`
Expected: PASS

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add test/unit/error-sanitization.integration.test.ts
git commit -m "test: add integration tests for credential sanitization"
```

---

### Task 6: Final Verification

**Step 1: Run lint**

Run: `./lint.sh`
Expected: PASS with no errors

**Step 2: Run all unit tests**

Run: `npm test`
Expected: All tests PASS

**Step 3: Build**

Run: `npm run build`
Expected: PASS with no TypeScript errors

**Step 4: Final commit (if any uncommitted changes)**

```bash
git status
# If clean, skip. Otherwise:
git add -A
git commit -m "chore: final cleanup for error sanitization"
```

---

## Summary

This plan adds credential sanitization at two key boundary points:

1. **command-executor.ts** - Sanitizes stderr and error messages from all shell commands
2. **retry-utils.ts** - Sanitizes messages before logging retry attempts

This ensures that even if git or other tools emit URLs with embedded credentials, they won't appear in logs or error output.

The implementation is:

- **Minimal** - Only touches logging/error paths, no changes to core logic
- **Centralized** - Single utility function, easy to extend patterns
- **Testable** - Each component has unit tests, plus integration test
- **Backwards compatible** - No API changes, existing behavior preserved
