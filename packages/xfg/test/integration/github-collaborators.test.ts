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
const INVITEE = "anthony-spruyt";

// Personal repos live under the bot account so test noise stays out of a real user's account
const botToken = process.env.GH_PAT_BOT;
const botEnv = { env: { GH_TOKEN: botToken } };
const skipPersonal = botToken ? false : "GH_PAT_BOT not set";

interface Invitation {
  id: number;
  invitee: { login: string } | null;
}

let botOwner: string;
let personalRepo: string;
let personalRepoName: string;
let orgRepoName: string;
let tmpDir: string;

async function getInvitees(
  repo: string,
  envOptions?: typeof botEnv
): Promise<string[]> {
  const output = await execWithRetry(
    `gh api repos/${repo}/invitations`,
    envOptions
  );
  return (JSON.parse(output) as Invitation[])
    .map((i) => i.invitee?.login.toLowerCase())
    .filter((l): l is string => l !== undefined);
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
  - git: https://github.com/${personalRepo}.git
`
  );
}

async function runSync(
  configPath: string,
  envOptions?: typeof botEnv
): Promise<string> {
  return exec(`node dist/cli.js sync --config ${configPath} --merge direct`, {
    cwd: projectRoot,
    ...envOptions,
  });
}

describe("GitHub Collaborators Integration Test", () => {
  before(async () => {
    tmpDir = join(tmpdir(), `xfg-collaborators-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    orgRepoName = generateRepoName("collaborators-org");
    await createRepo(ORG_OWNER, orgRepoName);

    if (botToken) {
      botOwner = await execWithRetry(`gh api user --jq .login`, botEnv);
      personalRepoName = generateRepoName("collaborators");
      personalRepo = `${botOwner}/${personalRepoName}`;
      await createRepo(botOwner, personalRepoName, botEnv);
    }
  });

  after(async () => {
    await deleteRepo(ORG_OWNER, orgRepoName);
    if (botToken) await deleteRepo(botOwner, personalRepoName, botEnv);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test(
    "invites a collaborator on a personal repo",
    { skip: skipPersonal },
    async () => {
      const output = await runSync(personalConfig([INVITEE]), botEnv);

      assert.ok(
        output.includes(`+ collaborator "${INVITEE}"`),
        `apply output should name the invitee, got: ${output}`
      );
      await withTestRetry(
        async () => {
          assert.ok(
            (await getInvitees(personalRepo, botEnv)).includes(INVITEE),
            "invitation should be pending"
          );
        },
        { description: "invitation visible" }
      );
    }
  );

  test(
    "second run is a no-op and shows the invite as pending",
    { skip: skipPersonal },
    async () => {
      const output = await runSync(personalConfig([INVITEE]), botEnv);

      assert.ok(
        output.includes(`collaborator "${INVITEE}": invite pending`),
        `output should show pending invite, got: ${output}`
      );
      assert.ok(
        !output.includes(`+ collaborator "${INVITEE}"`),
        `should not re-invite, got: ${output}`
      );
      assert.equal(
        (await getInvitees(personalRepo, botEnv)).filter((l) => l === INVITEE)
          .length,
        1
      );
    }
  );

  test(
    "deleteOrphaned cancels invites for users not in config",
    { skip: skipPersonal },
    async () => {
      const output = await runSync(personalConfig([]), botEnv);

      assert.ok(
        output.includes(`- collaborator "${INVITEE}"`),
        `output should cancel the invite, got: ${output}`
      );
      await withTestRetry(
        async () => {
          assert.ok(
            !(await getInvitees(personalRepo, botEnv)).includes(INVITEE),
            "invitation should be cancelled"
          );
        },
        { description: "invitation cancelled" }
      );
    }
  );

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

    const output = await runSync(configPath);

    assert.ok(
      output.includes("collaborators only apply to personal repos"),
      `should warn about org repo, got: ${output}`
    );
    assert.deepEqual(await getInvitees(orgRepo), []);
  });
});
