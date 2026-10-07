import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCommand,
  formatRequestStats,
  secondaryLimitPoints,
  inShard,
  isRateLimitText,
  isTransientErrorText,
  resetTestRepo,
  type RequestClass,
} from "../../integration/test-helpers.js";

// "1759842942901" contains "429" and "1759403500123" contains "403" and "500",
// the shape generateRepoName() produces from Date.now().
const REPO_WITH_429 = "spruyt-labs/xfg-lifecycle-test-1759842942901-a1b2c3";
const REPO_WITH_403_500 = "spruyt-labs/xfg-sync-test-1759403500123-0f9e8d";

const NOT_FOUND_ERRORS = [
  `Command failed: sh -c gh api repos/${REPO_WITH_429}\ngh: Not Found (HTTP 404)`,
  `Command failed: sh -c gh api repos/${REPO_WITH_429}/vulnerability-alerts\ngh: Not Found (HTTP 404)`,
  `Command failed: sh -c gh api -X POST repos/${REPO_WITH_403_500}/generate\ngh: Not Found (HTTP 404)`,
];

const RATE_LIMIT_ERRORS = {
  "HTTP 429 status": "Command failed: sh -c curl ...\nHTTP 429",
  "HTTP/2 429 status line": "HTTP/2.0 429 Too Many Requests\nRetry-After: 30",
  "status: 429": "Request failed with status: 429",
  "status code 429": "Request failed with status code 429",
  "API rate limit exceeded":
    "gh: API rate limit exceeded for user ID 12345. (HTTP 403)",
  "secondary rate limit":
    "gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)",
  "HTTP 403 with rate-limit message":
    "HTTP 403: API rate limit exceeded for installation ID 67890.",
};

describe("isRateLimitText", () => {
  for (const text of NOT_FOUND_ERRORS) {
    test(`is false for a 404 whose repo name contains 429/403: ${text.split("\n")[0]}`, () => {
      assert.equal(isRateLimitText(text), false);
    });
  }

  test("is false for a 403 permission error without rate-limit text", () => {
    assert.equal(
      isRateLimitText("gh: Must have admin rights to Repository. (HTTP 403)"),
      false
    );
  });

  for (const [name, text] of Object.entries(RATE_LIMIT_ERRORS)) {
    test(`is true for ${name}`, () => {
      assert.equal(isRateLimitText(text), true);
    });
  }
});

describe("isTransientErrorText", () => {
  for (const text of NOT_FOUND_ERRORS) {
    test(`is false for a 404 whose repo name contains 429/403/500: ${text.split("\n")[0]}`, () => {
      assert.equal(isTransientErrorText(text), false);
    });
  }

  for (const [name, text] of Object.entries(RATE_LIMIT_ERRORS)) {
    test(`is true for ${name}`, () => {
      assert.equal(isTransientErrorText(text), true);
    });
  }

  for (const text of [
    "gh: Server Error (HTTP 500)",
    "HTTP 502: Bad Gateway",
    "gh: HTTP 503",
    "Command failed: sh -c curl ...\nHTTP 504",
    "<html><head><title>502 Bad Gateway</title></head></html>",
    "curl: (22) The requested URL returned error: 503\nerror code: 503HTTP 503",
  ]) {
    test(`is true for 5xx: ${text}`, () => {
      assert.equal(isTransientErrorText(text), true);
    });
  }

  test("is true for a curl -w status glued to the response body", () => {
    assert.equal(isTransientErrorText("Retry laterHTTP 429"), true);
    assert.equal(isRateLimitText("Retry laterHTTP 429"), true);
  });

  test("is false for a status number inside a JSON body", () => {
    const text = 'Assertion failed: {"status": 500, "count": 429}';
    assert.equal(isTransientErrorText(text), false);
    assert.equal(isRateLimitText(text), false);
  });

  test("is false for HTTP 501 Not Implemented", () => {
    assert.equal(isTransientErrorText("gh: Not Implemented (HTTP 501)"), false);
  });
});

