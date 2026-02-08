# Security Settings Diff Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix security settings (`vulnerabilityAlerts`, `automatedSecurityFixes`, `privateVulnerabilityReporting`) to show as changes (`~`) instead of additions (`+`) in `xfg settings` output.

**Architecture:** Extend `getSettings()` to fetch 3 additional GitHub API endpoints for security settings, then merge results into `CurrentRepoSettings`. Update diff logic to use real field names instead of placeholder `_`-prefixed keys.

**Tech Stack:** TypeScript, Node.js test runner, GitHub REST API via `gh` CLI

**Design Doc:** `plans/2026-02-08-security-settings-diff-design.md`

---

## Task 1: Enhance MockExecutor to Support Error Simulation

**Files:**
- Modify: `test/unit/strategies/github-repo-settings-strategy.test.ts:9-34`

**Step 1: Add error simulation to MockExecutor**

Add `errors` map and update the mock to throw when pattern matches:

```typescript
class MockExecutor implements ICommandExecutor {
  commands: string[] = [];
  responses: Map<string, string> = new Map();
  errors: Map<string, string> = new Map();
  defaultResponse = "{}";

  async exec(command: string, _cwd: string): Promise<string> {
    this.commands.push(command);

    // Check for error responses first
    for (const [pattern, errorMessage] of this.errors) {
      if (command.includes(pattern)) {
        throw new Error(errorMessage);
      }
    }

    // Find matching response by endpoint pattern
    for (const [pattern, response] of this.responses) {
      if (command.includes(pattern)) {
        return response;
      }
    }
    return this.defaultResponse;
  }

  setResponse(pattern: string, response: string): void {
    this.responses.set(pattern, response);
  }

  setError(pattern: string, errorMessage: string): void {
    this.errors.set(pattern, errorMessage);
  }

  reset(): void {
    this.commands = [];
    this.responses.clear();
    this.errors.clear();
  }
}
```

**Step 2: Run existing tests to verify no regression**

Run: `npm test -- --test-name-pattern="GitHubRepoSettingsStrategy"`
Expected: All existing tests pass

**Step 3: Commit**

```bash
git add test/unit/strategies/github-repo-settings-strategy.test.ts
git commit -m "test: enhance MockExecutor to support error simulation"
```

---

## Task 2: Add Unit Tests for getVulnerabilityAlerts Helper

**Files:**
- Modify: `test/unit/strategies/github-repo-settings-strategy.test.ts` (add after line 70)

**Step 1: Write failing tests for getVulnerabilityAlerts**

Add new describe block after the existing `getSettings` describe:

```typescript
  describe("getSettings security endpoints", () => {
    test("should return vulnerability_alerts true when endpoint returns 204", async () => {
      mockExecutor.setResponse(
        "/repos/test-org/test-repo'",
        JSON.stringify({ has_issues: true })
      );
      mockExecutor.setResponse("vulnerability-alerts", "");
      mockExecutor.setResponse("automated-security-fixes", "");
      mockExecutor.setResponse(
        "private-vulnerability-reporting",
        JSON.stringify({ enabled: false })
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      const result = await strategy.getSettings(githubRepo);

      assert.equal(result.vulnerability_alerts, true);
    });

    test("should return vulnerability_alerts false when endpoint returns 404", async () => {
      mockExecutor.setResponse(
        "/repos/test-org/test-repo'",
        JSON.stringify({ has_issues: true })
      );
      mockExecutor.setError("vulnerability-alerts", "gh: Not Found (HTTP 404)");
      mockExecutor.setResponse("automated-security-fixes", "");
      mockExecutor.setResponse(
        "private-vulnerability-reporting",
        JSON.stringify({ enabled: false })
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      const result = await strategy.getSettings(githubRepo);

      assert.equal(result.vulnerability_alerts, false);
    });

    test("should throw on non-404 errors for vulnerability_alerts", async () => {
      mockExecutor.setResponse(
        "/repos/test-org/test-repo'",
        JSON.stringify({ has_issues: true })
      );
      mockExecutor.setError(
        "vulnerability-alerts",
        "gh: Server Error (HTTP 500)"
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);

      await assert.rejects(
        async () => strategy.getSettings(githubRepo),
        /HTTP 500/
      );
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="getSettings security endpoints"`
Expected: FAIL - `vulnerability_alerts` is undefined (method not implemented yet)

**Step 3: Commit failing tests**

