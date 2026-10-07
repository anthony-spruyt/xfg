import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../.."
);
const SCRIPT = join(repoRoot, ".github/scripts/require-env-secrets.sh");
const SENTINEL = "sentinel-value-never-print";

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("/bin/bash", [SCRIPT, ...args], {
    encoding: "utf-8",
    env,
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("require-env-secrets.sh", () => {
  test("passes when every named secret is set", () => {
    const result = run(["integration", "GH_PAT_ORG", "GH_PAT_BOT"], {
      GH_PAT_ORG: SENTINEL,
      GH_PAT_BOT: SENTINEL,
    });

    assert.equal(result.status, 0, result.output);
  });

  test("fails naming the environment and every missing secret", () => {
    const result = run(
      ["integration-main", "GH_PAT_ORG", "TEST_APP_PRIVATE_KEY", "GH_PAT_BOT"],
      { GH_PAT_ORG: SENTINEL, GH_PAT_BOT: "" }
    );

    assert.equal(result.status, 1);
    assert.match(
      result.output,
      /::error[^\n]*environment 'integration-main' is missing secret TEST_APP_PRIVATE_KEY/
    );
    assert.match(
      result.output,
      /environment 'integration-main' is missing secret GH_PAT_BOT/
    );
    assert.doesNotMatch(result.output, /missing secret GH_PAT_ORG/);
  });

  test("links to the repo's environment settings when the repo is known", () => {
    const result = run(["integration", "GH_PAT_ORG"], {
      GITHUB_REPOSITORY: "owner/repo",
    });

    assert.match(
      result.output,
      /https:\/\/github\.com\/owner\/repo\/settings\/environments/
    );
  });

  test("never prints secret values", () => {
    const result = run(["integration", "GH_PAT_ORG", "OPENROUTER_API_KEY"], {
      GH_PAT_ORG: SENTINEL,
    });

    assert.doesNotMatch(result.output, new RegExp(SENTINEL));
  });

  test("rejects a call without secret names", () => {
    const result = run(["integration"]);

    assert.equal(result.status, 2);
    assert.match(result.output, /Usage:/);
  });
});
