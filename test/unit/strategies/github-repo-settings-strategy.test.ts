import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { GitHubRepoSettingsStrategy } from "../../../src/strategies/github-repo-settings-strategy.js";
import type { GitHubRepoInfo } from "../../../src/repo-detector.js";
import type { ICommandExecutor } from "../../../src/command-executor.js";

// Mock executor that records commands and returns configured responses
// Note: This follows the existing test pattern from github-ruleset-strategy.test.ts
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

const githubRepo: GitHubRepoInfo = {
  type: "github",
  gitUrl: "https://github.com/test-org/test-repo.git",
  host: "github.com",
  owner: "test-org",
  repo: "test-repo",
};

describe("GitHubRepoSettingsStrategy", () => {
  let mockExecutor: MockExecutor;

  beforeEach(() => {
    mockExecutor = new MockExecutor();
  });

  describe("getSettings", () => {
    test("should fetch repository settings", async () => {
      mockExecutor.setResponse(
        "/repos/test-org/test-repo'",
        JSON.stringify({
          has_issues: true,
          has_wiki: false,
          allow_squash_merge: true,
        })
      );
      mockExecutor.setResponse("vulnerability-alerts", "");
      mockExecutor.setResponse("automated-security-fixes", "");
      mockExecutor.setResponse(
        "private-vulnerability-reporting",
        JSON.stringify({ enabled: false })
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      const result = await strategy.getSettings(githubRepo);

      // 4 commands: base settings + 3 security endpoints
      assert.equal(mockExecutor.commands.length, 4);
      assert.ok(mockExecutor.commands[0].includes("gh api"));
      assert.ok(mockExecutor.commands[0].includes("/repos/test-org/test-repo"));
      assert.equal(result.has_issues, true);
      assert.equal(result.has_wiki, false);
    });
  });

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

    test("should return automated_security_fixes false when vulnerability_alerts is disabled", async () => {
      mockExecutor.setResponse(
        "/repos/test-org/test-repo'",
        JSON.stringify({ has_issues: true })
      );
      // vulnerability-alerts returns 404 (disabled)
      mockExecutor.setError("vulnerability-alerts", "gh: Not Found (HTTP 404)");
      // automated-security-fixes endpoint would return 204, but should be ignored
      mockExecutor.setResponse("automated-security-fixes", "");
      mockExecutor.setResponse(
        "private-vulnerability-reporting",
        JSON.stringify({ enabled: false })
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      const result = await strategy.getSettings(githubRepo);

      // Should return false because vulnerability_alerts is disabled
      assert.equal(result.automated_security_fixes, false);
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
  });

  describe("updateSettings", () => {
    test("should update repository settings via PATCH", async () => {
      mockExecutor.setResponse("/repos/test-org/test-repo", "{}");

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      await strategy.updateSettings(githubRepo, {
        hasIssues: false,
        allowSquashMerge: true,
      });

      assert.equal(mockExecutor.commands.length, 1);
      assert.ok(mockExecutor.commands[0].includes("-X PATCH"));
      assert.ok(mockExecutor.commands[0].includes("has_issues"));
    });

    test("should include web_commit_signoff_required in payload", async () => {
      mockExecutor.setResponse("/repos/test-org/test-repo", "{}");

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      await strategy.updateSettings(githubRepo, {
        webCommitSignoffRequired: true,
      });

      assert.equal(mockExecutor.commands.length, 1);
      assert.ok(mockExecutor.commands[0].includes("-X PATCH"));
      assert.ok(
        mockExecutor.commands[0].includes("web_commit_signoff_required")
      );
    });

    test("should include default_branch in payload", async () => {
      mockExecutor.setResponse("/repos/test-org/test-repo", "{}");

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      await strategy.updateSettings(githubRepo, {
        defaultBranch: "develop",
      });

      assert.equal(mockExecutor.commands.length, 1);
      assert.ok(mockExecutor.commands[0].includes("-X PATCH"));
      assert.ok(mockExecutor.commands[0].includes("default_branch"));
    });

    test("should skip update when no settings provided", async () => {
      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      await strategy.updateSettings(githubRepo, {});

      assert.equal(mockExecutor.commands.length, 0);
    });
  });

  describe("setVulnerabilityAlerts", () => {
    test("should enable vulnerability alerts via PUT", async () => {
      mockExecutor.setResponse("vulnerability-alerts", "");

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      await strategy.setVulnerabilityAlerts(githubRepo, true);

      assert.equal(mockExecutor.commands.length, 1);
      assert.ok(mockExecutor.commands[0].includes("-X PUT"));
      assert.ok(mockExecutor.commands[0].includes("vulnerability-alerts"));
    });

    test("should disable vulnerability alerts via DELETE", async () => {
      mockExecutor.setResponse("vulnerability-alerts", "");

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      await strategy.setVulnerabilityAlerts(githubRepo, false);

      assert.equal(mockExecutor.commands.length, 1);
      assert.ok(mockExecutor.commands[0].includes("-X DELETE"));
      assert.ok(mockExecutor.commands[0].includes("vulnerability-alerts"));
    });
  });

  describe("setAutomatedSecurityFixes", () => {
    test("should enable automated security fixes via PUT", async () => {
      mockExecutor.setResponse("automated-security-fixes", "");

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      await strategy.setAutomatedSecurityFixes(githubRepo, true);

      assert.equal(mockExecutor.commands.length, 1);
      assert.ok(mockExecutor.commands[0].includes("-X PUT"));
      assert.ok(mockExecutor.commands[0].includes("automated-security-fixes"));
    });

    test("should disable automated security fixes via DELETE", async () => {
      mockExecutor.setResponse("automated-security-fixes", "");

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      await strategy.setAutomatedSecurityFixes(githubRepo, false);

      assert.equal(mockExecutor.commands.length, 1);
      assert.ok(mockExecutor.commands[0].includes("-X DELETE"));
      assert.ok(mockExecutor.commands[0].includes("automated-security-fixes"));
    });
  });

  describe("validation", () => {
    test("should throw for non-GitHub repos", async () => {
      const azureRepo = {
        type: "azure-devops" as const,
        gitUrl: "https://dev.azure.com/org/project/_git/repo",
        owner: "org",
        repo: "repo",
        organization: "org",
        project: "project",
      };

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);

      await assert.rejects(
        async () => strategy.getSettings(azureRepo),
        /GitHub Repo Settings strategy requires GitHub repositories/
      );
    });
  });

  describe("GitHub Enterprise", () => {
    test("should use hostname flag for GHE", async () => {
      const gheRepo: GitHubRepoInfo = {
        type: "github",
        gitUrl: "https://github.example.com/test-org/test-repo.git",
        host: "github.example.com",
        owner: "test-org",
        repo: "test-repo",
      };

      mockExecutor.setResponse(
        "/repos/test-org/test-repo",
        JSON.stringify({ has_issues: true })
      );

      const strategy = new GitHubRepoSettingsStrategy(mockExecutor);
      await strategy.getSettings(gheRepo, { host: "github.example.com" });

      assert.ok(mockExecutor.commands[0].includes("--hostname"));
      assert.ok(mockExecutor.commands[0].includes("github.example.com"));
    });
  });
});