```bash
git add test/unit/strategies/github-repo-settings-strategy.test.ts
git commit -m "test: add failing tests for vulnerability_alerts fetching"
```

---

## Task 3: Add Unit Tests for getAutomatedSecurityFixes Helper

**Files:**
- Modify: `test/unit/strategies/github-repo-settings-strategy.test.ts`

**Step 1: Add tests for automated_security_fixes**

Add to the `getSettings security endpoints` describe block:

```typescript
    test("should return automated_security_fixes true when endpoint returns 204", async () => {
      mockExecutor.setResponse(
        "/repos/test-org/test-repo'",
        JSON.stringify({ has_issues: true })
      );
      mockExecutor.setResponse("vulnerability-alerts", "");
      mockExecutor.setResponse("automated-security-fixes", "");
      mockExecutor.setResponse(
        "private-vulnerability-reporting",
        JSON.stringify({ enabled: false })
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      const result = await strategy.getSettings(githubRepo);

      assert.equal(result.automated_security_fixes, true);
    });

    test("should return automated_security_fixes false when endpoint returns 404", async () => {
      mockExecutor.setResponse(
        "/repos/test-org/test-repo'",
        JSON.stringify({ has_issues: true })
      );
      mockExecutor.setResponse("vulnerability-alerts", "");
      mockExecutor.setError(
        "automated-security-fixes",
        "gh: Not Found (HTTP 404)"
      );
      mockExecutor.setResponse(
        "private-vulnerability-reporting",
        JSON.stringify({ enabled: false })
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      const result = await strategy.getSettings(githubRepo);

      assert.equal(result.automated_security_fixes, false);
    });

    test("should throw on non-404 errors for automated_security_fixes", async () => {
      mockExecutor.setResponse(
        "/repos/test-org/test-repo'",
        JSON.stringify({ has_issues: true })
      );
      mockExecutor.setResponse("vulnerability-alerts", "");
      mockExecutor.setError(
        "automated-security-fixes",
        "gh: Unauthorized (HTTP 401)"
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);

      await assert.rejects(
        async () => strategy.getSettings(githubRepo),
        /HTTP 401/
      );
    });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="automated_security_fixes"`
Expected: FAIL

**Step 3: Commit**

```bash
git add test/unit/strategies/github-repo-settings-strategy.test.ts
git commit -m "test: add failing tests for automated_security_fixes fetching"
```

---

## Task 4: Add Unit Tests for getPrivateVulnerabilityReporting Helper

**Files:**
- Modify: `test/unit/strategies/github-repo-settings-strategy.test.ts`

**Step 1: Add tests for private_vulnerability_reporting**

Add to the `getSettings security endpoints` describe block:

```typescript
    test("should return private_vulnerability_reporting true when enabled", async () => {
      mockExecutor.setResponse(
        "/repos/test-org/test-repo'",
        JSON.stringify({ has_issues: true })
      );
      mockExecutor.setResponse("vulnerability-alerts", "");
      mockExecutor.setResponse("automated-security-fixes", "");
      mockExecutor.setResponse(
        "private-vulnerability-reporting",
        JSON.stringify({ enabled: true })
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      const result = await strategy.getSettings(githubRepo);

      assert.equal(result.private_vulnerability_reporting, true);
    });

    test("should return private_vulnerability_reporting false when disabled", async () => {
      mockExecutor.setResponse(
        "/repos/test-org/test-repo'",
        JSON.stringify({ has_issues: true })
      );
      mockExecutor.setResponse("vulnerability-alerts", "");
      mockExecutor.setResponse("automated-security-fixes", "");
      mockExecutor.setResponse(
        "private-vulnerability-reporting",
        JSON.stringify({ enabled: false })
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      const result = await strategy.getSettings(githubRepo);

      assert.equal(result.private_vulnerability_reporting, false);
    });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="private_vulnerability_reporting"`
Expected: FAIL

**Step 3: Commit**

```bash
git add test/unit/strategies/github-repo-settings-strategy.test.ts
git commit -m "test: add failing tests for private_vulnerability_reporting fetching"
```

---

## Task 5: Update CurrentRepoSettings Interface

**Files:**
- Modify: `src/strategies/repo-settings-strategy.ts:12-38`

**Step 1: Add security fields to interface**

Add after line 37 (after `security_and_analysis`):

```typescript
  // Security settings (fetched from separate endpoints)
  vulnerability_alerts?: boolean;
  automated_security_fixes?: boolean;
  private_vulnerability_reporting?: boolean;
```

**Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: Success

**Step 3: Commit**

```bash
git add src/strategies/repo-settings-strategy.ts
git commit -m "feat: add security fields to CurrentRepoSettings interface"
```

---

## Task 6: Implement Security Settings Helpers

**Files:**
- Modify: `src/strategies/github-repo-settings-strategy.ts`

**Step 1: Add helper methods before validateGitHub**

Add after line 150 (before `private validateGitHub`):

```typescript
  private async getVulnerabilityAlerts(
    github: GitHubRepoInfo,
    options?: RepoSettingsStrategyOptions
  ): Promise<boolean> {
    const endpoint = `/repos/${github.owner}/${github.repo}/vulnerability-alerts`;
    try {
      await this.ghApi("GET", endpoint, undefined, options);
      return true; // 204 = enabled
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("HTTP 404")) {
        return false; // 404 = disabled
      }
      throw error; // Re-throw other errors
    }
  }

  private async getAutomatedSecurityFixes(
    github: GitHubRepoInfo,
    options?: RepoSettingsStrategyOptions
  ): Promise<boolean> {
    const endpoint = `/repos/${github.owner}/${github.repo}/automated-security-fixes`;
    try {
      await this.ghApi("GET", endpoint, undefined, options);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("HTTP 404")) {
        return false;
      }
      throw error;
    }
  }

  private async getPrivateVulnerabilityReporting(
    github: GitHubRepoInfo,
    options?: RepoSettingsStrategyOptions
  ): Promise<boolean> {
    const endpoint = `/repos/${github.owner}/${github.repo}/private-vulnerability-reporting`;
    const result = await this.ghApi("GET", endpoint, undefined, options);
    const data = JSON.parse(result);
    return data.enabled === true;
  }
```

**Step 2: Update getSettings to call helpers**

Replace lines 93-104:

```typescript
  async getSettings(
    repoInfo: RepoInfo,
    options?: RepoSettingsStrategyOptions
  ): Promise<CurrentRepoSettings> {
    this.validateGitHub(repoInfo);
    const github = repoInfo as GitHubRepoInfo;

    const endpoint = `/repos/${github.owner}/${github.repo}`;
    const result = await this.ghApi("GET", endpoint, undefined, options);
    const settings = JSON.parse(result) as CurrentRepoSettings;

    // Fetch security settings from separate endpoints
    settings.vulnerability_alerts = await this.getVulnerabilityAlerts(
      github,
      options
    );
    settings.automated_security_fixes = await this.getAutomatedSecurityFixes(
      github,
      options
    );
    settings.private_vulnerability_reporting =
      await this.getPrivateVulnerabilityReporting(github, options);

    return settings;
  }
```

**Step 3: Build to verify no errors**

Run: `npm run build`
Expected: Success

**Step 4: Run unit tests**

Run: `npm test -- --test-name-pattern="getSettings security endpoints"`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/strategies/github-repo-settings-strategy.ts
git commit -m "feat: fetch security settings from separate GitHub endpoints"
```

---

## Task 7: Update PROPERTY_MAPPING in Diff Logic

**Files:**
- Modify: `src/repo-settings-diff.ts:37-41`

**Step 1: Update mapping to use real field names**

Change lines 37-41 from:

```typescript
  vulnerabilityAlerts: "_vulnerability_alerts",
  automatedSecurityFixes: "_automated_security_fixes",
  secretScanning: "_secret_scanning",
  secretScanningPushProtection: "_secret_scanning_push_protection",
  privateVulnerabilityReporting: "_private_vulnerability_reporting",
```

To:

```typescript
  vulnerabilityAlerts: "vulnerability_alerts",
  automatedSecurityFixes: "automated_security_fixes",
  secretScanning: "_secret_scanning",
  secretScanningPushProtection: "_secret_scanning_push_protection",
  privateVulnerabilityReporting: "private_vulnerability_reporting",
```

Note: `secretScanning` and `secretScanningPushProtection` keep their `_` prefix because they're handled separately via `security_and_analysis`.

**Step 2: Build and run tests**

Run: `npm run build && npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/repo-settings-diff.ts
git commit -m "fix: use real field names for security settings in diff"
```

---

## Task 8: Add Unit Test for Diff Logic

**Files:**
- Modify: `test/unit/repo-settings-diff.test.ts` (or create if doesn't exist)

**Step 1: Check if diff test file exists**

Run: `ls test/unit/repo-settings-diff.test.ts 2>/dev/null || echo "not found"`

**Step 2: Add/update test for security settings diff**

If file exists, add test. If not, create file with:

```typescript
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { diffRepoSettings } from "../../src/repo-settings-diff.js";

