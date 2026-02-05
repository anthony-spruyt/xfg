import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { diffRepoSettings, hasChanges } from "../../src/repo-settings-diff.js";
import type { GitHubRepoSettings } from "../../src/config.js";
import type { CurrentRepoSettings } from "../../src/strategies/repo-settings-strategy.js";

describe("diffRepoSettings", () => {
  test("should detect changed boolean property", () => {
    const current: CurrentRepoSettings = { has_wiki: true };
    const desired: GitHubRepoSettings = { hasWiki: false };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      property: "hasWiki",
      action: "change",
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
      action: "add",
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
      changes.some((c) => c.property === "hasIssues" && c.action === "change")
    );
    assert.ok(
      changes.some(
        (c) => c.property === "allowSquashMerge" && c.action === "change"
      )
    );
    assert.ok(
      changes.some((c) => c.property === "allowAutoMerge" && c.action === "add")
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
          c.action === "change" &&
          c.oldValue === true &&
          c.newValue === false
      )
    );
    assert.ok(
      changes.some(
        (c) =>
          c.property === "secretScanningPushProtection" &&
          c.action === "change" &&
          c.oldValue === false &&
          c.newValue === true
      )
    );
  });

  test("should ignore undefined desired values", () => {
    const current: CurrentRepoSettings = { has_wiki: true };
    const desired: GitHubRepoSettings = { hasWiki: undefined };

    const changes = diffRepoSettings(current, desired);

    assert.equal(changes.length, 0);
  });
});

describe("hasChanges", () => {
  test("should return true when there are changes", () => {
    const changes = [
      {
        property: "hasWiki" as const,
        action: "change" as const,
        oldValue: true,
        newValue: false,
      },
    ];
    assert.equal(hasChanges(changes), true);
  });

  test("should return true for add actions", () => {
    const changes = [
      { property: "hasWiki" as const, action: "add" as const, newValue: true },
    ];
    assert.equal(hasChanges(changes), true);
  });

  test("should return false for empty array", () => {
    assert.equal(hasChanges([]), false);
  });

  test("should return false for only unchanged", () => {
    const changes = [
      { property: "hasWiki" as const, action: "unchanged" as const },
    ];
    assert.equal(hasChanges(changes), false);
  });
});
