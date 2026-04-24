import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import {
  diffRepoSettings,
  hasRepoSettingsChanges,
} from "../../../../src/settings/repo-settings/diff.js";
import type { GitHubRepoSettings } from "../../../../src/config/index.js";
import type { CurrentRepoSettings } from "../../../../src/settings/repo-settings/types.js";

describe("diffRepoSettings", () => {
  test("should detect changed boolean property", () => {
    const current: CurrentRepoSettings = { has_wiki: true };
    const desired: GitHubRepoSettings = { hasWiki: false };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      property: "hasWiki",
      action: "update",
      oldValue: true,
      newValue: false,
    });
  });

  test("should detect added property", () => {
    const current: CurrentRepoSettings = {};
    const desired: GitHubRepoSettings = { allowAutoMerge: true };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      property: "allowAutoMerge",
      action: "create",
      newValue: true,
    });
  });

  test("should return empty array for no changes", () => {
    const current: CurrentRepoSettings = { has_wiki: true };
    const desired: GitHubRepoSettings = { hasWiki: true };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 0);
  });

  test("should detect multiple changes", () => {
    const current: CurrentRepoSettings = {
      has_issues: true,
      has_wiki: true,
      allow_squash_merge: false,
    };
    const desired: GitHubRepoSettings = {
      hasIssues: false,
      hasWiki: true,
      allowSquashMerge: true,
      allowAutoMerge: true,
    };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 3);
    assert.ok(
      changes.some((c) => c.property === "hasIssues" && c.action === "update")
    );
    assert.ok(
      changes.some(
        (c) => c.property === "allowSquashMerge" && c.action === "update"
      )
    );
    assert.ok(
      changes.some(
        (c) => c.property === "allowAutoMerge" && c.action === "create"
      )
    );
  });

  test("should handle secret scanning settings", () => {
    const current: CurrentRepoSettings = {
      security_and_analysis: {
        secret_scanning: { status: "enabled" },
        secret_scanning_push_protection: { status: "disabled" },
      },
    };
    const desired: GitHubRepoSettings = {
      secretScanning: false,
      secretScanningPushProtection: true,
    };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 2);
    assert.ok(
      changes.some(
        (c) =>
          c.property === "secretScanning" &&
          c.action === "update" &&
          c.oldValue === true &&
          c.newValue === false
      )
    );
    assert.ok(
      changes.some(
        (c) =>
          c.property === "secretScanningPushProtection" &&
          c.action === "update" &&
          c.oldValue === false &&
          c.newValue === true
      )
    );
  });

  test("should detect changed webCommitSignoffRequired", () => {
    const current: CurrentRepoSettings = { web_commit_signoff_required: false };
    const desired: GitHubRepoSettings = { webCommitSignoffRequired: true };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      property: "webCommitSignoffRequired",
      action: "update",
      oldValue: false,
      newValue: true,
    });
  });

  test("should detect changed defaultBranch", () => {
    const current: CurrentRepoSettings = { default_branch: "main" };
    const desired: GitHubRepoSettings = { defaultBranch: "develop" };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      property: "defaultBranch",
      action: "update",
      oldValue: "main",
      newValue: "develop",
    });
  });

  test("should detect changed description", () => {
    const current: CurrentRepoSettings = { description: "Old description" };
    const desired: GitHubRepoSettings = {
      description: "New description",
    };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      property: "description",
      action: "update",
      oldValue: "Old description",
      newValue: "New description",
    });
  });

  test("should detect added description", () => {
    const current: CurrentRepoSettings = {};
    const desired: GitHubRepoSettings = {
      description: "My repo description",
    };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      property: "description",
      action: "create",
      newValue: "My repo description",
    });
  });

  test("should not report unchanged description", () => {
    const current: CurrentRepoSettings = { description: "Same description" };
    const desired: GitHubRepoSettings = { description: "Same description" };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 0);
  });

  test("should ignore undefined desired values", () => {
    const current: CurrentRepoSettings = { has_wiki: true };
    const desired: GitHubRepoSettings = { hasWiki: undefined };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 0);
  });

  test("should show security settings as changes when values differ", () => {
    const current: CurrentRepoSettings = {
      vulnerability_alerts: true,
      automated_security_fixes: false,
      private_vulnerability_reporting: false,
    };

    const desired: GitHubRepoSettings = {
      vulnerabilityAlerts: false,
      automatedSecurityFixes: true,
      privateVulnerabilityReporting: true,
    };

    const changes = diffRepoSettings(current, desired);

    const vulnChange = changes.find(
      (c) => c.property === "vulnerabilityAlerts"
    );
    const autoChange = changes.find(
      (c) => c.property === "automatedSecurityFixes"
    );
    const pvrChange = changes.find(
      (c) => c.property === "privateVulnerabilityReporting"
    );

    assert.equal(vulnChange?.action, "update");
    assert.equal(vulnChange?.oldValue, true);
    assert.equal(vulnChange?.newValue, false);

    assert.equal(autoChange?.action, "update");
    assert.equal(autoChange?.oldValue, false);
    assert.equal(autoChange?.newValue, true);

    assert.equal(pvrChange?.action, "update");
    assert.equal(pvrChange?.oldValue, false);
    assert.equal(pvrChange?.newValue, true);
  });

  test("should not include unchanged security settings", () => {
    const current: CurrentRepoSettings = {
      vulnerability_alerts: true,
      automated_security_fixes: true,
      private_vulnerability_reporting: true,
    };

    const desired: GitHubRepoSettings = {
      vulnerabilityAlerts: true,
      automatedSecurityFixes: true,
      privateVulnerabilityReporting: true,
    };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 0);
  });
});

describe("hasRepoSettingsChanges", () => {
  test("should return true when there are changes", () => {
    const changes = [
      {
        property: "hasWiki" as const,
        action: "update" as const,
        oldValue: true,
        newValue: false,
      },
    ];
    assert.equal(hasRepoSettingsChanges(changes), true);
  });

  test("should return true for add actions", () => {
    const changes = [
      {
        property: "hasWiki" as const,
        action: "create" as const,
        newValue: true,
      },
    ];
    assert.equal(hasRepoSettingsChanges(changes), true);
  });

  test("should return false for empty array", () => {
    assert.equal(hasRepoSettingsChanges([]), false);
  });

  test("should return true for non-empty changes array", () => {
    const changes = [
      {
        property: "hasWiki" as const,
        action: "update" as const,
        oldValue: false,
        newValue: true,
      },
    ];
    assert.equal(hasRepoSettingsChanges(changes), true);
  });
});