describe("diffRepoSettings", () => {
  test("should show security settings as changes when values differ", () => {
    const current = {
      vulnerability_alerts: true,
      automated_security_fixes: false,
      private_vulnerability_reporting: false,
    };

    const desired = {
      vulnerabilityAlerts: false,
      automatedSecurityFixes: true,
      privateVulnerabilityReporting: true,
    };

    const changes = diffRepoSettings(current, desired);

    const vulnChange = changes.find((c) => c.property === "vulnerabilityAlerts");
    const autoChange = changes.find(
      (c) => c.property === "automatedSecurityFixes"
    );
    const pvrChange = changes.find(
      (c) => c.property === "privateVulnerabilityReporting"
    );

    assert.equal(vulnChange?.action, "change");
    assert.equal(vulnChange?.oldValue, true);
    assert.equal(vulnChange?.newValue, false);

    assert.equal(autoChange?.action, "change");
    assert.equal(autoChange?.oldValue, false);
    assert.equal(autoChange?.newValue, true);

    assert.equal(pvrChange?.action, "change");
    assert.equal(pvrChange?.oldValue, false);
    assert.equal(pvrChange?.newValue, true);
  });

  test("should not include unchanged security settings", () => {
    const current = {
      vulnerability_alerts: true,
      automated_security_fixes: true,
      private_vulnerability_reporting: true,
    };

    const desired = {
      vulnerabilityAlerts: true,
      automatedSecurityFixes: true,
      privateVulnerabilityReporting: true,
    };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 0);
  });
});
```

**Step 3: Run test**

Run: `npm test -- --test-name-pattern="diffRepoSettings"`
Expected: Pass

**Step 4: Commit**

```bash
git add test/unit/repo-settings-diff.test.ts
git commit -m "test: add unit tests for security settings diff"
```

---

## Task 9: Update Integration Test Config

**Files:**
- Modify: `test/integration/github-repo-settings.test.ts:54-69`

**Step 1: Add security settings to config**

Update the config in `createConfigFile()`:

```typescript
function createConfigFile(): void {
  const config = `# yaml-language-server: $schema=https://raw.githubusercontent.com/anthony-spruyt/xfg/main/config-schema.json
# Integration test config for xfg repo settings
id: integration-test-repo-settings

settings:
  repo:
    hasWiki: false
    hasProjects: false
    allowSquashMerge: true
    allowMergeCommit: false
    allowRebaseMerge: false
    deleteBranchOnMerge: true
    vulnerabilityAlerts: true
    automatedSecurityFixes: false
    privateVulnerabilityReporting: true

repos:
  - git: https://github.com/${TEST_REPO}.git
`;
  writeFileSync(configPath, config);
  console.log(`  Created config file: ${configPath}`);
}
```

**Step 2: Commit**

```bash
git add test/integration/github-repo-settings.test.ts
git commit -m "test: add security settings to integration test config"
```

---

## Task 10: Add Integration Test Helpers for Security Settings

**Files:**
- Modify: `test/integration/github-repo-settings.test.ts`

**Step 1: Add helper functions after resetRepoSettings**

Note: The integration tests use a synchronous `exec` helper that wraps `execSync`. This is acceptable for test code where simplicity matters more than injection prevention, and inputs are hardcoded constants.

```typescript
/**
 * Get current security settings from GitHub API.
 */
function getSecuritySettings(): {
  vulnerabilityAlerts: boolean;
  automatedSecurityFixes: boolean;
  privateVulnerabilityReporting: boolean;
} {
  // Check vulnerability alerts (204 = enabled, 404 = disabled)
  let vulnerabilityAlerts = false;
  try {
    exec(`gh api repos/${TEST_REPO}/vulnerability-alerts`);
    vulnerabilityAlerts = true;
  } catch {
    vulnerabilityAlerts = false;
  }

  // Check automated security fixes (204 = enabled, 404 = disabled)
  let automatedSecurityFixes = false;
  try {
    exec(`gh api repos/${TEST_REPO}/automated-security-fixes`);
    automatedSecurityFixes = true;
  } catch {
    automatedSecurityFixes = false;
  }

  // Check private vulnerability reporting (JSON response)
  const pvrResult = exec(
    `gh api repos/${TEST_REPO}/private-vulnerability-reporting`
  );
  const pvrData = JSON.parse(pvrResult);
  const privateVulnerabilityReporting = pvrData.enabled === true;

  return {
    vulnerabilityAlerts,
    automatedSecurityFixes,
    privateVulnerabilityReporting,
  };
}

