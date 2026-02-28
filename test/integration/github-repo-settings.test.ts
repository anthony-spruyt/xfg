import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  exec,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
} from "./test-helpers.js";

const OWNER = "spruyt-labs";

const GITHUB_DEFAULTS = {
  has_wiki: true,
  has_projects: true,
  allow_squash_merge: true,
  allow_merge_commit: true,
  allow_rebase_merge: true,
  delete_branch_on_merge: false,
};

let repoName: string;
let testRepo: string;
let tmpDir: string;

function resetRepoSettings(): void {
  console.log("  Resetting repo settings to defaults...");
  const fields = Object.entries(GITHUB_DEFAULTS)
    .map(([k, v]) => `-F ${k}=${v}`)
    .join(" ");
  exec(`gh api --method PATCH repos/${testRepo} ${fields}`);
}

function resetSecuritySettings(): void {
  console.log("  Resetting security settings...");
  try {
    exec(`gh api -X PUT repos/${testRepo}/vulnerability-alerts`);
  } catch {
    /* already enabled */
  }
  try {
    exec(`gh api -X DELETE repos/${testRepo}/automated-security-fixes`);
  } catch {
    /* already disabled */
  }
  try {
    exec(`gh api -X DELETE repos/${testRepo}/vulnerability-alerts`);
  } catch {
    /* already disabled */
  }
  try {
    exec(`gh api -X DELETE repos/${testRepo}/private-vulnerability-reporting`);
  } catch {
    /* already disabled */
  }
}

function getSecuritySettings(): {
  vulnerabilityAlerts: boolean;
  automatedSecurityFixes: boolean;
  privateVulnerabilityReporting: boolean;
} {
  let vulnerabilityAlerts = false;
  try {
    exec(`gh api repos/${testRepo}/vulnerability-alerts`);
    vulnerabilityAlerts = true;
  } catch {
    vulnerabilityAlerts = false;
  }

  let automatedSecurityFixes = false;
  try {
    const r = exec(`gh api repos/${testRepo}/automated-security-fixes`);
    automatedSecurityFixes = JSON.parse(r).enabled === true;
  } catch {
    automatedSecurityFixes = false;
  }

  const pvrResult = exec(
    `gh api repos/${testRepo}/private-vulnerability-reporting`
  );
  const privateVulnerabilityReporting = JSON.parse(pvrResult).enabled === true;

  return {
    vulnerabilityAlerts,
    automatedSecurityFixes,
    privateVulnerabilityReporting,
  };
}

function getRepoSettings(): Record<string, unknown> {
  return JSON.parse(exec(`gh api repos/${testRepo}`));
}

function createConfigFile(): string {
  const configPath = join(tmpDir, `repo-settings-${Date.now()}.yaml`);
  writeFileSync(
    configPath,
    `id: integration-test-repo-settings
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
  - git: https://github.com/${testRepo}.git
`
  );
  return configPath;
}

describe("GitHub Repo Settings Integration Test", () => {
  before(() => {
    tmpDir = join(tmpdir(), `xfg-repo-settings-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("repo-settings");
    testRepo = `${OWNER}/${repoName}`;
    createRepo(OWNER, repoName);
  });

  after(() => {
    deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetRepoSettings();
    resetSecuritySettings();
  });

  test("settings dry-run shows planned repo settings changes", () => {
    const configPath = createConfigFile();
    const settingsBefore = getRepoSettings();

    const output = exec(
      `node dist/cli.js settings --config ${configPath} --dry-run`,
      { cwd: projectRoot }
    );
    assert.ok(output.includes("DRY RUN") || output.includes("dry-run"));

    const settingsAfter = getRepoSettings();
    assert.equal(settingsAfter.has_wiki, settingsBefore.has_wiki);
  });

  test("settings applies repo settings changes", () => {
    const configPath = createConfigFile();

    exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });

    const s = getRepoSettings();
    assert.equal(s.has_wiki, false);
    assert.equal(s.has_projects, false);
    assert.equal(s.allow_squash_merge, true);
    assert.equal(s.allow_merge_commit, false);
    assert.equal(s.allow_rebase_merge, false);
    assert.equal(s.delete_branch_on_merge, true);

    const sec = getSecuritySettings();
    assert.equal(sec.vulnerabilityAlerts, true);
    assert.equal(sec.automatedSecurityFixes, false);
    assert.equal(sec.privateVulnerabilityReporting, true);
  });

  test("settings reports no changes when already in desired state", () => {
    const configPath = createConfigFile();
    exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });

    const output = exec(`node dist/cli.js settings --config ${configPath}`, {
      cwd: projectRoot,
    });
    assert.ok(
      output.includes("No changes needed") ||
        output.includes("0 to add, 0 to change")
    );
  });

  test("settings applies description to repository", () => {
    const randomDescription = `xfg integration test - ${randomUUID()}`;
    const descConfigPath = join(tmpDir, `repo-desc-${Date.now()}.yaml`);
    writeFileSync(
      descConfigPath,
      `id: integration-test-repo-settings-description
settings:
  repo:
    description: "${randomDescription}"
repos:
  - git: https://github.com/${testRepo}.git
`
    );

    exec(`node dist/cli.js settings --config ${descConfigPath}`, {
      cwd: projectRoot,
    });

    const settingsAfter = getRepoSettings();
    assert.equal(settingsAfter.description, randomDescription);
  });
});