describe("classifyCommand", () => {
  const cases: Record<string, RequestClass> = {
    "gh api repos/o/r/pulls --jq '.[].number'": "read",
    "gh api repos/o/r/contents/f --jq '.content' | jq -r .": "read",
    "gh api --method GET repos/o/r/commits -f per_page=100": "read",
    "gh api -X GET search/issues -f q=x": "read",
    "gh api --method PATCH repos/o/r/pulls/1 -f state=closed": "write",
    "gh api --method DELETE repos/o/r/rulesets/7": "write",
    "gh api -X PUT repos/o/r/vulnerability-alerts": "create",
    "gh api repos/o/r/labels -f name=bug": "create",
    "gh api repos/o/r/rulesets --input /tmp/r.json": "create",
    "gh api --method POST repos/o/r/git/commits -f tree=x": "create",
    "gh api graphql -f query='{ viewer { login } }'": "read",
    "gh api graphql -f query='mutation { deleteRef(input: {}) { clientMutationId } }'":
      "write",
    "gh pr list --repo o/r --head b --json number": "read",
    "gh pr view 3 --repo o/r --json state --jq '.state'": "read",
    "gh repo create o/r --public --add-readme": "create",
    "gh repo delete --yes o/r": "write",
    "gh label create bug --color ededed --force --repo o/r": "create",
    "gh pr close 3 --repo o/r": "write",
    "node dist/cli.js sync --config /tmp/c.yaml": "cli",
    "bash .github/scripts/reset-test-repo-ado.sh a b c": "external",
    "az repos pr list --org x": "external",
    "glab api --method DELETE projects/1": "external",
    "curl -s https://dev.azure.com/x": "external",
  };
  for (const [command, expected] of Object.entries(cases)) {
    test(`${command} is ${expected}`, () => {
      assert.equal(classifyCommand(command), expected);
    });
  }
});

describe("resetTestRepo", () => {
  const REPO = "spruyt-labs/xfg-sync-test-1-abcdef";
  const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

  function fakeRun(responses: Record<string, string>) {
    const calls: string[] = [];
    const run = async (command: string): Promise<string> => {
      calls.push(command);
      const key = Object.keys(responses).find((k) => command.includes(k));
      if (key === undefined) return "";
      if (responses[key] === "ERROR") {
        throw new Error("gh: Not Found (HTTP 404)");
      }
      return responses[key];
    };
    return { calls, run };
  }

  test("wipes main in one empty-tree commit instead of per-file deletes", async () => {
    const { calls, run } = fakeRun({
      "/branches/main": "headsha treesha",
      "/git/commits": "newsha",
    });

    await resetTestRepo(REPO, {}, run);

    const commit = calls.find((c) => c.includes("/git/commits"));
    assert.ok(commit, calls.join("\n"));
    assert.match(commit, /--method POST/);
    assert.match(commit, new RegExp(`tree=${EMPTY_TREE}`));
    assert.match(commit, /parents\[\]=headsha/);
    const ref = calls.find((c) => c.includes("/git/refs/heads/main"));
    assert.ok(ref, calls.join("\n"));
    assert.match(ref, /--method PATCH/);
    assert.match(ref, /sha=newsha/);
    assert.ok(!calls.some((c) => c.includes("/contents")), calls.join("\n"));
  });

  test("skips the wipe when main already has an empty tree", async () => {
    const { calls, run } = fakeRun({
      "/branches/main": `headsha ${EMPTY_TREE}`,
    });

    await resetTestRepo(REPO, {}, run);

    assert.ok(!calls.some((c) => c.includes("/git/")), calls.join("\n"));
  });

  test("deletes rulesets before rewriting main", async () => {
    const { calls, run } = fakeRun({
      "/rulesets --jq": "11\n12",
      "/branches/main": "headsha treesha",
      "/git/commits": "newsha",
    });

    await resetTestRepo(REPO, {}, run);

    const deletes = calls
      .map((c, i) => (/--method DELETE \S+\/rulesets\/1[12]$/.test(c) ? i : -1))
      .filter((i) => i >= 0);
    const refUpdate = calls.findIndex((c) =>
      c.includes("/git/refs/heads/main")
    );
    assert.equal(deletes.length, 2, calls.join("\n"));
    assert.ok(Math.max(...deletes) < refUpdate, calls.join("\n"));
  });

  test("closes open PRs and deletes every branch but main", async () => {
    const { calls, run } = fakeRun({
      "/pulls --jq": "4\n5",
      "/branches --jq": "main\nchore/a\nchore/b",
      "/branches/main": `headsha ${EMPTY_TREE}`,
    });

    await resetTestRepo(REPO, {}, run);

    for (const pr of ["4", "5"]) {
      assert.ok(
        calls.includes(
          `gh api --method PATCH repos/${REPO}/pulls/${pr} -f state=closed`
        ),
        calls.join("\n")
      );
    }
    for (const branch of ["chore/a", "chore/b"]) {
      assert.ok(
        calls.includes(
          `gh api --method DELETE repos/${REPO}/git/refs/heads/${branch}`
        ),
        calls.join("\n")
      );
    }
    assert.ok(
      !calls.some((c) => c.endsWith("/git/refs/heads/main")),
      calls.join("\n")
    );
  });

  test("keeps labels by default", async () => {
    const { calls, run } = fakeRun({ "/labels --jq": "bug" });

    await resetTestRepo(REPO, {}, run);

    assert.ok(!calls.some((c) => c.includes("/labels")), calls.join("\n"));
  });

  test("deletes labels when asked", async () => {
    const { calls, run } = fakeRun({ "/labels --jq": "bug\ngood first issue" });

    await resetTestRepo(REPO, { deleteLabels: true }, run);

    for (const label of ["bug", "good%20first%20issue"]) {
      assert.ok(
        calls.includes(`gh api --method DELETE repos/${REPO}/labels/${label}`),
        calls.join("\n")
      );
    }
  });

  test("treats a failed listing as nothing to reset", async () => {
    const { calls, run } = fakeRun({
      "/pulls --jq": "ERROR",
      "/branches --jq": "ERROR",
      "/rulesets --jq": "ERROR",
      "/branches/main": "headsha treesha",
      "/git/commits": "newsha",
    });

    await resetTestRepo(REPO, {}, run);

    assert.ok(
      calls.some((c) => c.includes("/git/refs/heads/main")),
      calls.join("\n")
    );
  });

  test("fails loudly when main cannot be rewritten", async () => {
    const { run } = fakeRun({
      "/branches/main": "headsha treesha",
      "/git/commits": "ERROR",
    });

    await assert.rejects(resetTestRepo(REPO, {}, run), /HTTP 404/);
  });
});

