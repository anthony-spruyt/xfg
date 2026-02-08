import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { exec, projectRoot } from "./test-helpers.js";

// Test constants - repo is pre-created and persistent (never deleted)
const TEST_REPO = "anthony-spruyt/xfg-test-7";

// Dynamic config file path (created during test)
const configPath = join(
  projectRoot,
  "test",
  "fixtures",
  "integration-test-config-repo-settings.yaml"
);

// GitHub default repo settings — used to reset between tests
const GITHUB_DEFAULTS = {
  has_wiki: true,
  has_projects: true,
  allow_squash_merge: true,
  allow_merge_commit: true,
  allow_rebase_merge: true,
  delete_branch_on_merge: false,
};

/**
 * Reset repo settings to GitHub defaults via PATCH API.
 * Repo is pre-created and persistent — never deleted or recreated.
 */
function resetRepoSettings(): void {
  console.log("  Resetting repo settings to defaults...");
  const fields = Object.entries(GITHUB_DEFAULTS)
    .map(([k, v]) => `-F ${k}=${v}`)
    .join(" ");
  exec(`gh api --method PATCH repos/${TEST_REPO} ${fields}`);
  console.log("  Settings reset to defaults");
}

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
 * Order matters: automated-security-fixes requires vulnerability-alerts to be enabled first.
 */
function resetSecuritySettings(): void {
  console.log("  Resetting security settings...");
  // 1. Enable vulnerability alerts first (required to configure automated-security-fixes)
  try {
    exec(`gh api -X PUT repos/${TEST_REPO}/vulnerability-alerts`);
  } catch {
    // Already enabled
  }
  // 2. Disable automated security fixes (now possible since vuln alerts are enabled)
  try {
    exec(`gh api -X DELETE repos/${TEST_REPO}/automated-security-fixes`);
  } catch {
    // Already disabled
  }
  // 3. Disable vulnerability alerts
  try {
    exec(`gh api -X DELETE repos/${TEST_REPO}/vulnerability-alerts`);
  } catch {
    // Already disabled
  }
  // 4. Disable private vulnerability reporting
  try {
    exec(`gh api -X DELETE repos/${TEST_REPO}/private-vulnerability-reporting`);
  } catch {
    // Already disabled
  }
  console.log("  Security settings reset");
}

/**
 * Get current repo settings from GitHub API.
 * Note: Uses hardcoded TEST_REPO constant, not user input.
 */
function getRepoSettings(): Record<string, unknown> {
  const result = exec(`gh api repos/${TEST_REPO}`);
  return JSON.parse(result);
}

/**
 * Create the test config file.
 */
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

async function resetTestRepo(): Promise<void> {
  console.log("\n=== Resetting repo settings test repo ===\n");
  resetRepoSettings();
  resetSecuritySettings();
  createConfigFile();
  console.log("\n=== Reset complete ===\n");
}

describe("GitHub Repo Settings Integration Test", () => {
  beforeEach(async () => {
    await resetTestRepo();
  });

  test("settings dry-run shows planned repo settings changes", async () => {
    // Get current settings before
    console.log("Getting current repo settings...");
    const settingsBefore = getRepoSettings();
    console.log(`  has_wiki: ${settingsBefore.has_wiki}`);
    console.log(`  has_projects: ${settingsBefore.has_projects}`);
    console.log(`  allow_squash_merge: ${settingsBefore.allow_squash_merge}`);

    // Run settings with dry-run
    console.log("\nRunning xfg settings --dry-run...");
    const output = exec(
      `node dist/cli.js settings --config ${configPath} --dry-run`,
      { cwd: projectRoot }
    );
    console.log(output);

    // Verify output indicates dry-run
    assert.ok(
      output.includes("DRY RUN") || output.includes("dry-run"),
      "Output should indicate dry-run mode"
    );

    // Verify settings were NOT changed
    console.log("\nVerifying settings were not changed...");
    const settingsAfter = getRepoSettings();
    assert.equal(
      settingsAfter.has_wiki,
      settingsBefore.has_wiki,
      "has_wiki should not change in dry-run"
    );

    console.log("\n=== Dry-run test passed ===\n");
  });

  test("settings applies repo settings changes", async () => {
    // Get current settings before
    console.log("Getting current repo settings before apply...");
    const settingsBefore = getRepoSettings();
    console.log(`  has_wiki: ${settingsBefore.has_wiki}`);
    console.log(`  allow_merge_commit: ${settingsBefore.allow_merge_commit}`);
    console.log(
      `  delete_branch_on_merge: ${settingsBefore.delete_branch_on_merge}`
    );

    // Run settings (apply)
    console.log("\nRunning xfg settings (apply)...");
    const output = exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify settings were applied
    console.log("\nVerifying settings were applied...");
    const settingsAfter = getRepoSettings();

    assert.equal(settingsAfter.has_wiki, false, "has_wiki should be false");
    assert.equal(
      settingsAfter.has_projects,
      false,
      "has_projects should be false"
    );
    assert.equal(
      settingsAfter.allow_squash_merge,
      true,
      "allow_squash_merge should be true"
    );
    assert.equal(
      settingsAfter.allow_merge_commit,
      false,
      "allow_merge_commit should be false"
    );
    assert.equal(
      settingsAfter.allow_rebase_merge,
      false,
      "allow_rebase_merge should be false"
    );
    assert.equal(
      settingsAfter.delete_branch_on_merge,
      true,
      "delete_branch_on_merge should be true"
    );

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

    console.log("  All settings verified!");
    console.log("\n=== Apply test passed ===\n");
  });

  test("settings reports no changes when already in desired state", async () => {
    // Apply settings first so repo is in desired state
    console.log("Applying settings to reach desired state...");
    exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });

    // Run settings again - should report no changes
    console.log("Running xfg settings again (should report no changes)...");
    const output = exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);

    // Verify output indicates no changes needed
    assert.ok(
      output.includes("No changes needed") ||
        output.includes("0 to add, 0 to change"),
      "Output should indicate no changes needed"
    );

    console.log("\n=== No-changes test passed ===\n");
  });
});
