import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../.."
);
const SCRIPT = join(repoRoot, ".github/scripts/rate-limit-summary.sh");
const SENTINEL = "sentinel-token-never-print";

// The fake gh prints what `gh api rate_limit --jq ...` would: one TSV row per resource
function fakeGh(dir: string): void {
  const gh = join(dir, "gh");
  writeFileSync(
    gh,
    '#!/bin/sh\nif [ -n "$FAKE_GH_FAIL" ]; then echo "gh: Bad credentials (HTTP 401)" >&2; exit 1; fi\nprintf "%b" "$FAKE_GH_OUTPUT"\n'
  );
  chmodSync(gh, 0o755);
}

describe("rate-limit-summary.sh", () => {
  let dir: string;
  let summary: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rate-limit-summary-"));
    summary = join(dir, "summary.md");
    fakeGh(dir);
  });

  function run(
    phase: string,
    output: string,
    extra: Record<string, string> = {}
  ) {
    const result = spawnSync("/bin/bash", [SCRIPT, phase, "github-sync-1"], {
      encoding: "utf-8",
      env: {
        PATH: `${dir}:/usr/bin:/bin`,
        RUNNER_TEMP: dir,
        GITHUB_STEP_SUMMARY: summary,
        GH_TOKEN: SENTINEL,
        FAKE_GH_OUTPUT: output,
        ...extra,
      },
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      summary: existsSync(summary) ? readFileSync(summary, "utf-8") : "",
    };
  }

  test("records headroom at the start of a lane", () => {
    const result = run(
      "start",
      "core\\t120\\t4880\\t5000\\t4102444800\\ngraphql\\t3\\t4997\\t5000\\t4102444800\\n"
    );

    assert.equal(result.status, 0, result.output);
    assert.match(result.summary, /Rate limit: github-sync-1 \(start\)/);
    assert.match(result.summary, /\| core \| 120 \| 4880 \| 5000 \|/);
    assert.match(result.summary, /\| graphql \| 3 \| 4997 \| 5000 \|/);
  });

  test("reports the requests used since the start of the lane", () => {
    run("start", "core\\t120\\t4880\\t5000\\t4102444800\\n");
    const result = run("end", "core\\t420\\t4580\\t5000\\t4102444800\\n");

    assert.equal(result.status, 0, result.output);
    assert.match(result.summary, /Rate limit: github-sync-1 \(end\)/);
    assert.match(result.summary, /\| core \| 420 \| 4580 \| 5000 \| \+300 \|/);
  });

  test("says so when the window reset during the lane", () => {
    run("start", "core\\t4900\\t100\\t5000\\t1000000000\\n");
    const result = run("end", "core\\t50\\t4950\\t5000\\t4102444800\\n");

    assert.match(
      result.summary,
      /\| core \| 50 \| 4950 \| 5000 \| window reset \|/
    );
  });

  test("warns without failing the job when the API call fails", () => {
    const result = run("start", "", { FAKE_GH_FAIL: "1" });

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /::warning[^\n]*github-sync-1/);
  });

  test("never prints the token", () => {
    run("start", "core\\t1\\t4999\\t5000\\t4102444800\\n");
    const result = run("end", "core\\t2\\t4998\\t5000\\t4102444800\\n");

    assert.doesNotMatch(result.output + result.summary, new RegExp(SENTINEL));
  });

  test("rejects an unknown phase", () => {
    const result = run("middle", "");

    assert.equal(result.status, 2);
    assert.match(result.output, /Usage:/);
  });
});
