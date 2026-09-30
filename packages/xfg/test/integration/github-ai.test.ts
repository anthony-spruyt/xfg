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
const WORKFLOW_FILE = ".github/workflows/ci.yaml";
const PR_BRANCH = "chore/sync-ai-test";

const skip = process.env.ANTHROPIC_API_KEY
  ? false
  : "ANTHROPIC_API_KEY is not set - skipping AI integration tests";

let repoName: string;
let testRepo: string;
let tmpDir: string;

function workflowConfig(merge: string, nodeVersion: string): string {
  return `id: integration-test-github-ai
files:
  ${WORKFLOW_FILE}:
    content:
      name: CI
      on:
        push:
          branches: [main]
      jobs:
        test:
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@v5
            - uses: actions/setup-node@v4
              with:
                node-version: "${nodeVersion}"
prOptions:
  merge: ${merge}
  branch: ${PR_BRANCH}
  ai:
    provider: anthropic
    model: claude-haiku-4-5
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
    const configPath = writeConfig(tmpDir, workflowConfig("direct", "22"));

    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
    });
    console.log(output);
    assert.ok(
      !output.includes("AI commit message generation failed"),
      "AI generation should not fall back"
    );

    await waitForFileVisible(testRepo, WORKFLOW_FILE);

    const message = await execWithRetry(
      `gh api repos/${testRepo}/commits?path=${WORKFLOW_FILE} --jq '.[0].commit.message'`
    );
    const subject = message.split("\n")[0];
    console.log(`AI commit message:\n${message}`);
    assertAiSubject(subject);
  });

  test("PR mode uses the AI subject as title and adds the AI summary", async () => {
    const configPath = writeConfig(tmpDir, workflowConfig("manual", "24"));

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
