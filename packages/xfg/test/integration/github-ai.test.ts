import { test, describe, before, after, beforeEach } from "node:test";
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
  resetTestRepo,
  waitForFileVisible,
  waitForPrVisible,
} from "./test-helpers.js";
import { isConventionalSubject } from "../../src/ai/index.js";

const OWNER = "spruyt-labs";
// Not a workflow file - the CI PAT lacks the `workflow` scope.
const TARGET_FILE = ".prettierrc.json";
const PR_BRANCH = "chore/sync-ai-test";

const KEY_ENV = "OPENROUTER_API_KEY";

// CI must never pass by skipping; locally a missing key just skips.
if (process.env.CI && !process.env[KEY_ENV]) {
  throw new Error(`${KEY_ENV} must be set in CI for AI integration tests`);
}
const skip = process.env[KEY_ENV]
  ? false
  : `${KEY_ENV} is not set - skipping AI integration tests`;

let repoName: string;
let testRepo: string;
let tmpDir: string;

function prettierConfig(merge: string, printWidth: number): string {
  return `id: integration-test-github-ai
files:
  ${TARGET_FILE}:
    content:
      printWidth: ${printWidth}
      singleQuote: true
      trailingComma: all
prOptions:
  merge: ${merge}
  branch: ${PR_BRANCH}
  ai:
    provider: openai
    baseUrl: https://openrouter.ai/api/v1
    apiKeyEnv: ${KEY_ENV}
    model: openai/gpt-4o-mini
repos:
  - git: https://github.com/${testRepo}.git
`;
}

function assertAiSubject(subject: string): void {
  assert.ok(
    isConventionalSubject(subject),
    `expected a conventional commit subject, got: ${subject}`
  );
  assert.ok(
    !subject.startsWith("chore: sync "),
    `expected an AI subject, got the default fallback: ${subject}`
  );
}

describe("GitHub AI commit messages integration test", { skip }, () => {
  before(async () => {
    tmpDir = join(tmpdir(), `xfg-ai-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    repoName = generateRepoName("ai");
    testRepo = `${OWNER}/${repoName}`;
    await createRepo(OWNER, repoName);
  });

  after(async () => {
    await deleteRepo(OWNER, repoName);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTestRepo(testRepo);
  });

  test("direct mode commits with an AI conventional commit message", async () => {
    const configPath = writeConfig(tmpDir, prettierConfig("direct", 100));

    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);
    assert.ok(
      !output.includes("AI commit message generation failed"),
      "AI generation should not fall back"
    );

    await waitForFileVisible(testRepo, TARGET_FILE);

    const message = await execWithRetry(
      `gh api repos/${testRepo}/commits?path=${TARGET_FILE} --jq '.[0].commit.message'`
    );
    const subject = message.split("\n")[0];
    console.log(`AI commit message:\n${message}`);
    assertAiSubject(subject);
  });

  test("PR mode uses the AI subject as title and adds the AI summary", async () => {
    const configPath = writeConfig(tmpDir, prettierConfig("manual", 120));

    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);
    assert.ok(
      !output.includes("AI commit message generation failed"),
      "AI generation should not fall back"
    );

    const pr = await waitForPrVisible(testRepo, PR_BRANCH, "number,title,body");
    const title = pr.title as string;
    const body = pr.body as string;
    console.log(`AI PR title: ${title}\nAI PR body:\n${body}`);
    assertAiSubject(title);

    const summary = body.slice(
      body.indexOf("## Summary"),
      body.indexOf("## Changes")
    );
    const aiPart = summary
      .replace("## Summary", "")
      .replace(/Automated sync of configuration files to .*\./, "")
      .trim();
    assert.ok(aiPart.length > 0, "PR body should contain the AI summary");
  });
});
