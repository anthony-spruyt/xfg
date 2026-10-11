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

const REQUIRED_ENV = [
  "LITELLM_BASE_URL",
  "LITELLM_API_KEY",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
];
// Never set anywhere: a primary that reads it fails before any request is made.
const UNSET_URL_ENV = "XFG_TEST_UNSET_AI_BASE_URL";

const missing = REQUIRED_ENV.filter((name) => !process.env[name]);

// CI must never pass by skipping; locally a missing variable just skips.
if (process.env.CI && missing.length > 0) {
  throw new Error(
    `${missing.join(", ")} must be set in CI for AI integration tests`
  );
}
const skip =
  missing.length > 0
    ? `${missing.join(", ")} not set - skipping AI integration tests`
    : false;

let repoName: string;
let testRepo: string;
let tmpDir: string;

const GATEWAY_FIELDS = `model: openai/gpt-4o-mini
apiKeyEnv: LITELLM_API_KEY
headersEnv:
  CF-Access-Client-Id: CF_ACCESS_CLIENT_ID
  CF-Access-Client-Secret: CF_ACCESS_CLIENT_SECRET`;

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

function gatewayProvider(baseUrlEnv: string, spaces: number): string {
  return indent(
    `provider: openai\nbaseUrlEnv: ${baseUrlEnv}\n${GATEWAY_FIELDS}`,
    spaces
  );
}

function prettierConfig(
  merge: string,
  printWidth: number,
  fallback = false
): string {
  const ai = fallback
    ? `${gatewayProvider(UNSET_URL_ENV, 4)}
    fallback:
${gatewayProvider("LITELLM_BASE_URL", 6)}`
    : gatewayProvider("LITELLM_BASE_URL", 4);
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
${ai}
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

  test("direct mode falls back to the second gateway config when the primary cannot be reached", async () => {
    assert.equal(process.env[UNSET_URL_ENV], undefined);
    const configPath = writeConfig(tmpDir, prettierConfig("direct", 90, true));

    const output = await exec(`node dist/cli.js sync --config ${configPath}`, {
      cwd: projectRoot,
      env: { [UNSET_URL_ENV]: undefined },
    });
    console.log(output);
    assert.ok(
      output.includes("AI provider failed, trying prOptions.ai.fallback"),
      "the primary should have failed and handed over to the fallback"
    );
    assert.ok(
      !output.includes("AI commit message generation failed"),
      "the fallback should have answered"
    );

    await waitForFileVisible(testRepo, TARGET_FILE);

    const message = await execWithRetry(
      `gh api repos/${testRepo}/commits?path=${TARGET_FILE} --jq '.[0].commit.message'`
    );
    const subject = message.split("\n")[0];
    console.log(`AI commit message via fallback:\n${message}`);
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