/**
 * Reset security settings to known state (all disabled).
 */
function resetSecuritySettings(): void {
  console.log("  Resetting security settings...");
  try {
    exec(`gh api -X DELETE repos/${TEST_REPO}/vulnerability-alerts`);
  } catch {
    // Already disabled
  }
  try {
    exec(`gh api -X DELETE repos/${TEST_REPO}/automated-security-fixes`);
  } catch {
    // Already disabled
  }
  try {
    exec(
      `gh api -X DELETE repos/${TEST_REPO}/private-vulnerability-reporting`
    );
  } catch {
    // Already disabled
  }
  console.log("  Security settings reset");
}
```

**Step 2: Update resetTestRepo to call resetSecuritySettings**

```typescript
async function resetTestRepo(): Promise<void> {
  console.log("\n=== Resetting repo settings test repo ===\n");
  resetRepoSettings();
  resetSecuritySettings();
  createConfigFile();
  console.log("\n=== Reset complete ===\n");
}
```

**Step 3: Commit**

```bash
git add test/integration/github-repo-settings.test.ts
git commit -m "test: add security settings helpers to integration tests"
```

---

## Task 11: Add Integration Test Assertions for Security Settings

**Files:**
- Modify: `test/integration/github-repo-settings.test.ts`

**Step 1: Update "settings applies" test to verify security settings**

Add after line 166 (after existing assertions):

```typescript
    // Verify security settings
    const securitySettings = getSecuritySettings();
    assert.equal(
      securitySettings.vulnerabilityAlerts,
      true,
      "vulnerabilityAlerts should be true"
    );
    assert.equal(
      securitySettings.automatedSecurityFixes,
      false,
      "automatedSecurityFixes should be false"
    );
    assert.equal(
      securitySettings.privateVulnerabilityReporting,
      true,
      "privateVulnerabilityReporting should be true"
    );
```

**Step 2: Commit**

```bash
git add test/integration/github-repo-settings.test.ts
git commit -m "test: add security settings assertions to integration tests"
```

---

## Task 12: Run Full Test Suite and Lint

**Files:** None (verification only)

**Step 1: Run linter**

Run: `./lint.sh`
Expected: Pass

**Step 2: Run unit tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Build**

Run: `npm run build`
Expected: Success

**Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: address lint issues" # only if needed
```

---

## Task 13: Create Pull Request

**Files:** None

**Step 1: Push branch**

Run: `git push -u origin fix/421-security-settings-diff`

**Step 2: Create PR**

```bash
gh pr create --title "fix(settings): fetch current state of security settings for accurate diff" --body "$(cat <<'EOF'
## Summary

- Fetches security settings from separate GitHub API endpoints in `getSettings()`
- Updates diff logic to show security settings as changes (`~`) instead of additions (`+`)

Fixes #421

## Changes

- Add 3 private helper methods to `GitHubRepoSettingsStrategy`:
  - `getVulnerabilityAlerts()` - 204 = true, 404 = false
  - `getAutomatedSecurityFixes()` - 204 = true, 404 = false
  - `getPrivateVulnerabilityReporting()` - parses JSON `enabled` field
- Extend `CurrentRepoSettings` interface with security fields
- Update `PROPERTY_MAPPING` in diff logic to use real field names
- Add unit tests for all new functionality
- Add security settings to integration tests

## Test plan

- [x] Unit tests for helper methods (204/404/error cases)
- [x] Unit tests for diff logic showing changes vs additions
- [x] Integration tests verify security settings are applied
- [ ] Manual verification: `xfg settings --dry-run` shows `~` for security settings

EOF
)"
```

**Step 3: Enable automerge**

Run: `gh pr merge --auto --squash --delete-branch`

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Enhance MockExecutor | test file |
| 2-4 | Add failing unit tests | test file |
| 5 | Update interface | repo-settings-strategy.ts |
| 6 | Implement helpers | github-repo-settings-strategy.ts |
| 7 | Update diff mapping | repo-settings-diff.ts |
| 8 | Add diff unit tests | repo-settings-diff.test.ts |
| 9-11 | Update integration tests | integration test file |
| 12 | Verify & lint | none |
| 13 | Create PR | none |