describe("formatRequestStats", () => {
  test("renders a markdown summary of requests by class", () => {
    const text = formatRequestStats("github.test.ts", {
      read: 40,
      write: 12,
      create: 7,
      cli: 9,
      external: 4,
      queueWaitMs: 15_400,
      maxQueueWaitMs: 1_900,
      rateLimitHits: 1,
    });

    assert.match(text, /github\.test\.ts/);
    assert.match(text, /\| read \| 40 \|/);
    assert.match(text, /\| write \| 12 \|/);
    assert.match(text, /\| create \| 7 \|/);
    assert.match(text, /\| cli \| 9 \|/);
    assert.match(text, /\| external \| 4 \|/);
    assert.match(text, /15\.4s total, 1\.9s max/);
    assert.match(text, /Rate-limit hits: 1/);
  });
});

describe("inShard", () => {
  test("runs every test without a shard", () => {
    assert.deepEqual(
      [0, 1, 2].map((i) => inShard(i, undefined)),
      [true, true, true]
    );
  });

  test("deals tests round-robin across shards", () => {
    const indexes = [0, 1, 2, 3, 4];
    assert.deepEqual(
      indexes.filter((i) => inShard(i, "1/2")),
      [0, 2, 4]
    );
    assert.deepEqual(
      indexes.filter((i) => inShard(i, "2/2")),
      [1, 3]
    );
  });

  for (const shard of ["0/2", "3/2", "1", "a/b", "1/0"]) {
    test(`rejects malformed shard ${shard}`, () => {
      assert.throws(() => inShard(0, shard), /XFG_TEST_SHARD/);
    });
  }
});

describe("secondaryLimitPoints", () => {
  test("weighs GitHub calls the way the secondary rate limit does", () => {
    assert.equal(secondaryLimitPoints("read"), 1);
    assert.equal(secondaryLimitPoints("write"), 5);
    assert.equal(secondaryLimitPoints("create"), 5);
  });

  test("leaves xfg CLI runs and other services out of the GitHub budget", () => {
    assert.equal(secondaryLimitPoints("cli"), 0);
    assert.equal(secondaryLimitPoints("external"), 0);
  });
});
