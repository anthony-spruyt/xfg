import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exec,
  execWithRetry,
  projectRoot,
  generateRepoName,
  createRepo,
  deleteRepo,
  writeConfig,
} from "./test-helpers.js";

// Personal-repo paths are unit-tested only: ephemeral repos in a user account are noisy and orphan easily
const ORG_OWNER = "spruyt-labs";
const INVITEE = "spruyt-labs-bot";

interface Invitation {
  id: number;
  invitee: { login: string } | null;
}

let orgRepoName: string;
let tmpDir: string;

describe("GitHub Collaborators Integration Test", () => {
  before(async () => {
    orgRepoName = generateRepoName("collaborators-org");
    tmpDir = join(tmpdir(), `xfg-collaborators-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    await createRepo(ORG_OWNER, orgRepoName);
  });

  after(async () => {
    await deleteRepo(ORG_OWNER, orgRepoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("org repos are skipped with a warning", async () => {
    const orgRepo = `${ORG_OWNER}/${orgRepoName}`;
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-collaborators-org
settings:
  collaborators:
    users: [${INVITEE}]
repos:
  - git: https://github.com/${orgRepo}.git
`
    );

    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });

    assert.ok(
      output.includes("collaborators only apply to personal repos"),
      `should warn about org repo, got: ${output}`
    );
    const invitations = JSON.parse(
      await execWithRetry(`gh api repos/${orgRepo}/invitations`)
    ) as Invitation[];
    assert.deepEqual(invitations, []);
  });
});
