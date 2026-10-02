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
  withTestRetry,
} from "./test-helpers.js";

const ORG_OWNER = "spruyt-labs";

interface Invitation {
  id: number;
  invitee: { login: string } | null;
}

let userOwner: string;
let invitee: string;
let repoName: string;
let testRepo: string;
let orgRepoName: string;
let tmpDir: string;

async function getInvitees(repo: string): Promise<string[]> {
  const output = await execWithRetry(`gh api repos/${repo}/invitations`);
  return (JSON.parse(output) as Invitation[])
    .map((i) => i.invitee?.login.toLowerCase())
    .filter((l): l is string => l !== undefined);
}

async function runSync(configPath: string, extraArgs = ""): Promise<string> {
  return exec(
    `node dist/cli.js sync --config ${configPath} ${extraArgs}`.trim(),
    { cwd: projectRoot }
  );
}

function personalConfig(users: string[]): string {
  return writeConfig(
    tmpDir,
    `id: integration-test-github-collaborators
settings:
  collaborators:
    deleteOrphaned: true
    users: [${users.join(", ")}]
repos:
  - git: https://github.com/${testRepo}.git
`
  );
}

describe("GitHub Collaborators Integration Test", () => {
  before(async () => {
    userOwner = await execWithRetry(`gh api user --jq .login`);
    invitee =
      process.env.XFG_TEST_COLLABORATOR ??
      (userOwner.toLowerCase() === "spruyt-labs-bot"
        ? "anthony-spruyt"
        : "spruyt-labs-bot");
    repoName = generateRepoName("collaborators");
    testRepo = `${userOwner}/${repoName}`;
    orgRepoName = generateRepoName("collaborators-org");
    tmpDir = join(tmpdir(), `xfg-collaborators-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    await createRepo(userOwner, repoName);
  });

  after(async () => {
    await deleteRepo(userOwner, repoName);
    await deleteRepo(ORG_OWNER, orgRepoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("invites a collaborator on a personal repo", async () => {
    const output = await runSync(personalConfig([invitee]), "--merge direct");

    assert.ok(
      output.includes(`+ collaborator "${invitee}"`),
      `apply output should name the invitee, got: ${output}`
    );
    await withTestRetry(
      async () => {
        assert.ok(
          (await getInvitees(testRepo)).includes(invitee.toLowerCase()),
          "invitation should be pending"
        );
      },
      { description: "invitation visible" }
    );
  });

  test("second run is a no-op and shows the invite as pending", async () => {
    const output = await runSync(personalConfig([invitee]), "--merge direct");

    assert.ok(
      output.includes(`collaborator "${invitee}": invite pending`),
      `output should show pending invite, got: ${output}`
    );
    assert.ok(
      !output.includes(`+ collaborator "${invitee}"`),
      `should not re-invite, got: ${output}`
    );
    assert.equal(
      (await getInvitees(testRepo)).filter((l) => l === invitee.toLowerCase())
        .length,
      1
    );
  });

  test("removing the user from config cancels the invite", async () => {
    const output = await runSync(personalConfig([]), "--merge direct");

    assert.ok(
      output.includes(`- collaborator "${invitee}"`),
      `output should cancel the invite, got: ${output}`
    );
    await withTestRetry(
      async () => {
        assert.ok(
          !(await getInvitees(testRepo)).includes(invitee.toLowerCase()),
          "invitation should be cancelled"
        );
      },
      { description: "invitation cancelled" }
    );
  });

  test("org repos are skipped with a warning", async () => {
    await createRepo(ORG_OWNER, orgRepoName);
    const orgRepo = `${ORG_OWNER}/${orgRepoName}`;
    const configPath = writeConfig(
      tmpDir,
      `id: integration-test-github-collaborators-org
settings:
  collaborators:
    users: [${invitee}]
repos:
  - git: https://github.com/${orgRepo}.git
`
    );

    const output = await runSync(configPath);

    assert.ok(
      output.includes("collaborators only apply to personal repos"),
      `should warn about org repo, got: ${output}`
    );
    assert.deepEqual(await getInvitees(orgRepo), []);
  });
});
