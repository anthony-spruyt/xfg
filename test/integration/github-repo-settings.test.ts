import { test, describe, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  exec,
  execWithRetry,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  withTestRetry,
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

async function resetRepoSettings(): Promise<void> {
  console.log("  Resetting repo settings to defaults...");
  const fields = Object.entries(GITHUB_DEFAULTS)
    .map(([k, v]) => `-F ${k}=${v}`)
    .join(" ");
  await execWithRetry(`gh api --method PATCH repos/${testRepo} ${fields}`);
}

async function resetSecuritySettings(): Promise<void> {
  console.log("  Resetting security settings...");
  try {
    await execWithRetry(`gh api -X PUT repos/${testRepo}/vulnerability-alerts`);
  } catch {
    /* already enabled */
  }
  try {
    await execWithRetry(
      `gh api -X DELETE repos/${testRepo}/automated-security-fixes`
    );
  } catch {
    /* already disabled */
  }
  try {
    await execWithRetry(
      `gh api -X DELETE repos/${testRepo}/vulnerability-alerts`
    );
  } catch {
    /* already disabled */
  }
  try {
    await execWithRetry(
      `gh api -X DELETE repos/${testRepo}/private-vulnerability-reporting`
    );
  } catch {
    /* already disabled */
  }
}

async function getSecuritySettings(): Promise<{
  vulnerabilityAlerts: boolean;
  automatedSecurityFixes: boolean;
  privateVulnerabilityReporting: boolean;
}> {
  let vulnerabilityAlerts = false;
  try {
    await execWithRetry(`gh api repos/${testRepo}/vulnerability-alerts`);
    vulnerabilityAlerts = true;
  } catch {
    vulnerabilityAlerts = false;
  }

  let automatedSecurityFixes = false;
  try {
    const r = await execWithRetry(
      `gh api repos/${testRepo}/automated-security-fixes`
    );
    automatedSecurityFixes = JSON.parse(r).enabled === true;
  } catch {
    automatedSecurityFixes = false;
  }

  const pvrResult = await execWithRetry(
    `gh api repos/${testRepo}/private-vulnerability-reporting`
  );
  const privateVulnerabilityReporting = JSON.parse(pvrResult).enabled === true;

  return {
    vulnerabilityAlerts,
    automatedSecurityFixes,
    privateVulnerabilityReporting,
  };
}

async function getRepoSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await execWithRetry(`gh api repos/${testRepo}`));
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
  before(async () => {
    tmpDir = join(tmpdir(), `xfg-repo-settings-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("repo-settings");
    testRepo = `${OWNER}/${repoName}`;
    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetRepoSettings();
    await resetSecuritySettings();
  });

  test("settings dry-run shows planned repo settings changes", async () => {
    const configPath = createConfigFile();
    const settingsBefore = await getRepoSettings();

    const output = await exec(
      `node dist/cli.js sync --config ${configPath} --dry-run`,
      { cwd: projectRoot }
    );
    assert.ok(output.includes("DRY RUN") || output.includes("dry-run"));

    const settingsAfter = await getRepoSettings();
    assert.equal(settingsAfter.has_wiki, settingsBefore.has_wiki);
  });

  test("settings applies repo settings changes", async () => {
    const configPath = createConfigFile();

    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    await withTestRetry(
      async () => {
        const s = await getRepoSettings();
        assert.equal(s.has_wiki, false);
        assert.equal(s.has_projects, false);
        assert.equal(s.allow_squash_merge, true);
        assert.equal(s.allow_merge_commit, false);
        assert.equal(s.allow_rebase_merge, false);
        assert.equal(s.delete_branch_on_merge, true);
      },
      {
        description: "repo settings applied",
        retries: 5,
        baseDelayMs: 3000,
      }
    );

    await withTestRetry(
      async () => {
        const sec = await getSecuritySettings();
        assert.equal(sec.vulnerabilityAlerts, true);
        assert.equal(sec.automatedSecurityFixes, false);
        assert.equal(sec.privateVulnerabilityReporting, true);
      },
      {
        description: "security settings applied",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });

  test("settings reports no changes when already in desired state", async () => {
    const configPath = createConfigFile();
    await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    // Security settings have eventual consistency on the GitHub API — a second
    // sync run immediately after the first can read stale state and plan a
    // non-zero diff. Retry until the idempotent run reports no changes.
    await withTestRetry(
      async () => {
        const output = await exec(
          `node dist/cli.js sync --config ${configPath}`,
          {
            cwd: projectRoot,
          }
        );
        assert.ok(
          output.includes("No changes needed") ||
            output.includes("0 to add, 0 to change"),
          `expected idempotent sync to report no changes; got:\n${output}`
        );
      },
      {
        description: "idempotent sync reports no changes",
        retries: 5,
        baseDelayMs: 3000,
      }
    );
  });

  test("settings applies description to repository", async () => {
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

    await exec(`node dist/cli.js sync --config ${descConfigPath}`, {
      cwd: projectRoot,
    });

    const settingsAfter = await getRepoSettings();
    assert.equal(settingsAfter.description, randomDescription);
  });
});
