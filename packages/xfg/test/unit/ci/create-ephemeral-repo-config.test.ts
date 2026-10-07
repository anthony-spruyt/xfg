import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../.."
);
const SCRIPT = join(
  repoRoot,
  ".github/scripts/create-ephemeral-repo-config.sh"
);

describe("create-ephemeral-repo-config.sh", () => {
  let dir: string;
  let ghLog: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ephemeral-config-"));
    ghLog = join(dir, "gh.log");
    const gh = join(dir, "gh");
    writeFileSync(gh, `#!/bin/sh\necho "$*" >>"${ghLog}"\n`);
    chmodSync(gh, 0o755);
  });

  function run(args: string[]) {
    const result = spawnSync("/bin/bash", [SCRIPT, ...args], {
      encoding: "utf-8",
      env: { PATH: `${dir}:/usr/bin:/bin`, GITHUB_OUTPUT: join(dir, "out") },
      timeout: 10_000,
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      ghCalls: existsSync(ghLog)
        ? readFileSync(ghLog, "utf-8").split("\n").filter(Boolean)
        : [],
    };
  }

  test("inline mode writes the config without touching GitHub, since xfg creates the repo", () => {
    const config = join(dir, "config.yaml");
    const result = run([
      "action-pat",
      "spruyt-labs",
      config,
      "lifecycle-action-pat-test",
      "lifecycle-action-test.json",
      '{"createdByAction": true}',
    ]);

    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.ghCalls, []);
    assert.match(
      readFileSync(config, "utf-8"),
      /git: https:\/\/github\.com\/spruyt-labs\/xfg-lifecycle-action-pat-\d+-[0-9a-f]{6}\.git/
    );
    assert.match(
      readFileSync(join(dir, "out"), "utf-8"),
      /^repo_name=xfg-lifecycle-action-pat-/m
    );
  });

  test("fixture mode creates the repo and waits until it is ready", () => {
    const fixture = join(dir, "fixture.yaml");
    writeFileSync(
      fixture,
      "repos:\n  - git: https://github.com/OWNER/REPO_PLACEHOLDER.git\n"
    );
    const config = join(dir, "config.yaml");

    const result = run([
      "--fixture",
      "action-app",
      "spruyt-labs",
      config,
      fixture,
    ]);

    assert.equal(result.status, 0, result.output);
    assert.match(
      result.ghCalls[0],
      /^repo create spruyt-labs\/xfg-action-app-test-/
    );
    assert.match(
      result.ghCalls[1],
      /^api repos\/spruyt-labs\/xfg-action-app-test-.*\/labels/
    );
    assert.match(
      readFileSync(config, "utf-8"),
      /spruyt-labs\/xfg-action-app-test-/
    );
  });
});
